import type { TaskTrace, TraceAnalysis } from "./types.js";
export declare function analyzeTaskTraces(traces: readonly TaskTrace[]): TraceAnalysis;
export declare function recentTraces(traces: readonly TaskTrace[], days: number, now?: number): TaskTrace[];
