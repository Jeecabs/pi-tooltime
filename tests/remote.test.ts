import assert from "node:assert/strict";
import test from "node:test";

import type { TaskTrace } from "../src/core/types.ts";
import { createRemoteTraceExporter, RemoteTraceExporter } from "../src/remote.ts";

function trace(): TaskTrace {
  return {
    schemaVersion: 1,
    taskId: "task",
    sessionId: "session",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    outcome: "completed",
    mode: "analytics",
    injectedRuleIds: [],
    taskWallMs: 1_000,
    toolWallMs: 500,
    toolCallMs: 500,
    suspectedWasteMs: 0,
    calls: [],
    findings: [],
    droppedCallCount: 0,
  };
}

test("remote export stays inert when disabled", () => {
  let calls = 0;
  const exporter = createRemoteTraceExporter(
    { enabled: false, endpoint: "https://example.com/traces", timeoutMs: 5_000 },
    {},
    { fetch: async () => { calls++; return { ok: true, status: 200 }; } },
  );

  assert.equal(exporter, undefined);
  assert.equal(calls, 0);
});

test("sends only the redacted trace envelope with an environment token", async () => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: string; redirect: string }> = [];
  const exporter = createRemoteTraceExporter(
    { enabled: true, endpoint: "https://telemetry.example.com/pi", timeoutMs: 5_000 },
    { PI_TOOLTIME_REMOTE_TOKEN: "token-value" },
    {
      now: () => new Date("2026-01-02T00:00:00.000Z"),
      fetch: async (url, init) => {
        requests.push({ url, headers: init.headers, body: init.body, redirect: init.redirect });
        return { ok: true, status: 202 };
      },
    },
  );

  exporter!.schedule(trace());
  await exporter!.flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://telemetry.example.com/pi");
  assert.equal(requests[0]?.headers.Authorization, "Bearer token-value");
  assert.equal(requests[0]?.headers["User-Agent"], "pi-tooltime/1.0.0-rc.1");
  assert.equal(exporter?.status().endpoint, "https://telemetry.example.com");
  assert.equal(requests[0]?.body.includes("token-value"), false);
  assert.equal(requests[0]?.redirect, "error");
  const remoteTrace = JSON.parse(requests[0]!.body).trace;
  const { taskId: _taskId, sessionId: _sessionId, ...expectedRemoteTrace } = trace();
  assert.deepEqual(remoteTrace, expectedRemoteTrace);
});

test("remote trace allowlist omits local fingerprints and guidance text", async () => {
  let body = "";
  const exporter = new RemoteTraceExporter({
    endpoint: "https://telemetry.example.com/pi",
    timeoutMs: 5_000,
    fetch: async (_url, init) => {
      body = init.body;
      return { ok: true, status: 202 };
    },
  });
  const calls = [{
    toolName: "read",
    fingerprint: "fingerprint-must-stay-local",
    family: "repository",
    operation: "read",
    scope: "targeted",
    mutates: false,
    sequence: 1,
    startOffsetMs: 10,
    durationMs: 20,
    isError: false,
    resultKind: "nonempty",
    extraSecret: "call-extra-secret",
  }] satisfies readonly (TaskTrace["calls"][number] & { readonly extraSecret: string })[];
  const findings = [{
    code: "search.broad-scope",
    signature: "search.broad-scope",
    confidence: "high",
    callSequences: [1],
    suspectedWasteMs: 20,
    guidanceId: "target-first",
    guidance: "HOSTILE_GUIDANCE",
    extraSecret: "finding-extra-secret",
  }] satisfies readonly (TaskTrace["findings"][number] & { readonly extraSecret: string })[];
  const sensitive: TaskTrace & { readonly extraSecret: string } = {
    ...trace(),
    calls,
    findings,
    extraSecret: "trace-extra-secret",
  };

  exporter.schedule(sensitive);
  await exporter.flush();
  const remoteTrace = JSON.parse(body).trace;

  assert.deepEqual(Object.keys(remoteTrace).sort(), [
    "calls", "completedAt", "droppedCallCount", "findings", "injectedRuleIds", "mode", "outcome",
    "schemaVersion", "startedAt", "suspectedWasteMs", "taskWallMs", "toolCallMs", "toolWallMs",
  ].sort());
  assert.deepEqual(Object.keys(remoteTrace.calls[0]).sort(), [
    "durationMs", "family", "isError", "mutates", "operation", "resultKind", "scope", "sequence",
    "startOffsetMs", "toolName",
  ].sort());
  assert.deepEqual(Object.keys(remoteTrace.findings[0]).sort(), [
    "callSequences", "code", "confidence", "guidanceId", "signature", "suspectedWasteMs",
  ].sort());
  assert.equal("fingerprint" in remoteTrace.calls[0], false);
  assert.equal("guidance" in remoteTrace.findings[0], false);
  assert.equal(body.includes("secret"), false);
  assert.equal(body.includes("HOSTILE_GUIDANCE"), false);
});

test("rejects remote endpoint queries and fragments", () => {
  for (const endpoint of ["https://example.com/pi?project=secret", "https://example.com/pi#fragment"]) {
    assert.throws(() => new RemoteTraceExporter({
      endpoint,
      timeoutMs: 5_000,
      fetch: async () => ({ ok: true, status: 200 }),
    }), /query string or fragment/u);
  }
});

test("rejects insecure non-loopback endpoints", () => {
  assert.throws(() => new RemoteTraceExporter({
    endpoint: "http://telemetry.example.com/pi",
    timeoutMs: 5_000,
    fetch: async () => ({ ok: true, status: 200 }),
  }), /HTTPS/u);

  assert.doesNotThrow(() => new RemoteTraceExporter({
    endpoint: "http://127.0.0.1:3000/pi",
    timeoutMs: 5_000,
    fetch: async () => ({ ok: true, status: 200 }),
  }));
});

test("rejects unsafe tokens and redacts request failures", async () => {
  const unsafeToken = "secret-value\nX-Leak: yes";
  assert.throws(() => new RemoteTraceExporter({
    endpoint: "https://telemetry.example.com/pi",
    timeoutMs: 5_000,
    token: unsafeToken,
    fetch: async () => ({ ok: true, status: 200 }),
  }), (error: unknown) => error instanceof Error && !error.message.includes("secret-value") && /unsupported characters/u.test(error.message));

  const exporter = new RemoteTraceExporter({
    endpoint: "https://telemetry.example.com/pi",
    timeoutMs: 5_000,
    token: "secret-value",
    fetch: async () => { throw new Error("failed with secret-value"); },
  });
  exporter.schedule(trace());
  await exporter.flush();

  assert.equal(exporter.status().error, "Remote request failed.");
  assert.equal(exporter.status().error?.includes("secret-value"), false);
});

test("bounds pending sends and reports failures without throwing", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const exporter = new RemoteTraceExporter({
    endpoint: "https://telemetry.example.com/pi",
    timeoutMs: 5_000,
    maxPending: 1,
    fetch: async () => {
      await blocked;
      return { ok: false, status: 503 };
    },
  });

  exporter.schedule(trace());
  exporter.schedule({ ...trace(), taskId: "dropped" });
  assert.equal(exporter.status().dropped, 1);
  release();
  await exporter.flush();

  assert.match(exporter.status().error ?? "", /HTTP 503/u);
});
