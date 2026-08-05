import assert from "node:assert/strict";
import test from "node:test";

import { classifyToolCall } from "../src/core/classify.ts";
import { TaskRecorder } from "../src/core/recorder.ts";
import type { ClassifiedToolCall } from "../src/core/types.ts";

function classified(toolName: ClassifiedToolCall["toolName"], fingerprint: string): ClassifiedToolCall {
  return {
    toolName,
    fingerprint,
    family: "repository",
    operation: "read",
    scope: "targeted",
    mutates: false,
  };
}

test("records parallel tool wall time as an interval union", () => {
  let time = 0;
  const recorder = new TaskRecorder({
    taskId: "task-1",
    sessionId: "session-1",
    mode: "analytics",
    detection: { slowCallMs: 5_000 },
    now: () => time,
    wallNow: () => new Date(1_700_000_000_000 + time),
  });

  time = 100;
  recorder.startTool("a", classified("read", "a"));
  time = 200;
  recorder.startTool("b", classified("grep", "b"));
  time = 500;
  recorder.finishTool("a", { isError: false, resultKind: "nonempty" });
  time = 700;
  recorder.finishTool("b", { isError: false, resultKind: "nonempty" });
  time = 1_000;
  const trace = recorder.finish();

  assert.equal(trace.taskWallMs, 1_000);
  assert.equal(trace.toolWallMs, 600);
  assert.equal(trace.toolCallMs, 900);
  assert.deepEqual(trace.calls.map((call) => [call.startOffsetMs, call.durationMs]), [[100, 400], [200, 500]]);
});

test("persists fingerprints and classifications without raw arguments", () => {
  let time = 0;
  const secret = "secret-token-value";
  const command = `curl -H 'Authorization: Bearer ${secret}' https://example.com`;
  const recorder = new TaskRecorder({
    sessionId: "session-1",
    mode: "analytics",
    detection: { slowCallMs: 5_000 },
    now: () => time,
    wallNow: () => new Date(1_700_000_000_000 + time),
  });

  time = 10;
  recorder.startTool("call", classifyToolCall("bash", { command }, "/project"));
  time = 50;
  recorder.finishTool("call", { isError: false, resultKind: "nonempty" });
  time = 100;
  const serialized = JSON.stringify(recorder.finish());

  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(command), false);
  assert.match(serialized, /"family":"web"/u);
});

test("closes unfinished calls when a task aborts", () => {
  let time = 0;
  const recorder = new TaskRecorder({
    sessionId: "session-1",
    mode: "analytics",
    detection: { slowCallMs: 5_000 },
    now: () => time,
    wallNow: () => new Date(1_700_000_000_000 + time),
  });

  time = 25;
  recorder.startTool("call", classified("bash", "call"));
  time = 125;
  const trace = recorder.finish("aborted");

  assert.equal(trace.outcome, "aborted");
  assert.equal(trace.calls[0]?.durationMs, 100);
  assert.equal(trace.calls[0]?.isError, true);
});
