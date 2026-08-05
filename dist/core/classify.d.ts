import type { ClassifiedToolCall, TaskIntent, ToolResultKind } from "./types.ts";
export { toolFingerprint } from "./fingerprint.ts";
export declare function classifyToolCall(toolName: string, input: unknown, cwd: string): ClassifiedToolCall;
export declare function classifyTaskIntent(prompt: string): TaskIntent | undefined;
export declare function classifyToolResult(result: unknown, isError: boolean): ToolResultKind;
