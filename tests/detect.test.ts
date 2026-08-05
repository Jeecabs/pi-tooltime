import assert from "node:assert/strict";
import test from "node:test";

import { detectEfficiencyFindings, unionDurationMs } from "../src/core/detect.ts";
import type { ToolCallSpan } from "../src/core/types.ts";

function call(over: Partial<ToolCallSpan> & Pick<ToolCallSpan, "sequence" | "toolName" | "fingerprint">): ToolCallSpan {
  return {
    family: "repository",
    operation: "read",
    scope: "targeted",
    mutates: false,
    startOffsetMs: over.sequence * 1_000,
    durationMs: 6_000,
    isError: false,
    resultKind: "nonempty",
    ...over,
  };
}

test("unions overlapping intervals", () => {
  assert.equal(unionDurationMs([
    { startMs: 0, endMs: 10 },
    { startMs: 5, endMs: 20 },
    { startMs: 30, endMs: 35 },
  ]), 25);
});

test("detects repeated full suites after edits", () => {
  const calls = [
    call({ sequence: 1, toolName: "bash", fingerprint: "test", family: "test", operation: "test-full", scope: "full", durationMs: 20_000 }),
    call({ sequence: 2, toolName: "edit", fingerprint: "edit", operation: "mutate", mutates: true, durationMs: 10 }),
    call({ sequence: 3, toolName: "bash", fingerprint: "test", family: "test", operation: "test-full", scope: "full", durationMs: 25_000 }),
  ];
  const findings = detectEfficiencyFindings(calls, undefined, { slowCallMs: 5_000 });
  const finding = findings.find((item) => item.code === "test.full-suite-loop");

  assert.deepEqual(finding?.callSequences, [3]);
  assert.equal(finding?.suspectedWasteMs, 25_000);
});

test("does not flag full test commands that also mutate", () => {
  const findings = detectEfficiencyFindings([
    call({ sequence: 1, toolName: "bash", fingerprint: "test", family: "test", operation: "test-full", scope: "full", durationMs: 20_000, mutates: true }),
    call({ sequence: 2, toolName: "bash", fingerprint: "test", family: "test", operation: "test-full", scope: "full", durationMs: 25_000, mutates: true }),
  ], undefined, { slowCallMs: 5_000 });

  assert.equal(findings.some((finding) => finding.code === "test.full-suite-loop"), false);
});

test("detects an explicit web request routed through local search", () => {
  const calls = [
    call({ sequence: 1, toolName: "grep", fingerprint: "grep", operation: "search", family: "repository", durationMs: 8_000 }),
    call({ sequence: 2, toolName: "browser_read", fingerprint: "web", operation: "read", family: "web", durationMs: 1_000 }),
  ];
  const findings = detectEfficiencyFindings(calls, "web", { slowCallMs: 5_000 });

  assert.equal(findings.some((item) => item.code === "route.explicit-web-local-search"), true);
});

test("keeps slow empty searches as medium-confidence evidence", () => {
  const findings = detectEfficiencyFindings([
    call({ sequence: 1, toolName: "grep", fingerprint: "grep", operation: "search", resultKind: "empty", durationMs: 10_000 }),
  ], undefined, { slowCallMs: 5_000 });

  assert.equal(findings[0]?.code, "search.slow-empty");
  assert.equal(findings[0]?.confidence, "medium");
});

test("does not call one necessary slow result waste", () => {
  const findings = detectEfficiencyFindings([
    call({ sequence: 1, toolName: "bash", fingerprint: "test", family: "test", operation: "test-full", scope: "full", durationMs: 60_000 }),
  ], undefined, { slowCallMs: 5_000 });

  assert.deepEqual(findings, []);
});

test("does not classify repeated mutating calls as unchanged work", () => {
  const findings = detectEfficiencyFindings([
    call({ sequence: 1, toolName: "notion_page", fingerprint: "same", family: "other", operation: "mutate", mutates: true }),
    call({ sequence: 2, toolName: "notion_page", fingerprint: "same", family: "other", operation: "mutate", mutates: true }),
  ], undefined, { slowCallMs: 5_000 });

  assert.equal(findings.some((finding) => finding.code === "repeat.expensive-identical"), false);
});
