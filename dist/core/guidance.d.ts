import type { FindingAggregate, GuidancePrompt, TaskTrace } from "./types.js";
export interface GuidanceOptions {
    minTasks: number;
    minTotalDurationMs: number;
    maxPromptChars: number;
    maxPromptRules: number;
    includeBaselineGuidance: boolean;
}
export declare function eligibleFindingAggregates(findings: readonly FindingAggregate[], options: GuidanceOptions): FindingAggregate[];
export declare function buildGuidancePrompt(traces: readonly TaskTrace[], options: GuidanceOptions): GuidancePrompt;
