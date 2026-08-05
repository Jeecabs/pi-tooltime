import type { TaskIntent, TaskOutcome, TaskTrace, TraceAnalysis } from "./types.js";
export interface TooltimeClock {
    monotonicNow(): number;
    wallNow(): Date;
}
export interface RecorderOptions {
    readonly sessionId: string;
    readonly taskId?: string;
    readonly cwd?: string;
    readonly mode?: "analytics" | "coach";
    readonly prompt?: string;
    readonly intent?: TaskIntent;
    readonly slowCallMs?: number;
    readonly maxCalls?: number;
    readonly clock?: TooltimeClock;
}
export type ToolEvent = Readonly<{
    type: "start";
    callId: string;
    toolName: string;
    input?: unknown;
}> | Readonly<{
    type: "update";
    callId: string;
    toolName?: string;
    input?: unknown;
}> | Readonly<{
    type: "finish";
    callId: string;
    result?: unknown;
    isError: boolean;
}>;
export type LifecycleErrorCode = "duplicate-call" | "unknown-call" | "task-finished" | "call-limit";
export declare class TooltimeLifecycleError extends Error {
    readonly code: LifecycleErrorCode;
    constructor(code: LifecycleErrorCode);
}
export interface TaskRecorder {
    record(event: ToolEvent): void;
    finish(outcome?: TaskOutcome): TaskTrace;
}
export type DecodeIssueCode = "invalid-trace" | "unsupported-schema" | "normalized-trace" | "inconsistent-trace";
export interface DecodeIssue {
    readonly code: DecodeIssueCode;
}
export type DecodeTaskTraceResult = Readonly<{
    ok: true;
    value: TaskTrace;
    warnings: readonly DecodeIssue[];
}> | Readonly<{
    ok: false;
    issues: readonly DecodeIssue[];
}>;
export type FormatAnalysisOptions = Readonly<{
    audience: "human";
    title?: string;
}> | Readonly<{
    audience: "model";
}>;
export declare function decodeTaskTrace(value: unknown): DecodeTaskTraceResult;
export declare function createTaskRecorder(options: RecorderOptions): TaskRecorder;
export declare function analyzeTraces(traces: Iterable<unknown>): TraceAnalysis;
export declare function formatAnalysis(analysis: TraceAnalysis, options: FormatAnalysisOptions): string;
