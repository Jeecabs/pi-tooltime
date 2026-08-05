import { randomUUID } from "node:crypto";

import { analyzeTaskTraces } from "./analyze.ts";
import { classifyTaskIntent, classifyToolCall, classifyToolResult } from "./classify.ts";
import { toolFingerprint } from "./fingerprint.ts";
import { TaskRecorder as InternalTaskRecorder } from "./recorder.ts";
import { formatTraceAnalysis, formatTraceAnalysisForModel } from "./report.ts";
import { sanitizeClassification, sanitizeTaskTrace } from "./sanitize.ts";
import type {
  ClassifiedToolCall,
  TaskIntent,
  TaskOutcome,
  TaskTrace,
  TraceAnalysis,
} from "./types.ts";

const DEFAULT_SLOW_CALL_MS = 5_000;
const DEFAULT_MAX_CALLS = 500;
const MAX_CALLS = 5_000;
const MAX_PROMPT_CHARS = 32_768;
const MAX_CLASSIFICATION_FIELD_CHARS = 32_768;
const MAX_CWD_CHARS = 4_096;
const MAX_CALL_ID_CHARS = 256;
const MAX_ANALYSIS_TRACES = 100_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

const analysisBrand = Symbol("pi-tooltime.trace-analysis");

export interface TooltimeClock {
  monotonicNow(): number;
  wallNow(): Date;
}

export interface RecorderOptions {
  readonly sessionId: string;
  readonly taskId?: string;
  readonly cwd?: string;
  readonly mode?: "analytics" | "coach";
  readonly prompt?: string;
  readonly intent?: TaskIntent;
  readonly slowCallMs?: number;
  readonly maxCalls?: number;
  readonly clock?: TooltimeClock;
}

export type ToolEvent =
  | Readonly<{
    type: "start";
    callId: string;
    toolName: string;
    input?: unknown;
  }>
  | Readonly<{
    type: "update";
    callId: string;
    toolName?: string;
    input?: unknown;
  }>
  | Readonly<{
    type: "finish";
    callId: string;
    result?: unknown;
    isError: boolean;
  }>;

export type LifecycleErrorCode = "duplicate-call" | "unknown-call" | "task-finished" | "call-limit";

export class TooltimeLifecycleError extends Error {
  readonly code: LifecycleErrorCode;

  constructor(code: LifecycleErrorCode) {
    super(`Invalid Tooltime recorder lifecycle: ${code}.`);
    this.name = "TooltimeLifecycleError";
    this.code = code;
  }
}

export interface TaskRecorder {
  record(event: ToolEvent): void;
  finish(outcome?: TaskOutcome): TaskTrace;
}

export type DecodeIssueCode = "invalid-trace" | "unsupported-schema" | "normalized-trace" | "inconsistent-trace";

export interface DecodeIssue {
  readonly code: DecodeIssueCode;
}

export type DecodeTaskTraceResult =
  | Readonly<{
    ok: true;
    value: TaskTrace;
    warnings: readonly DecodeIssue[];
  }>
  | Readonly<{
    ok: false;
    issues: readonly DecodeIssue[];
  }>;

export type FormatAnalysisOptions =
  | Readonly<{ audience: "human"; title?: string }>
  | Readonly<{ audience: "model" }>;

interface NormalizedRecorderOptions {
  sessionId: string;
  taskId?: string;
  cwd: string;
  mode: "analytics" | "coach";
  intent?: TaskIntent;
  slowCallMs: number;
  maxCalls: number;
  clock?: TooltimeClock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be a finite integer from ${minimum} through ${maximum}.`);
  }
  return candidate;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${name} must contain 1 to 128 letters, digits, underscores, or hyphens.`);
  }
  return value;
}

