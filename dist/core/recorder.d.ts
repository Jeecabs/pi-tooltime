import type { ClassifiedToolCall, DetectionOptions, TaskIntent, TaskOutcome, TaskTrace, ToolResultKind, TooltimeMode } from "./types.ts";
export interface TaskRecorderOptions {
    sessionId: string;
    mode: TooltimeMode;
    intent?: TaskIntent;
    policyVersion?: string;
    injectedRuleIds?: string[];
    detection: DetectionOptions;
    maxCalls?: number;
    taskId?: string;
    now?: () => number;
    wallNow?: () => Date;
}
export interface FinishToolInput {
    isError: boolean;
    resultKind: ToolResultKind;
}
export declare class TaskRecorder {
    private readonly taskId;
    private readonly sessionId;
    private readonly mode;
    private readonly intent;
    private readonly policyVersion;
    private readonly injectedRuleIds;
    private readonly detection;
    private readonly maxCalls;
    private readonly now;
    private readonly wallNow;
    private readonly startedMs;
    private readonly startedAt;
    private readonly active;
    private readonly calls;
    private readonly intervals;
    private sequence;
    private toolCallMs;
    private droppedCallCount;
    private trace;
    constructor(options: TaskRecorderOptions);
    startTool(toolCallId: string, classification: ClassifiedToolCall): void;
    updateTool(toolCallId: string, classification: ClassifiedToolCall): void;
    finishTool(toolCallId: string, input: FinishToolInput): void;
    private complete;
    finish(outcome?: TaskOutcome): TaskTrace;
}
