import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  detectEfficiencyFindings,
  suspectedWasteDurationMs,
  unionDurationMs,
  type Interval,
} from "./detect.ts";
import { normalizeGuidanceId } from "./policy.ts";
import { sanitizeClassification } from "./sanitize.ts";
import type {
  ClassifiedToolCall,
  DetectionOptions,
  GuidanceId,
  TaskIntent,
  TaskOutcome,
  TaskTrace,
  ToolCallSpan,
  ToolResultKind,
  TooltimeMode,
} from "./types.ts";

interface ActiveToolCall {
  classification: ClassifiedToolCall;
  sequence: number;
  startedMs: number;
}

export interface TaskRecorderOptions {
  sessionId: string;
  mode: TooltimeMode;
  intent?: TaskIntent;
  policyVersion?: string;
  injectedRuleIds?: readonly string[];
  detection: DetectionOptions;
  maxCalls?: number;
  taskId?: string;
  now?: () => number;
  wallNow?: () => Date;
}

export interface FinishToolInput {
  isError: boolean;
  resultKind: ToolResultKind;
}

export class TaskRecorder {
  private readonly taskId: string;
  private readonly sessionId: string;
  private readonly mode: TooltimeMode;
  private readonly intent: TaskIntent | undefined;
  private readonly policyVersion: string | undefined;
  private readonly injectedRuleIds: GuidanceId[];
  private readonly detection: DetectionOptions;
  private readonly maxCalls: number;
  private readonly now: () => number;
  private readonly wallNow: () => Date;
  private readonly startedMs: number;
  private readonly startedAt: Date;
  private readonly active = new Map<string, ActiveToolCall>();
  private readonly calls: ToolCallSpan[] = [];
  private readonly intervals: Interval[] = [];
  private sequence = 0;
  private toolCallMs = 0;
  private droppedCallCount = 0;
  private trace: TaskTrace | undefined;

  constructor(options: TaskRecorderOptions) {
    this.taskId = options.taskId ?? randomUUID();
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    this.intent = options.intent;
    this.policyVersion = options.policyVersion;
    this.injectedRuleIds = [...new Set((options.injectedRuleIds ?? []).map(normalizeGuidanceId).filter((id) => id !== undefined))];
    this.detection = { slowCallMs: options.detection.slowCallMs };
    const maxCalls = options.maxCalls ?? 500;
    this.maxCalls = Number.isSafeInteger(maxCalls) && maxCalls > 0 ? Math.min(maxCalls, 5_000) : 500;
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? (() => new Date());
    this.startedMs = this.now();
    this.startedAt = this.wallNow();
  }

  startTool(toolCallId: string, classification: ClassifiedToolCall): void {
    if (this.trace) return;
    if (this.active.has(toolCallId)) {
      this.finishTool(toolCallId, { isError: true, resultKind: "error" });
    }
    const startedMs = this.now();
    this.sequence++;
    this.active.set(toolCallId, {
      classification: sanitizeClassification(classification),
      sequence: this.sequence,
      startedMs,
    });
  }

  updateTool(toolCallId: string, classification: ClassifiedToolCall): void {
    const active = this.active.get(toolCallId);
    if (!active || this.trace) return;
    active.classification = sanitizeClassification(classification);
  }

  finishTool(toolCallId: string, input: FinishToolInput): void {
    if (this.trace) return;
    const active = this.active.get(toolCallId);
    if (!active) return;
    const completedMs = this.now();
    this.active.delete(toolCallId);
    this.complete(active, input, completedMs);
  }

  private complete(active: ActiveToolCall, input: FinishToolInput, completedMs: number): void {
    const startOffsetMs = Math.max(0, active.startedMs - this.startedMs);
    const durationMs = Math.max(0, Math.round(completedMs - active.startedMs));
    const interval = { startMs: startOffsetMs, endMs: startOffsetMs + durationMs };
    this.intervals.push(interval);
    this.toolCallMs += durationMs;

    if (this.calls.length >= this.maxCalls) {
      this.droppedCallCount++;
      return;
    }

    this.calls.push({
      ...active.classification,
      sequence: active.sequence,
      startOffsetMs: Math.round(startOffsetMs),
      durationMs,
      isError: input.isError,
      resultKind: input.resultKind,
    });
  }

  finish(outcome: TaskOutcome = "completed"): TaskTrace {
    if (this.trace) return this.trace;
    const completedMs = this.now();
    const completedAt = this.wallNow();
    for (const active of this.active.values()) {
      this.complete(active, { isError: true, resultKind: "error" }, completedMs);
    }
    this.active.clear();

    const calls = [...this.calls].sort((a, b) => a.sequence - b.sequence);
    const findings = detectEfficiencyFindings(calls, this.intent, this.detection);
    const trace: TaskTrace = {
      schemaVersion: 1,
      taskId: this.taskId,
      sessionId: this.sessionId,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome,
      mode: this.mode,
      ...(this.intent ? { intent: this.intent } : {}),
      ...(this.policyVersion ? { policyVersion: this.policyVersion } : {}),
      injectedRuleIds: [...this.injectedRuleIds],
      taskWallMs: Math.max(0, Math.round(completedMs - this.startedMs)),
      toolWallMs: unionDurationMs(this.intervals),
      toolCallMs: Math.round(this.toolCallMs),
      suspectedWasteMs: suspectedWasteDurationMs(calls, findings),
      calls,
      findings,
      droppedCallCount: this.droppedCallCount,
    };
    this.trace = trace;
    return trace;
  }
}
