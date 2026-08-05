import type {
  EfficiencyFindingCode,
  GuidanceId,
  ToolFamily,
  ToolName,
  ToolOperation,
  ToolResultKind,
  ToolScope,
} from "./types.ts";

export const TOOL_FAMILIES = [
  "repository",
  "web",
  "database",
  "issues",
  "process",
  "test",
  "shell",
  "other",
] as const satisfies readonly ToolFamily[];

export const TOOL_OPERATIONS = [
  "read",
  "search",
  "analyze",
  "mutate",
  "interact",
  "query",
  "request",
  "command",
  "test-targeted",
  "test-full",
  "report",
  "unknown",
] as const satisfies readonly ToolOperation[];

export const TOOL_SCOPES = ["targeted", "project", "outside", "root", "full", "unknown"] as const satisfies readonly ToolScope[];
export const TOOL_RESULT_KINDS = ["nonempty", "empty", "error", "unknown"] as const satisfies readonly ToolResultKind[];

export const FINDING_CODES = [
  "repeat.expensive-identical",
  "test.full-suite-loop",
  "search.broad-scope",
  "search.slow-empty",
  "route.explicit-web-local-search",
  "route.explicit-database-local-search",
  "route.explicit-repository-database-query",
] as const satisfies readonly EfficiencyFindingCode[];

export const GUIDANCE_IDS = [
  "avoid-repeat",
  "targeted-validation",
  "target-first",
  "reassess-after-empty",
  "source-routing",
] as const satisfies readonly GuidanceId[];

export const GUIDANCE_REGISTRY: Readonly<Record<GuidanceId, string>> = Object.freeze({
  "avoid-repeat": "Do not repeat unchanged tool calls. Reuse the result or change the source, scope, or hypothesis.",
  "targeted-validation": "Use targeted searches and tests while iterating. Broaden only after evidence, and run full suites near handoff.",
  "target-first": "Start searches at a named project directory with a specific pattern. Broaden only after targeted evidence fails.",
  "reassess-after-empty": "After two empty or repeated calls, stop and change the source, scope, or hypothesis.",
  "source-routing": "Match the tool to the source: repository facts → find/grep/read; current public docs → browser_read; live state → database tools.",
});

const SAFE_TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/u;
const toolFamilies = new Set<string>(TOOL_FAMILIES);
const toolOperations = new Set<string>(TOOL_OPERATIONS);
const toolScopes = new Set<string>(TOOL_SCOPES);
const resultKinds = new Set<string>(TOOL_RESULT_KINDS);
const findingCodes = new Set<string>(FINDING_CODES);
const guidanceIds = new Set<string>(GUIDANCE_IDS);

export function normalizeToolFamily(value: unknown): ToolFamily {
  return typeof value === "string" && toolFamilies.has(value) ? value as ToolFamily : "other";
}

export function normalizeToolName(value: unknown, family: ToolFamily = "other"): ToolName {
  if (typeof value === "string" && SAFE_TOOL_NAME.test(value)) return value;
  if (["repository", "web", "database", "issues", "process"].includes(family)) return family;
  return "other";
}

export function normalizeToolOperation(value: unknown): ToolOperation {
  return typeof value === "string" && toolOperations.has(value) ? value as ToolOperation : "unknown";
}

export function normalizeToolScope(value: unknown): ToolScope | undefined {
  return typeof value === "string" && toolScopes.has(value) ? value as ToolScope : undefined;
}

export function normalizeToolResultKind(value: unknown): ToolResultKind {
  return typeof value === "string" && resultKinds.has(value) ? value as ToolResultKind : "unknown";
}

export function normalizeFindingCode(value: unknown): EfficiencyFindingCode | undefined {
  return typeof value === "string" && findingCodes.has(value) ? value as EfficiencyFindingCode : undefined;
}

export function normalizeGuidanceId(value: unknown): GuidanceId | undefined {
  return typeof value === "string" && guidanceIds.has(value) ? value as GuidanceId : undefined;
}

export function guidanceFor(id: GuidanceId): string {
  return GUIDANCE_REGISTRY[id];
}

export function guidanceIdForFinding(code: EfficiencyFindingCode): GuidanceId {
  if (code === "repeat.expensive-identical") return "avoid-repeat";
  if (code === "test.full-suite-loop") return "targeted-validation";
  if (code === "search.broad-scope") return "target-first";
  if (code === "search.slow-empty") return "reassess-after-empty";
  return "source-routing";
}