function normalizedClock(value: unknown): TooltimeClock | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("clock must be an object.");
  const monotonicNow = value.monotonicNow;
  const wallNow = value.wallNow;
  if (typeof monotonicNow !== "function" || typeof wallNow !== "function") {
    throw new TypeError("clock must provide monotonicNow and wallNow functions.");
  }
  return {
    monotonicNow: () => {
      const result = Reflect.apply(monotonicNow, value, []);
      return typeof result === "number" ? result : Number.NaN;
    },
    wallNow: () => {
      const result = Reflect.apply(wallNow, value, []);
      return result instanceof Date ? result : new Date(Number.NaN);
    },
  };
}

function optionalIdentifier(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : identifier(value, name);
}

function normalizedCwd(value: unknown): string {
  const cwd = value === undefined ? process.cwd() : value;
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > MAX_CWD_CHARS) {
    throw new TypeError(`cwd must contain 1 to ${MAX_CWD_CHARS} characters.`);
  }
  return cwd;
}

function normalizedMode(value: unknown): "analytics" | "coach" {
  const mode = value ?? "analytics";
  if (mode !== "analytics" && mode !== "coach") throw new TypeError("mode must be analytics or coach.");
  return mode;
}

function isTaskIntent(value: unknown): value is TaskIntent {
  return value === "repository" || value === "web" || value === "database";
}

function normalizedIntent(value: unknown, prompt: unknown): TaskIntent | undefined {
  if (value !== undefined) {
    if (!isTaskIntent(value)) throw new TypeError("intent must be repository, web, or database.");
    return value;
  }
  if (prompt === undefined) return undefined;
  if (typeof prompt !== "string") throw new TypeError("prompt must be a string.");
  return classifyTaskIntent(prompt.slice(0, MAX_PROMPT_CHARS));
}

function normalizedOptions(value: RecorderOptions): NormalizedRecorderOptions {
  try {
    if (!isRecord(value)) throw new TypeError("Recorder options must be an object.");
    const taskId = optionalIdentifier(value.taskId, "taskId");
    const intent = normalizedIntent(value.intent, value.prompt);
    const clock = normalizedClock(value.clock);
    return {
      sessionId: identifier(value.sessionId, "sessionId"),
      ...(taskId ? { taskId } : {}),
      cwd: normalizedCwd(value.cwd),
      mode: normalizedMode(value.mode),
      ...(intent ? { intent } : {}),
      slowCallMs: finiteInteger(value.slowCallMs, DEFAULT_SLOW_CALL_MS, 0, 3_600_000, "slowCallMs"),
      maxCalls: finiteInteger(value.maxCalls, DEFAULT_MAX_CALLS, 1, MAX_CALLS, "maxCalls"),
      ...(clock ? { clock } : {}),
    };
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    throw new TypeError("Recorder options could not be read.");
  }
}

function clockNow(clock: TooltimeClock | undefined): () => number {
  let previous = 0;
  return () => {
    let value: unknown;
    try {
      value = clock ? clock.monotonicNow() : performance.now();
    } catch {
      throw new RangeError("The monotonic clock failed.");
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < previous) {
      throw new RangeError("The monotonic clock must return finite nondecreasing numbers.");
    }
    previous = value;
    return value;
  };
}

function wallNow(clock: TooltimeClock | undefined): () => Date {
  return () => {
    let value: unknown;
    try {
      value = clock ? clock.wallNow() : new Date();
    } catch {
      throw new RangeError("The wall clock failed.");
    }
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new RangeError("The wall clock must return a valid Date.");
    }
    return new Date(value.getTime());
  };
}

function callId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CALL_ID_CHARS) {
    throw new TypeError(`callId must contain 1 to ${MAX_CALL_ID_CHARS} characters.`);
  }
  return value;
}

function toolName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError("toolName must contain 1 to 256 characters.");
  }
  return value;
}

function conservativeClassification(name: string, input: unknown): ClassifiedToolCall {
  return sanitizeClassification({
    toolName: name,
    fingerprint: toolFingerprint(name, input),
    family: "other",
    operation: "unknown",
    mutates: true,
  });
}

