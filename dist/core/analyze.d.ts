import type { TaskTrace, TraceAnalysis } from "./types.ts";
export declare function analyzeTraces(traces: readonly TaskTrace[]): TraceAnalysis;
export declare function recentTraces(traces: readonly TaskTrace[], days: number, now?: number): TaskTrace[];
