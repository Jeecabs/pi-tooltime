import type { DetectionOptions, EfficiencyFinding, TaskIntent, ToolCallSpan } from "./types.js";
export interface Interval {
    startMs: number;
    endMs: number;
}
export declare function unionDurationMs(intervals: readonly Interval[]): number;
export declare function detectEfficiencyFindings(calls: readonly ToolCallSpan[], intent: TaskIntent | undefined, options: DetectionOptions): EfficiencyFinding[];
export declare function suspectedWasteDurationMs(calls: readonly ToolCallSpan[], findings: readonly EfficiencyFinding[]): number;
