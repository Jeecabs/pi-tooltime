import { compareText } from "./order.ts";
import { guidanceFor } from "./policy.ts";
import type {
  DetectionOptions,
  EfficiencyFinding,
  TaskIntent,
  ToolCallSpan,
} from "./types.ts";

export interface Interval {
  startMs: number;
  endMs: number;
}

export function unionDurationMs(intervals: readonly Interval[]): number {
  const sorted = intervals
    .map((interval) => ({
      startMs: Math.max(0, interval.startMs),
      endMs: Math.max(Math.max(0, interval.startMs), interval.endMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (sorted.length === 0) return 0;

  let total = 0;
  let start = sorted[0]!.startMs;
  let end = sorted[0]!.endMs;
  for (const interval of sorted.slice(1)) {
    if (interval.startMs <= end) {
      end = Math.max(end, interval.endMs);
      continue;
    }
    total += end - start;
    start = interval.startMs;
    end = interval.endMs;
  }
  return Math.round(total + end - start);
}

function callIntervals(calls: readonly ToolCallSpan[], sequences: readonly number[]): Interval[] {
  const selected = new Set(sequences);
  return calls
    .filter((call) => selected.has(call.sequence))
    .map((call) => ({ startMs: call.startOffsetMs, endMs: call.startOffsetMs + call.durationMs }));
}

function callUnionDurationMs(calls: readonly ToolCallSpan[], sequences: readonly number[]): number {
  return unionDurationMs(callIntervals(calls, sequences));
}

function mutationPrefix(calls: readonly ToolCallSpan[]): number[] {
  const prefix = [0];
  for (const call of calls) prefix.push(prefix[prefix.length - 1]! + (call.mutates ? 1 : 0));
  return prefix;
}

function mutationsBetween(prefix: readonly number[], fromIndex: number, toIndex: number): boolean {
  return prefix[toIndex]! > prefix[fromIndex + 1]!;
}

function repeatedCallFindings(
  calls: readonly ToolCallSpan[],
  options: DetectionOptions,
  mutations: readonly number[],
): EfficiencyFinding[] {
  const lastByFingerprint = new Map<string, { call: ToolCallSpan; index: number }>();
  const repeated: number[] = [];
  const minimumDuration = Math.min(2_000, options.slowCallMs);

  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]!;
    const previous = lastByFingerprint.get(call.fingerprint);
    lastByFingerprint.set(call.fingerprint, { call, index });
    if (!previous || call.durationMs < minimumDuration) continue;
    if (previous.call.mutates || call.mutates) continue;
    if (mutationsBetween(mutations, previous.index, index)) continue;
    repeated.push(call.sequence);
  }

  if (repeated.length === 0) return [];
  return [{
    code: "repeat.expensive-identical",
    signature: "repeat.expensive-identical",
    confidence: "high",
    callSequences: repeated,
    suspectedWasteMs: callUnionDurationMs(calls, repeated),
    guidanceId: "avoid-repeat",
    guidance: guidanceFor("avoid-repeat"),
  }];
}

function fullSuiteFinding(calls: readonly ToolCallSpan[], mutations: readonly number[]): EfficiencyFinding | undefined {
  const fullTests = calls.flatMap((call, index) =>
    call.operation === "test-full" && !call.mutates ? [{ call, index }] : []
  );
  if (fullTests.length < 2) return undefined;

  const repeated: number[] = [];
  for (let index = 1; index < fullTests.length; index++) {
    const previous = fullTests[index - 1]!;
    const current = fullTests[index]!;
    if (current.call.fingerprint === previous.call.fingerprint || mutationsBetween(mutations, previous.index, current.index)) {
      repeated.push(current.call.sequence);
    }
  }
  if (repeated.length === 0) return undefined;

  return {
    code: "test.full-suite-loop",
    signature: "test.full-suite-loop",
    confidence: "high",
    callSequences: repeated,
    suspectedWasteMs: callUnionDurationMs(calls, repeated),
    guidanceId: "targeted-validation",
    guidance: guidanceFor("targeted-validation"),
  };
}

function broadSearchFindings(calls: readonly ToolCallSpan[]): EfficiencyFinding[] {
  return calls
    .filter((call) => ["search", "analyze"].includes(call.operation) && ["root", "outside"].includes(call.scope ?? ""))
    .map((call) => ({
      code: "search.broad-scope",
      signature: "search.broad-scope",
      confidence: call.scope === "root" ? "high" as const : "medium" as const,
      callSequences: [call.sequence],
      suspectedWasteMs: call.durationMs,
      guidanceId: "target-first",
      guidance: guidanceFor("target-first"),
    }));
}

function slowEmptyFindings(calls: readonly ToolCallSpan[], options: DetectionOptions): EfficiencyFinding[] {
  return calls
    .filter((call) => call.operation === "search" && call.durationMs >= options.slowCallMs && ["empty", "error"].includes(call.resultKind))
    .map((call) => ({
      code: "search.slow-empty",
      signature: "search.slow-empty",
      confidence: "medium" as const,
      callSequences: [call.sequence],
      suspectedWasteMs: call.durationMs,
      guidanceId: "reassess-after-empty",
      guidance: guidanceFor("reassess-after-empty"),
    }));
}

function routeFinding(calls: readonly ToolCallSpan[], intent: TaskIntent | undefined): EfficiencyFinding | undefined {
  if (!intent) return undefined;

  const expectedIndex = calls.findIndex((call) => call.family === intent);
  const beforeExpected = expectedIndex < 0 ? calls : calls.slice(0, expectedIndex);
  let wrong: ToolCallSpan[] = [];
  let code: EfficiencyFinding["code"];

  if (intent === "web") {
    wrong = beforeExpected.filter((call) => call.family === "repository" && ["search", "analyze"].includes(call.operation));
    code = "route.explicit-web-local-search";
  } else if (intent === "database") {
    wrong = beforeExpected.filter((call) => call.family === "repository" && ["search", "analyze"].includes(call.operation));
    code = "route.explicit-database-local-search";
  } else {
    wrong = beforeExpected.filter((call) => call.family === "database" && call.operation === "query");
    code = "route.explicit-repository-database-query";
  }

  if (wrong.length === 0) return undefined;
  const sequences = wrong.map((call) => call.sequence);
  return {
    code,
    signature: code,
    confidence: "high",
    callSequences: sequences,
    suspectedWasteMs: callUnionDurationMs(calls, sequences),
    guidanceId: "source-routing",
    guidance: guidanceFor("source-routing"),
  };
}

export function detectEfficiencyFindings(
  calls: readonly ToolCallSpan[],
  intent: TaskIntent | undefined,
  options: DetectionOptions,
): EfficiencyFinding[] {
  const sorted = [...calls].sort((a, b) => a.sequence - b.sequence);
  const mutations = mutationPrefix(sorted);
  const findings = [
    ...repeatedCallFindings(sorted, options, mutations),
    fullSuiteFinding(sorted, mutations),
    ...broadSearchFindings(sorted),
    ...slowEmptyFindings(sorted, options),
    routeFinding(sorted, intent),
  ].filter((finding): finding is EfficiencyFinding => finding !== undefined);

  return findings.sort((a, b) => b.suspectedWasteMs - a.suspectedWasteMs || compareText(a.code, b.code));
}

export function suspectedWasteDurationMs(calls: readonly ToolCallSpan[], findings: readonly EfficiencyFinding[]): number {
  const sequences = [...new Set(findings.flatMap((finding) => finding.callSequences))];
  return callUnionDurationMs(calls, sequences);
}
