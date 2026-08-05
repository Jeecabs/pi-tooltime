import type { FindingAggregate, GuidancePrompt, GuidanceRule, TaskTrace } from "./types.ts";
export interface GuidanceOptions {
    minTasks: number;
    minTotalDurationMs: number;
    maxPromptChars: number;
    maxPromptRules: number;
    includeBaselineGuidance: boolean;
}
declare const BASELINE_RULES: readonly GuidanceRule[];
export declare function eligibleFindingAggregates(findings: readonly FindingAggregate[], options: GuidanceOptions): FindingAggregate[];
export declare function buildGuidancePrompt(traces: readonly TaskTrace[], options: GuidanceOptions): GuidancePrompt;
export { BASELINE_RULES };
