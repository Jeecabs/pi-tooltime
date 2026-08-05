import { type GuidanceOptions } from "./guidance.ts";
import type { TraceAnalysis } from "./types.ts";
export declare function formatDuration(ms: number): string;
export declare function formatTraceAnalysis(analysis: TraceAnalysis, title?: string): string;
export declare function formatTraceAnalysisForModel(analysis: TraceAnalysis, title?: string): string;
export declare function formatFindingCandidates(analysis: TraceAnalysis, options: GuidanceOptions): string;
