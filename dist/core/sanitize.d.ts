import type { ClassifiedToolCall, TaskTrace } from "./types.ts";
export declare const STORED_TRACE_ALLOWLIST: readonly ["schemaVersion", "taskId", "sessionId", "startedAt", "completedAt", "outcome", "mode", "intent", "policyVersion", "injectedRuleIds", "taskWallMs", "toolWallMs", "toolCallMs", "suspectedWasteMs", "calls", "findings", "droppedCallCount"];
export declare const STORED_CALL_ALLOWLIST: readonly ["toolName", "fingerprint", "family", "operation", "scope", "mutates", "sequence", "startOffsetMs", "durationMs", "isError", "resultKind"];
export declare const STORED_FINDING_ALLOWLIST: readonly ["code", "signature", "confidence", "callSequences", "suspectedWasteMs", "guidanceId", "guidance"];
export declare function sanitizeClassification(value: ClassifiedToolCall | unknown): ClassifiedToolCall;
export declare function sanitizeTaskTrace(value: unknown): TaskTrace | undefined;
