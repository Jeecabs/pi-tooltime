import { sanitizeTaskTrace } from "./sanitize.ts";
import type {
  FindingAggregate,
  ModeSummary,
  TaskTrace,
  ToolSummary,
  TraceAnalysis,
} from "./types.ts";

export function analyzeTraces(traces: readonly TaskTrace[]): TraceAnalysis {
  const findingGroups = new Map<string, FindingAggregate & { taskIds: Set<string> }>();
  const toolGroups = new Map<string, ToolSummary>();
  const modeGroups = new Map<string, ModeSummary>();
  let callCount = 0;
  let failureCount = 0;

  const safeTraces = traces.map(sanitizeTaskTrace).filter((trace) => trace !== undefined);
  for (const trace of safeTraces) {
    callCount += trace.calls.length + trace.droppedCallCount;
    failureCount += trace.calls.filter((call) => call.isError).length;

    const mode = modeGroups.get(trace.mode) ?? {
      mode: trace.mode,
      taskCount: 0,
      taskWallMs: 0,
      toolWallMs: 0,
      toolCallMs: 0,
      suspectedWasteMs: 0,
    };
    mode.taskCount++;
    mode.taskWallMs += trace.taskWallMs;
    mode.toolWallMs += trace.toolWallMs;
    mode.toolCallMs += trace.toolCallMs;
    mode.suspectedWasteMs += trace.suspectedWasteMs;
    modeGroups.set(trace.mode, mode);

    for (const call of trace.calls) {
      const tool = toolGroups.get(call.toolName) ?? {
        toolName: call.toolName,
        callCount: 0,
        failureCount: 0,
        callMs: 0,
      };
      tool.callCount++;
      tool.failureCount += call.isError ? 1 : 0;
      tool.callMs += call.durationMs;
      toolGroups.set(call.toolName, tool);
    }

    for (const finding of trace.findings) {
      const groupKey = `${finding.signature}:${finding.confidence}`;
      const group = findingGroups.get(groupKey) ?? {
        code: finding.code,
        signature: finding.signature,
        confidence: finding.confidence,
        guidanceId: finding.guidanceId,
        guidance: finding.guidance,
        taskCount: 0,
        occurrenceCount: 0,
        totalWasteMs: 0,
        lastSeenAt: trace.completedAt,
        taskIds: new Set<string>(),
      };
      group.occurrenceCount++;
      group.totalWasteMs += finding.suspectedWasteMs;
      group.taskIds.add(trace.taskId);
      if (Date.parse(trace.completedAt) > Date.parse(group.lastSeenAt)) group.lastSeenAt = trace.completedAt;
      findingGroups.set(groupKey, group);
    }
  }

  const findings = [...findingGroups.values()].map(({ taskIds, ...group }) => ({
    ...group,
    taskCount: taskIds.size,
  })).sort((a, b) => b.totalWasteMs - a.totalWasteMs || b.taskCount - a.taskCount || a.code.localeCompare(b.code));

  return {
    taskCount: safeTraces.length,
    taskWallMs: safeTraces.reduce((total, trace) => total + trace.taskWallMs, 0),
    toolWallMs: safeTraces.reduce((total, trace) => total + trace.toolWallMs, 0),
    toolCallMs: safeTraces.reduce((total, trace) => total + trace.toolCallMs, 0),
    suspectedWasteMs: safeTraces.reduce((total, trace) => total + trace.suspectedWasteMs, 0),
    callCount,
    failureCount,
    tools: [...toolGroups.values()].sort((a, b) => b.callMs - a.callMs || b.callCount - a.callCount || a.toolName.localeCompare(b.toolName)),
    findings,
    modes: [...modeGroups.values()].sort((a, b) => a.mode.localeCompare(b.mode)),
  };
}

export function recentTraces(traces: readonly TaskTrace[], days: number, now = Date.now()): TaskTrace[] {
  const cutoff = now - Math.max(0, days) * 24 * 60 * 60 * 1_000;
  return traces.flatMap((trace) => {
    const sanitized = sanitizeTaskTrace(trace);
    return sanitized && Date.parse(sanitized.completedAt) >= cutoff ? [sanitized] : [];
  });
}