function boundedClassificationInput(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const output: Record<string, unknown> = {};
  for (const key of ["action", "command", "method", "path", "query", "url", "dryRun"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) continue;
    output[key] = typeof descriptor.value === "string"
      ? descriptor.value.slice(0, MAX_CLASSIFICATION_FIELD_CHARS)
      : descriptor.value;
  }
  return output;
}

function safeClassification(name: string, input: unknown, cwd: string): ClassifiedToolCall {
  try {
    const classification = classifyToolCall(name, boundedClassificationInput(input), cwd);
    return { ...classification, fingerprint: toolFingerprint(name, input) };
  } catch {
    return conservativeClassification(name, input);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!objectValue(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function frozenTrace(trace: TaskTrace): TaskTrace {
  return deepFreeze(trace);
}

function brandedAnalysis(analysis: TraceAnalysis, rejectedTraceCount: number, droppedCallCount: number): TraceAnalysis {
  const output: TraceAnalysis = { ...analysis, rejectedTraceCount, droppedCallCount };
  Object.defineProperty(output, analysisBrand, { value: true, enumerable: false });
  return deepFreeze(output);
}

function isTaskOutcome(value: unknown): value is TaskOutcome {
  return value === "completed" || value === "error" || value === "aborted";
}

function traceSequences(trace: TaskTrace): Set<number> | undefined {
  const sequences = new Set<number>();
  let retainedCallMs = 0;
  let previousSequence = 0;
  for (const call of trace.calls) {
    if (call.sequence <= previousSequence || call.startOffsetMs + call.durationMs > trace.taskWallMs) return undefined;
    if (call.isError && call.resultKind !== "error") return undefined;
    sequences.add(call.sequence);
    previousSequence = call.sequence;
    retainedCallMs += call.durationMs;
    if (!Number.isSafeInteger(retainedCallMs)) return undefined;
  }
  return retainedCallMs <= trace.toolCallMs ? sequences : undefined;
}

function findingsAreConsistent(trace: TaskTrace, sequences: ReadonlySet<number>): boolean {
  return trace.findings.every((finding) =>
    finding.suspectedWasteMs <= trace.toolWallMs
    && finding.callSequences.every((sequence) => sequences.has(sequence))
  );
}

function taskTraceIsConsistent(trace: TaskTrace): boolean {
  if (Date.parse(trace.completedAt) < Date.parse(trace.startedAt)) return false;
  if (trace.toolWallMs > trace.taskWallMs || trace.suspectedWasteMs > trace.toolWallMs) return false;
  const sequences = traceSequences(trace);
  return sequences !== undefined && findingsAreConsistent(trace, sequences);
}

function objectValue(value: unknown): value is object {
  return Boolean(value) && typeof value === "object";
}

function objectKeys(value: object): string[] | undefined {
  try {
    return Object.keys(value).sort();
  } catch {
    return undefined;
  }
}

function dataDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor : undefined;
  } catch {
    return undefined;
  }
}

function canonicalEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (!objectValue(left) || !objectValue(right)) return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const leftKeys = objectKeys(left);
  const rightKeys = objectKeys(right);
  if (!leftKeys || !rightKeys || leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => {
    const leftValue = dataDescriptor(left, key);
    const rightValue = dataDescriptor(right, key);
    return leftValue !== undefined && rightValue !== undefined
      && canonicalEqual(leftValue.value, rightValue.value, seen);
  });
}

function failedDecode(code: DecodeIssueCode): DecodeTaskTraceResult {
  return deepFreeze({ ok: false as const, issues: [{ code }] });
}

export function decodeTaskTrace(value: unknown): DecodeTaskTraceResult {
  let schemaVersion: unknown;
  try {
    if (!isRecord(value)) return failedDecode("invalid-trace");
    schemaVersion = value.schemaVersion;
  } catch {
    return failedDecode("invalid-trace");
  }
  if (schemaVersion !== 1) return failedDecode("unsupported-schema");

  let trace: TaskTrace | undefined;
  try {
    trace = sanitizeTaskTrace(value);
  } catch {
    return failedDecode("invalid-trace");
  }
  if (!trace) return failedDecode("invalid-trace");
  if (!taskTraceIsConsistent(trace)) return failedDecode("inconsistent-trace");
  const warnings = canonicalEqual(value, trace) ? [] : [{ code: "normalized-trace" as const }];
  return deepFreeze({ ok: true as const, value: frozenTrace(trace), warnings });
}

