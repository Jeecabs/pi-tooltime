import { compareText } from "./order.ts";
import { sanitizeTaskTrace } from "./sanitize.ts";
import type {
  EfficiencyFindingCode,
  FindingConfidence,
  GuidanceId,
  TaskTrace,
  ToolName,
  TooltimeMode,
  TraceAnalysis,
} from "./types.ts";

interface FindingAccumulator {
  code: EfficiencyFindingCode;
  signature: EfficiencyFindingCode;
  confidence: FindingConfidence;
  guidanceId: GuidanceId;
  guidance: string;
  taskCount: number;
  occurrenceCount: number;
  totalWasteMs: number;
  lastSeenAt: string;
}

interface ToolAccumulator {
  toolName: ToolName;
  callCount: number;
  failureCount: number;
  callMs: number;
}

interface ModeAccumulator {
  mode: TooltimeMode;
  taskCount: number;
  taskWallMs: number;
  toolWallMs: number;
  toolCallMs: number;
  suspectedWasteMs: number;
}

function addMode(groups: Map<string, ModeAccumulator>, trace: TaskTrace): void {
  const mode = groups.get(trace.mode) ?? {
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
  groups.set(trace.mode, mode);
}

function addTools(groups: Map<string, ToolAccumulator>, trace: TaskTrace): void {
  for (const call of trace.calls) {
    const tool = groups.get(call.toolName) ?? {
      toolName: call.toolName,
      callCount: 0,
      failureCount: 0,
      callMs: 0,
    };
    tool.callCount++;
    tool.failureCount += call.isError ? 1 : 0;
    tool.callMs += call.durationMs;
    groups.set(call.toolName, tool);
  }
}

function addFindings(groups: Map<string, FindingAccumulator>, trace: TaskTrace): void {
  const taskGroups = new Set<string>();
  for (const finding of trace.findings) {
    const key = `${finding.signature}:${finding.confidence}`;
    const group = groups.get(key) ?? {
      code: finding.code,
      signature: finding.signature,
      confidence: finding.confidence,
      guidanceId: finding.guidanceId,
      guidance: finding.guidance,
      taskCount: 0,
      occurrenceCount: 0,
      totalWasteMs: 0,
      lastSeenAt: trace.completedAt,
    };
    group.occurrenceCount++;
    group.totalWasteMs += finding.suspectedWasteMs;
    if (!taskGroups.has(key)) {
      group.taskCount++;
      taskGroups.add(key);
    }
    if (Date.parse(trace.completedAt) > Date.parse(group.lastSeenAt)) group.lastSeenAt = trace.completedAt;
    groups.set(key, group);
  }
}

export function analyzeTaskTraces(traces: readonly TaskTrace[]): TraceAnalysis {
  const findingGroups = new Map<string, FindingAccumulator>();
  const toolGroups = new Map<string, ToolAccumulator>();
  const modeGroups = new Map<string, ModeAccumulator>();
  const safeTraces = traces.map(sanitizeTaskTrace).filter((trace) => trace !== undefined);
  for (const trace of safeTraces) {
    addMode(modeGroups, trace);
    addTools(toolGroups, trace);
    addFindings(findingGroups, trace);
  }

  const findings = [...findingGroups.values()].sort((a, b) =>
    b.totalWasteMs - a.totalWasteMs
    || b.taskCount - a.taskCount
    || compareText(a.code, b.code)
    || (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1)
  );

  return {
    taskCount: safeTraces.length,
    taskWallMs: safeTraces.reduce((total, trace) => total + trace.taskWallMs, 0),
    toolWallMs: safeTraces.reduce((total, trace) => total + trace.toolWallMs, 0),
    toolCallMs: safeTraces.reduce((total, trace) => total + trace.toolCallMs, 0),
    suspectedWasteMs: safeTraces.reduce((total, trace) => total + trace.suspectedWasteMs, 0),
    callCount: safeTraces.reduce((total, trace) => total + trace.calls.length + trace.droppedCallCount, 0),
    failureCount: safeTraces.reduce((total, trace) => total + trace.calls.filter((call) => call.isError).length, 0),
    tools: [...toolGroups.values()].sort((a, b) => b.callMs - a.callMs || b.callCount - a.callCount || compareText(a.toolName, b.toolName)),
    findings,
    modes: [...modeGroups.values()].sort((a, b) => compareText(a.mode, b.mode)),
    rejectedTraceCount: traces.length - safeTraces.length,
    droppedCallCount: safeTraces.reduce((total, trace) => total + trace.droppedCallCount, 0),
  };
}

export function recentTraces(traces: readonly TaskTrace[], days: number, now = Date.now()): TaskTrace[] {
  const cutoff = now - Math.max(0, days) * 24 * 60 * 60 * 1_000;
  return traces.flatMap((trace) => {
    const sanitized = sanitizeTaskTrace(trace);
    return sanitized && Date.parse(sanitized.completedAt) >= cutoff ? [sanitized] : [];
  });
}
