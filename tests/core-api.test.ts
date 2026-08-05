import assert from "node:assert/strict";
import test from "node:test";

import * as core from "../src/core/index.ts";
import {
  TooltimeLifecycleError,
  analyzeTraces,
  createTaskRecorder,
  decodeTaskTrace,
  formatAnalysis,
  type TaskRecorder,
  type TaskTrace,
  type TooltimeClock,
} from "../src/core/index.ts";

function controlledRecorder(options: Partial<Parameters<typeof createTaskRecorder>[0]> = {}): {
  recorder: TaskRecorder;
  setTime(value: number): void;
} {
  let time = 0;
  const clock: TooltimeClock = {
    monotonicNow: () => time,
    wallNow: () => new Date(1_700_000_000_000 + time),
  };
  return {
    recorder: createTaskRecorder({
      sessionId: "session-1",
      taskId: "task-1",
      cwd: "/project",
      clock,
      ...options,
    }),
    setTime(value) {
      time = value;
    },
  };
}

function repeatedTrace(): TaskTrace {
  const { recorder, setTime } = controlledRecorder();
  for (const [id, start, finish] of [["a", 100, 2_600], ["b", 2_700, 5_200]] as const) {
    setTime(start);
    recorder.record({ type: "start", callId: id, toolName: "read", input: { path: "README.md" } });
    setTime(finish);
    recorder.record({ type: "finish", callId: id, result: "text", isError: false });
  }
  setTime(5_300);
  return recorder.finish();
}

test("provides one small immutable record-analyze-format interface", () => {
  assert.deepEqual(Object.keys(core).sort(), [
    "TooltimeLifecycleError",
    "analyzeTraces",
    "createTaskRecorder",
    "decodeTaskTrace",
    "formatAnalysis",
  ]);

  const secret = "PRIVATE_CANARY";
  const { recorder, setTime } = controlledRecorder({ prompt: `Inspect repository ${secret}` });
  setTime(100);
  recorder.record({ type: "start", callId: `call-${secret}`, toolName: "read", input: { path: `/tmp/${secret}` } });
  setTime(300);
  recorder.record({ type: "finish", callId: `call-${secret}`, result: secret, isError: false });
  setTime(500);
  const trace = recorder.finish();
  const analysis = analyzeTraces([trace]);

  assert.equal(JSON.stringify(trace).includes(secret), false);
  assert.equal(trace.intent, "repository");
  assert.equal(trace.calls[0]?.durationMs, 200);
  assert.equal(Object.isFrozen(trace.calls[0]), true);
  assert.throws(() => Reflect.apply(Array.prototype.push, trace.calls, [{}]), TypeError);
  assert.equal(recorder.finish(), trace);
  assert.match(formatAnalysis(analysis, { audience: "human", title: "Eval\nreport" }), /^Eval report\n/u);
  assert.match(formatAnalysis(analysis, { audience: "model" }), /^Tooltime report\n/u);
});

test("decodes untrusted records and counts traces independently of caller IDs", () => {
  const trace = repeatedTrace();
  const canonical = JSON.parse(JSON.stringify(trace));
  const decoded = decodeTaskTrace(canonical);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.warnings, []);

  const normalized = decodeTaskTrace({ ...canonical, rawPrompt: "discard" });
  assert.equal(normalized.ok, true);
  if (normalized.ok) assert.deepEqual(normalized.warnings, [{ code: "normalized-trace" }]);
  assert.equal(decodeTaskTrace({ ...canonical, toolWallMs: canonical.taskWallMs + 1 }).ok, false);

  const analysis = analyzeTraces([trace, repeatedTrace(), { schemaVersion: 99 }]);
  const finding = analysis.findings.find((item) => item.code === "repeat.expensive-identical");
  assert.equal(analysis.taskCount, 2);
  assert.equal(analysis.rejectedTraceCount, 1);
  assert.equal(finding?.taskCount, 2);
});

test("rejects invalid limits and lifecycle order", () => {
  assert.throws(() => createTaskRecorder({ sessionId: "session", maxCalls: Number.NaN }), RangeError);
  assert.throws(() => createTaskRecorder({ sessionId: "bad/session" }), TypeError);

  const { recorder, setTime } = controlledRecorder({ maxCalls: 1 });
  setTime(1);
  recorder.record({ type: "start", callId: "a", toolName: "read" });
  assert.throws(
    () => recorder.record({ type: "start", callId: "a", toolName: "read" }),
    (error: unknown) => error instanceof TooltimeLifecycleError && error.code === "duplicate-call",
  );
  assert.throws(
    () => recorder.record({ type: "finish", callId: "missing", isError: false }),
    (error: unknown) => error instanceof TooltimeLifecycleError && error.code === "unknown-call",
  );
  setTime(10);
  assert.equal(recorder.finish("aborted").calls[0]?.resultKind, "error");
  assert.throws(
    () => recorder.record({ type: "finish", callId: "a", isError: false }),
    (error: unknown) => error instanceof TooltimeLifecycleError && error.code === "task-finished",
  );
});

test("contains hostile values at every unknown-input seam", () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error("PRIVATE_PROXY_CANARY");
    },
    get() {
      throw new Error("PRIVATE_PROXY_CANARY");
    },
  });
  const { recorder, setTime } = controlledRecorder();
  setTime(1);
  recorder.record({ type: "start", callId: "a", toolName: "custom_tool", input: hostile });
  setTime(2);
  recorder.record({ type: "finish", callId: "a", result: hostile, isError: false });
  setTime(3);
  assert.equal(JSON.stringify(recorder.finish()).includes("PRIVATE_PROXY_CANARY"), false);

  assert.throws(
    () => Reflect.apply(formatAnalysis, undefined, [hostile, { audience: "model" }]),
    (error: unknown) => error instanceof TypeError && !error.message.includes("PRIVATE_PROXY_CANARY"),
  );
  assert.throws(
    () => analyzeTraces({ *[Symbol.iterator]() { throw new Error("PRIVATE_ITERATOR_CANARY"); } }),
    (error: unknown) => error instanceof TypeError && !error.message.includes("PRIVATE_ITERATOR_CANARY"),
  );
});
