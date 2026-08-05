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
    toolName: ToolName;
    fingerprint: string;
    family: ToolFamily;
    operation: ToolOperation;
    scope?: ToolScope;
    mutates: boolean;
}
export interface ToolCallSpan extends ClassifiedToolCall {
    sequence: number;
    startOffsetMs: number;
    durationMs: number;
    isError: boolean;
    resultKind: ToolResultKind;
}
export interface EfficiencyFinding {
    code: EfficiencyFindingCode;
    signature: EfficiencyFindingCode;
    confidence: FindingConfidence;
    callSequences: number[];
    suspectedWasteMs: number;
    guidanceId: GuidanceId;
    guidance: string;
}
export interface TaskTrace {
    schemaVersion: 1;
    taskId: string;
    sessionId: string;
    startedAt: string;
    completedAt: string;
    outcome: TaskOutcome;
    mode: TooltimeMode;
    intent?: TaskIntent;
    policyVersion?: string;
    injectedRuleIds: string[];
    taskWallMs: number;
    toolWallMs: number;
    toolCallMs: number;
    suspectedWasteMs: number;
    calls: ToolCallSpan[];
    findings: EfficiencyFinding[];
    droppedCallCount: number;
}
export interface DetectionOptions {
    slowCallMs: number;
}
export interface FindingAggregate {
    code: EfficiencyFindingCode;
    signature: EfficiencyFindingCode;
    confidence: FindingConfidence;
    guidanceId: GuidanceId;
    guidance: string;
    taskCount: number;
    occurrenceCount: number;
    totalWasteMs: number;
    lastSeenAt: string;
}
export interface ModeSummary {
    mode: TooltimeMode;
    taskCount: number;
    taskWallMs: number;
    toolWallMs: number;
    toolCallMs: number;
    suspectedWasteMs: number;
}
export interface ToolSummary {
    toolName: ToolName;
    callCount: number;
    failureCount: number;
    callMs: number;
}
export interface TraceAnalysis {
    taskCount: number;
    taskWallMs: number;
    toolWallMs: number;
    toolCallMs: number;
    suspectedWasteMs: number;
    callCount: number;
    failureCount: number;
    tools: ToolSummary[];
    findings: FindingAggregate[];
    modes: ModeSummary[];
}
export interface GuidanceRule {
    id: GuidanceId;
    text: string;
    source: "baseline" | "observed";
}
export interface GuidancePrompt {
    text: string;
    policyVersion: string;
    rules: GuidanceRule[];
}
