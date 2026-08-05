import { createHash } from "node:crypto";

import { analyzeTraces } from "./analyze.ts";
import { guidanceFor, normalizeGuidanceId } from "./policy.ts";
import type {
  FindingAggregate,
  GuidancePrompt,
  GuidanceRule,
  TaskTrace,
} from "./types.ts";

export interface GuidanceOptions {
  minTasks: number;
  minTotalDurationMs: number;
  maxPromptChars: number;
  maxPromptRules: number;
  includeBaselineGuidance: boolean;
}

const BASELINE_RULES: readonly GuidanceRule[] = Object.freeze([
  Object.freeze({
    id: "source-routing",
    source: "baseline",
    text: guidanceFor("source-routing"),
  }),
  Object.freeze({
    id: "targeted-validation",
    source: "baseline",
    text: guidanceFor("targeted-validation"),
  }),
  Object.freeze({
    id: "reassess-after-empty",
    source: "baseline",
    text: guidanceFor("reassess-after-empty"),
  }),
]);

export function eligibleFindingAggregates(
  findings: readonly FindingAggregate[],
  options: GuidanceOptions,
): FindingAggregate[] {
  return findings.filter((finding) =>
    finding.confidence === "high"
    && finding.taskCount >= options.minTasks
    && finding.totalWasteMs >= options.minTotalDurationMs
  );
}

function candidateRules(traces: readonly TaskTrace[], options: GuidanceOptions): GuidanceRule[] {
  const observed = eligibleFindingAggregates(analyzeTraces(traces).findings, options).flatMap((finding): GuidanceRule[] => {
    const id = normalizeGuidanceId(finding.guidanceId);
    return id ? [{ id, text: guidanceFor(id), source: "observed" }] : [];
  });
  const candidates = options.includeBaselineGuidance ? [...observed, ...BASELINE_RULES] : observed;
  const seen = new Set<string>();
  return candidates.filter((rule) => {
    if (seen.has(rule.id)) return false;
    seen.add(rule.id);
    return true;
  });
}

export function buildGuidancePrompt(traces: readonly TaskTrace[], options: GuidanceOptions): GuidancePrompt {
  const header = "Tool economy:";
  const selected: GuidanceRule[] = [];
  let text = header;

  for (const rule of candidateRules(traces, options)) {
    if (selected.length >= options.maxPromptRules) break;
    const next = `${text}\n- ${rule.text}`;
    if (next.length > options.maxPromptChars) continue;
    selected.push(rule);
    text = next;
  }

  if (selected.length === 0) text = "";
  const policyVersion = createHash("sha256")
    .update(selected.map((rule) => `${rule.id}\0${rule.text}`).join("\n"))
    .digest("hex")
    .slice(0, 12);
  return { text, policyVersion, rules: selected };
}

export { BASELINE_RULES };
