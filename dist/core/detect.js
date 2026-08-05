import { guidanceFor } from "./policy.js";
export function unionDurationMs(intervals) {
    const sorted = intervals
        .map((interval) => ({
        startMs: Math.max(0, interval.startMs),
        endMs: Math.max(Math.max(0, interval.startMs), interval.endMs),
    }))
        .filter((interval) => interval.endMs > interval.startMs)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    if (sorted.length === 0)
        return 0;
    let total = 0;
    let start = sorted[0].startMs;
    let end = sorted[0].endMs;
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
function callIntervals(calls, sequences) {
    const selected = new Set(sequences);
    return calls
        .filter((call) => selected.has(call.sequence))
        .map((call) => ({ startMs: call.startOffsetMs, endMs: call.startOffsetMs + call.durationMs }));
}
export function callUnionDurationMs(calls, sequences) {
    return unionDurationMs(callIntervals(calls, sequences));
}
function mutationsBetween(calls, from, to) {
    return calls.some((call) => call.sequence > from && call.sequence < to && call.mutates);
}
function repeatedCallFindings(calls, options) {
    const lastByFingerprint = new Map();
    const repeated = [];
    const minimumDuration = Math.min(2_000, options.slowCallMs);
    for (const call of calls) {
        const previous = lastByFingerprint.get(call.fingerprint);
        lastByFingerprint.set(call.fingerprint, call);
        if (!previous || call.durationMs < minimumDuration)
            continue;
        if (previous.mutates || call.mutates)
            continue;
        if (mutationsBetween(calls, previous.sequence, call.sequence))
            continue;
        repeated.push(call.sequence);
    }
    if (repeated.length === 0)
        return [];
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
function fullSuiteFinding(calls) {
    const fullTests = calls.filter((call) => call.operation === "test-full" && !call.mutates);
    if (fullTests.length < 2)
        return undefined;
    const repeated = [];
    for (let index = 1; index < fullTests.length; index++) {
        const previous = fullTests[index - 1];
        const current = fullTests[index];
        if (current.fingerprint === previous.fingerprint || mutationsBetween(calls, previous.sequence, current.sequence)) {
            repeated.push(current.sequence);
        }
    }
    if (repeated.length === 0)
        return undefined;
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
function broadSearchFindings(calls) {
    return calls
        .filter((call) => ["search", "analyze"].includes(call.operation) && ["root", "outside"].includes(call.scope ?? ""))
        .map((call) => ({
        code: "search.broad-scope",
        signature: "search.broad-scope",
        confidence: call.scope === "root" ? "high" : "medium",
        callSequences: [call.sequence],
        suspectedWasteMs: call.durationMs,
        guidanceId: "target-first",
        guidance: guidanceFor("target-first"),
    }));
}
function slowEmptyFindings(calls, options) {
    return calls
        .filter((call) => call.operation === "search" && call.durationMs >= options.slowCallMs && ["empty", "error"].includes(call.resultKind))
        .map((call) => ({
        code: "search.slow-empty",
        signature: "search.slow-empty",
        confidence: "medium",
        callSequences: [call.sequence],
        suspectedWasteMs: call.durationMs,
        guidanceId: "reassess-after-empty",
        guidance: guidanceFor("reassess-after-empty"),
    }));
}
function routeFinding(calls, intent) {
    if (!intent)
        return undefined;
    const expectedIndex = calls.findIndex((call) => call.family === intent);
    const beforeExpected = expectedIndex < 0 ? calls : calls.slice(0, expectedIndex);
    let wrong = [];
    let code;
    if (intent === "web") {
        wrong = beforeExpected.filter((call) => call.family === "repository" && ["search", "analyze"].includes(call.operation));
        code = "route.explicit-web-local-search";
    }
    else if (intent === "database") {
        wrong = beforeExpected.filter((call) => call.family === "repository" && ["search", "analyze"].includes(call.operation));
        code = "route.explicit-database-local-search";
    }
    else {
        wrong = beforeExpected.filter((call) => call.family === "database" && call.operation === "query");
        code = "route.explicit-repository-database-query";
    }
    if (wrong.length === 0)
        return undefined;
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
export function detectEfficiencyFindings(calls, intent, options) {
    const sorted = [...calls].sort((a, b) => a.sequence - b.sequence);
    const findings = [
        ...repeatedCallFindings(sorted, options),
        fullSuiteFinding(sorted),
        ...broadSearchFindings(sorted),
        ...slowEmptyFindings(sorted, options),
        routeFinding(sorted, intent),
    ].filter((finding) => finding !== undefined);
    return findings.sort((a, b) => b.suspectedWasteMs - a.suspectedWasteMs || a.code.localeCompare(b.code));
}
export function suspectedWasteDurationMs(calls, findings) {
    const sequences = [...new Set(findings.flatMap((finding) => finding.callSequences))];
    return callUnionDurationMs(calls, sequences);
}
