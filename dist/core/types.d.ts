export type TooltimeMode = "off" | "analytics" | "coach";
export type ToolFamily = "repository" | "web" | "database" | "issues" | "process" | "test" | "shell" | "other";
export type TaskIntent = "repository" | "web" | "database";
export type ToolScope = "targeted" | "project" | "outside" | "root" | "full" | "unknown";
export type ToolResultKind = "nonempty" | "empty" | "error" | "unknown";
export type ToolName = string;
export type ToolOperation = "read" | "search" | "analyze" | "mutate" | "interact" | "query" | "request" | "command" | "test-targeted" | "test-full" | "report" | "unknown";
export type EfficiencyFindingCode = "repeat.expensive-identical" | "test.full-suite-loop" | "search.broad-scope" | "search.slow-empty" | "route.explicit-web-local-search" | "route.explicit-database-local-search" | "route.explicit-repository-database-query";
export type GuidanceId = "avoid-repeat" | "targeted-validation" | "target-first" | "reassess-after-empty" | "source-routing";
export type FindingConfidence = "high" | "medium";
export type TaskOutcome = "completed" | "error" | "aborted";
export interface ClassifiedToolCall {
    readonly toolName: ToolName;
    readonly fingerprint: string;
    readonly family: ToolFamily;
    readonly operation: ToolOperation;
    readonly scope?: ToolScope;
    readonly mutates: boolean;
}
export interface ToolCallSpan extends ClassifiedToolCall {
    readonly sequence: number;
    readonly startOffsetMs: number;
    readonly durationMs: number;
    readonly isError: boolean;
    readonly resultKind: ToolResultKind;
}
export interface EfficiencyFinding {
    readonly code: EfficiencyFindingCode;
    readonly signature: EfficiencyFindingCode;
    readonly confidence: FindingConfidence;
    readonly callSequences: readonly number[];
    readonly suspectedWasteMs: number;
    readonly guidanceId: GuidanceId;
    readonly guidance: string;
}
export interface TaskTrace {
    readonly schemaVersion: 1;
    readonly taskId: string;
    readonly sessionId: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly outcome: TaskOutcome;
    readonly mode: TooltimeMode;
    readonly intent?: TaskIntent;
    readonly policyVersion?: string;
    readonly injectedRuleIds: readonly GuidanceId[];
    readonly taskWallMs: number;
    readonly toolWallMs: number;
    readonly toolCallMs: number;
    readonly suspectedWasteMs: number;
    readonly calls: readonly ToolCallSpan[];
    readonly findings: readonly EfficiencyFinding[];
    readonly droppedCallCount: number;
}
export interface DetectionOptions {
    readonly slowCallMs: number;
}
export interface FindingAggregate {
    readonly code: EfficiencyFindingCode;
    readonly signature: EfficiencyFindingCode;
    readonly confidence: FindingConfidence;
    readonly guidanceId: GuidanceId;
    readonly guidance: string;
    readonly taskCount: number;
    readonly occurrenceCount: number;
    readonly totalWasteMs: number;
    readonly lastSeenAt: string;
}
export interface ModeSummary {
    readonly mode: TooltimeMode;
    readonly taskCount: number;
    readonly taskWallMs: number;
    readonly toolWallMs: number;
    readonly toolCallMs: number;
    readonly suspectedWasteMs: number;
}
export interface ToolSummary {
    readonly toolName: ToolName;
    readonly callCount: number;
    readonly failureCount: number;
    readonly callMs: number;
}
export interface TraceAnalysis {
    readonly taskCount: number;
    readonly taskWallMs: number;
    readonly toolWallMs: number;
    readonly toolCallMs: number;
    readonly suspectedWasteMs: number;
    readonly callCount: number;
    readonly failureCount: number;
    readonly tools: readonly ToolSummary[];
    readonly findings: readonly FindingAggregate[];
    readonly modes: readonly ModeSummary[];
    readonly rejectedTraceCount: number;
    readonly droppedCallCount: number;
}
export interface GuidanceRule {
    readonly id: GuidanceId;
    readonly text: string;
    readonly source: "baseline" | "observed";
}
export interface GuidancePrompt {
    readonly text: string;
    readonly policyVersion: string;
    readonly rules: readonly GuidanceRule[];
}
