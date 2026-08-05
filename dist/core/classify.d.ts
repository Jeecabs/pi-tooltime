import type { ClassifiedToolCall, TaskIntent, ToolResultKind } from "./types.js";
export { toolFingerprint } from "./fingerprint.js";
export declare function classifyToolCall(toolName: string, input: unknown, cwd: string): ClassifiedToolCall;
export declare function classifyTaskIntent(prompt: string): TaskIntent | undefined;
export declare function classifyToolResult(result: unknown, isError: boolean): ToolResultKind;
