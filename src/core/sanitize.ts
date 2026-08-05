import { sanitizeFingerprint } from "./fingerprint.ts";
import {
  guidanceFor,
  guidanceIdForFinding,
  normalizeFindingCode,
  normalizeGuidanceId,
  normalizeToolFamily,
  normalizeToolName,
  normalizeToolOperation,
  normalizeToolResultKind,
  normalizeToolScope,
} from "./policy.ts";
import type {
  ClassifiedToolCall,
  EfficiencyFinding,
  TaskOutcome,
  TaskTrace,
  ToolCallSpan,
  TooltimeMode,
} from "./types.ts";

export const STORED_TRACE_ALLOWLIST = Object.freeze([
  "schemaVersion",
  "taskId",
  "sessionId",
  "startedAt",
  "completedAt",
  "outcome",
  "mode",
  "intent",
  "policyVersion",
  "injectedRuleIds",
  "taskWallMs",
  "toolWallMs",
  "toolCallMs",
  "suspectedWasteMs",
  "calls",
  "findings",
  "droppedCallCount",
] as const);

export const STORED_CALL_ALLOWLIST = Object.freeze([
  "toolName",
  "fingerprint",
  "family",
  "operation",
  "scope",
  "mutates",
  "sequence",
  "startOffsetMs",
  "durationMs",
  "isError",
  "resultKind",
] as const);

export const STORED_FINDING_ALLOWLIST = Object.freeze([
  "code",
  "signature",
  "confidence",
  "callSequences",
  "suspectedWasteMs",
  "guidanceId",
  "guidance",
] as const);

const MAX_STORED_CALLS = 5_000;
const MAX_STORED_FINDINGS = 1_000;
const MAX_FINDING_SEQUENCES = 5_000;
const MAX_INJECTED_RULE_IDS = 100;
const MAX_ISO_DATE_CHARS = 64;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}

function identifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const safe = value.slice(0, 128).replace(/[^a-zA-Z0-9_-]/gu, "-");
  return safe || fallback;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_ISO_DATE_CHARS) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function taskOutcome(value: unknown): TaskOutcome | undefined {
  return value === "completed" || value === "error" || value === "aborted" ? value : undefined;
}

function tooltimeMode(value: unknown): TooltimeMode | undefined {
  return value === "off" || value === "analytics" || value === "coach" ? value : undefined;
}

export function sanitizeClassification(value: ClassifiedToolCall | unknown): ClassifiedToolCall {
  const input = record(value) ? value : {};
  const family = normalizeToolFamily(input.family);
  const operation = normalizeToolOperation(input.operation);
  const scope = normalizeToolScope(input.scope);
  return {
    toolName: normalizeToolName(input.toolName, family),
    fingerprint: sanitizeFingerprint(input.fingerprint),
    family,
    operation,
    ...(scope ? { scope } : {}),
    mutates: ["mutate", "interact", "command", "unknown"].includes(operation) ? true : input.mutates === true,
  };
}

function sanitizeCall(value: unknown): ToolCallSpan | undefined {
  if (!record(value) || !positiveInteger(value.sequence) || !nonnegativeInteger(value.startOffsetMs) || !nonnegativeInteger(value.durationMs)) {
    return undefined;
  }
  const classification = sanitizeClassification(value);
  return {
    ...classification,
    sequence: value.sequence as number,
    startOffsetMs: value.startOffsetMs,
    durationMs: value.durationMs,
    isError: value.isError === true,
    resultKind: normalizeToolResultKind(value.resultKind),
  };
}

function sanitizeFinding(value: unknown): EfficiencyFinding | undefined {
  if (!record(value)) return undefined;
  const code = normalizeFindingCode(value.code);
  if (!code || !nonnegativeInteger(value.suspectedWasteMs)) return undefined;
  const guidanceId = guidanceIdForFinding(code);
  const confidence = value.confidence === "high" || value.confidence === "medium" ? value.confidence : undefined;
  if (!confidence) return undefined;
  const callSequences = Array.isArray(value.callSequences)
    ? value.callSequences.slice(0, MAX_FINDING_SEQUENCES).filter(positiveInteger)
    : [];
  return {
    code,
    signature: code,
    confidence,
    callSequences,
    suspectedWasteMs: value.suspectedWasteMs,
    guidanceId,
    guidance: guidanceFor(guidanceId),
  };
}

export function sanitizeTaskTrace(value: unknown): TaskTrace | undefined {
  if (!record(value) || value.schemaVersion !== 1) return undefined;
  const startedAt = isoDate(value.startedAt);
  const completedAt = isoDate(value.completedAt);
  const outcome = taskOutcome(value.outcome);
  const mode = tooltimeMode(value.mode);
  if (!startedAt || !completedAt || !outcome || !mode) return undefined;
  if (![value.taskWallMs, value.toolWallMs, value.toolCallMs, value.suspectedWasteMs].every(nonnegativeInteger)) return undefined;
  if (!nonnegativeInteger(value.droppedCallCount)) return undefined;

  const intent = value.intent === "repository" || value.intent === "web" || value.intent === "database" ? value.intent : undefined;
  const policyVersion = typeof value.policyVersion === "string" && /^[a-f0-9]{6,64}$/u.test(value.policyVersion)
    ? value.policyVersion
    : undefined;
  const injectedRuleIds = Array.isArray(value.injectedRuleIds)
    ? [...new Set(value.injectedRuleIds.slice(0, MAX_INJECTED_RULE_IDS).map(normalizeGuidanceId).filter((item) => item !== undefined))]
    : [];
  const calls = Array.isArray(value.calls)
    ? value.calls.slice(0, MAX_STORED_CALLS).map(sanitizeCall).filter((item) => item !== undefined)
    : [];
  const findings = Array.isArray(value.findings)
    ? value.findings.slice(0, MAX_STORED_FINDINGS).map(sanitizeFinding).filter((item) => item !== undefined)
    : [];

  return {
    schemaVersion: 1,
    taskId: identifier(value.taskId, "legacy-task"),
    sessionId: identifier(value.sessionId, "legacy-session"),
    startedAt,
    completedAt,
    outcome,
    mode,
    ...(intent ? { intent } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    injectedRuleIds,
    taskWallMs: value.taskWallMs as number,
    toolWallMs: value.toolWallMs as number,
    toolCallMs: value.toolCallMs as number,
    suspectedWasteMs: value.suspectedWasteMs as number,
    calls,
    findings,
    droppedCallCount: value.droppedCallCount as number,
  };
}