class PublicTaskRecorder implements TaskRecorder {
  private readonly recorder: InternalTaskRecorder;
  private readonly cwd: string;
  private readonly maxCalls: number;
  private readonly active = new Map<string, string>();
  private startedCallCount = 0;
  private trace: TaskTrace | undefined;

  constructor(options: NormalizedRecorderOptions) {
    this.cwd = options.cwd;
    this.maxCalls = options.maxCalls;
    this.recorder = new InternalTaskRecorder({
      sessionId: options.sessionId,
      mode: options.mode,
      ...(options.taskId ? { taskId: options.taskId } : { taskId: randomUUID() }),
      ...(options.intent ? { intent: options.intent } : {}),
      detection: { slowCallMs: options.slowCallMs },
      maxCalls: options.maxCalls,
      now: clockNow(options.clock),
      wallNow: wallNow(options.clock),
    });
  }

  record(event: ToolEvent): void {
    if (this.trace) throw new TooltimeLifecycleError("task-finished");
    let input: Record<string, unknown>;
    let type: unknown;
    try {
      if (!isRecord(event)) throw new TypeError("Tool event must be an object.");
      input = event;
      type = input.type;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Tool event could not be read.");
    }

    if (type === "start") this.start(input);
    else if (type === "update") this.update(input);
    else if (type === "finish") this.finishTool(input);
    else throw new TypeError("Tool event type must be start, update, or finish.");
  }

  private start(event: Record<string, unknown>): void {
    let id: string;
    let name: string;
    let input: unknown;
    try {
      id = callId(event.callId);
      name = toolName(event.toolName);
      input = event.input;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Start event could not be read.");
    }
    if (this.active.has(id)) throw new TooltimeLifecycleError("duplicate-call");
    if (this.startedCallCount >= this.maxCalls) throw new TooltimeLifecycleError("call-limit");
    this.recorder.startTool(id, safeClassification(name, input, this.cwd));
    this.active.set(id, name);
    this.startedCallCount++;
  }

  private update(event: Record<string, unknown>): void {
    let id: string;
    let nameValue: unknown;
    let input: unknown;
    try {
      id = callId(event.callId);
      nameValue = event.toolName;
      input = event.input;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Update event could not be read.");
    }
    const previousName = this.active.get(id);
    if (!previousName) throw new TooltimeLifecycleError("unknown-call");
    const name = nameValue === undefined ? previousName : toolName(nameValue);
    this.recorder.updateTool(id, safeClassification(name, input, this.cwd));
    this.active.set(id, name);
  }

  private finishTool(event: Record<string, unknown>): void {
    let id: string;
    let result: unknown;
    let isError: unknown;
    try {
      id = callId(event.callId);
      result = event.result;
      isError = event.isError;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Finish event could not be read.");
    }
    if (!this.active.has(id)) throw new TooltimeLifecycleError("unknown-call");
    if (typeof isError !== "boolean") throw new TypeError("isError must be a boolean.");
    this.recorder.finishTool(id, {
      isError,
      resultKind: classifyToolResult(result, isError),
    });
    this.active.delete(id);
  }

  finish(outcome: TaskOutcome = "completed"): TaskTrace {
    if (this.trace) return this.trace;
    if (!isTaskOutcome(outcome)) throw new TypeError("outcome must be completed, error, or aborted.");
    const raw = this.recorder.finish(outcome);
    this.active.clear();
    const decoded = decodeTaskTrace(raw);
    if (!decoded.ok) throw new Error("Tooltime produced an invalid task trace.");
    this.trace = decoded.value;
    return this.trace;
  }
}

export function createTaskRecorder(options: RecorderOptions): TaskRecorder {
  return new PublicTaskRecorder(normalizedOptions(options));
}

