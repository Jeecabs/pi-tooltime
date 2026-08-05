import { type GuidanceOptions } from "./guidance.js";
import type { TraceAnalysis } from "./types.js";
export declare function formatTraceAnalysis(analysis: TraceAnalysis, title?: string): string;
export declare function formatTraceAnalysisForModel(analysis: TraceAnalysis, title?: string): string;
export declare function formatFindingCandidates(analysis: TraceAnalysis, options: GuidanceOptions): string;