function iterable(value: unknown): value is Iterable<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  try {
    return typeof Reflect.get(value, Symbol.iterator) === "function";
  } catch {
    return false;
  }
}

function analysisNumbersAreSafe(analysis: TraceAnalysis): boolean {
  const top = [
    analysis.taskCount,
    analysis.taskWallMs,
    analysis.toolWallMs,
    analysis.toolCallMs,
    analysis.suspectedWasteMs,
    analysis.callCount,
    analysis.failureCount,
  ];
  if (!top.every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
  if (!analysis.tools.every((tool) => [tool.callCount, tool.failureCount, tool.callMs].every((value) => Number.isSafeInteger(value) && value >= 0))) return false;
  if (!analysis.findings.every((finding) => [finding.taskCount, finding.occurrenceCount, finding.totalWasteMs].every((value) => Number.isSafeInteger(value) && value >= 0))) return false;
  return analysis.modes.every((mode) => [mode.taskCount, mode.taskWallMs, mode.toolWallMs, mode.toolCallMs, mode.suspectedWasteMs].every((value) => Number.isSafeInteger(value) && value >= 0));
}

export function analyzeTraces(traces: Iterable<unknown>): TraceAnalysis {
  if (!iterable(traces)) throw new TypeError("traces must be iterable.");
  const accepted: TaskTrace[] = [];
  let rejectedTraceCount = 0;
  let count = 0;
  let limitExceeded = false;
  try {
    for (const value of traces) {
      count++;
      if (count > MAX_ANALYSIS_TRACES) {
        limitExceeded = true;
        break;
      }
      const decoded = decodeTaskTrace(value);
      if (decoded.ok) accepted.push(decoded.value);
      else rejectedTraceCount++;
    }
  } catch {
    throw new TypeError("traces could not be iterated.");
  }
  if (limitExceeded) throw new RangeError(`traces cannot contain more than ${MAX_ANALYSIS_TRACES} items.`);
  const analysis = analyzeTaskTraces(accepted);
  if (!analysisNumbersAreSafe(analysis)) throw new RangeError("Trace analysis exceeds safe numeric limits.");
  const droppedCallCount = accepted.reduce((total, trace) => {
    const next = total + trace.droppedCallCount;
    if (!Number.isSafeInteger(next)) throw new RangeError("Dropped-call total exceeds safe numeric limits.");
    return next;
  }, 0);
  return brandedAnalysis(analysis, rejectedTraceCount, droppedCallCount);
}

function safeHumanTitle(value: unknown): string {
  if (value === undefined) return "Tooltime report";
  if (typeof value !== "string") throw new TypeError("title must be a string.");
  const title = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
  return title || "Tooltime report";
}

export function formatAnalysis(analysis: TraceAnalysis, options: FormatAnalysisOptions): string {
  let trusted = false;
  try {
    trusted = Boolean(analysis) && typeof analysis === "object"
      && Reflect.get(analysis, analysisBrand) === true;
  } catch {
    // Caller-built objects are not valid analysis snapshots.
  }
  if (!trusted) throw new TypeError("analysis must come from analyzeTraces.");
  let audience: unknown;
  let title: unknown;
  try {
    if (!isRecord(options)) throw new TypeError("Format options must be an object.");
    audience = options.audience;
    title = "title" in options ? options.title : undefined;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Format options could not be read.");
  }
  let output: string;
  if (audience === "model") output = formatTraceAnalysisForModel(analysis);
  else if (audience === "human") output = formatTraceAnalysis(analysis, safeHumanTitle(title));
  else throw new TypeError("audience must be human or model.");

  const notes = [
    analysis.rejectedTraceCount > 0 ? `rejected traces: ${analysis.rejectedTraceCount}` : undefined,
    analysis.droppedCallCount > 0 ? `dropped call details: ${analysis.droppedCallCount}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return notes.length > 0 ? `${output}\n${notes.join("\n")}` : output;
}
