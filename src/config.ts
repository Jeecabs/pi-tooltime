import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import type { DetectionOptions, TooltimeMode } from "./core/types.ts";
import type { GuidanceOptions } from "./core/guidance.ts";

export interface RemoteTooltimeConfig {
  enabled: boolean;
  endpoint?: string;
  timeoutMs: number;
}

export interface TooltimeConfig extends DetectionOptions, GuidanceOptions {
  mode: TooltimeMode;
  retentionDays: number;
  maxTasks: number;
  maxCallsPerTask: number;
  remote: RemoteTooltimeConfig;
}

export interface LoadedTooltimeConfig {
  config: TooltimeConfig;
  sources: string[];
  warnings: string[];
  modeOverride?: TooltimeMode;
}

export interface LoadTooltimeConfigOptions {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_TOOLTIME_CONFIG: TooltimeConfig = {
  mode: "analytics",
  retentionDays: 30,
  maxTasks: 2_000,
  maxCallsPerTask: 500,
  slowCallMs: 5_000,
  minTasks: 3,
  minTotalDurationMs: 30_000,
  maxPromptChars: 500,
  maxPromptRules: 3,
  includeBaselineGuidance: true,
  remote: {
    enabled: false,
    timeoutMs: 5_000,
  },
};

const CONFIG_KEYS = new Set<keyof TooltimeConfig>([
  "mode",
  "retentionDays",
  "maxTasks",
  "maxCallsPerTask",
  "slowCallMs",
  "minTasks",
  "minTotalDurationMs",
  "maxPromptChars",
  "maxPromptRules",
  "includeBaselineGuidance",
  "remote",
]);

const NUMBER_RULES: Record<Exclude<keyof TooltimeConfig, "mode" | "includeBaselineGuidance" | "remote">, [number, number]> = {
  retentionDays: [1, 3_650],
  maxTasks: [10, 10_000],
  maxCallsPerTask: [10, 5_000],
  slowCallMs: [0, 3_600_000],
  minTasks: [1, 100],
  minTotalDurationMs: [0, 86_400_000],
  maxPromptChars: [120, 2_000],
  maxPromptRules: [1, 10],
};

function mode(value: unknown): value is TooltimeMode {
  return value === "off" || value === "analytics" || value === "coach";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyRemote(base: RemoteTooltimeConfig, input: unknown, path: string, warnings: string[]): RemoteTooltimeConfig {
  if (!record(input)) {
    warnings.push(`${path}: remote must be an object.`);
    return base;
  }
  const next = { ...base };
  for (const key of Object.keys(input)) {
    if (!["enabled", "endpoint", "timeoutMs"].includes(key)) warnings.push(`${path}: unknown remote key '${key}'.`);
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled === "boolean") next.enabled = input.enabled;
    else warnings.push(`${path}: remote.enabled must be a boolean.`);
  }
  if (input.endpoint !== undefined) {
    if (typeof input.endpoint === "string" && input.endpoint.trim()) next.endpoint = input.endpoint.trim();
    else warnings.push(`${path}: remote.endpoint must be a nonempty URL string.`);
  }
  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs === "number" && Number.isInteger(input.timeoutMs) && input.timeoutMs >= 100 && input.timeoutMs <= 60_000) {
      next.timeoutMs = input.timeoutMs;
    } else {
      warnings.push(`${path}: remote.timeoutMs must be an integer from 100 to 60000.`);
    }
  }
  return next;
}

function readObject(path: string, warnings: string[]): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`${path}: config root must be an object.`);
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function applyObject(
  base: TooltimeConfig,
  input: Record<string, unknown>,
  path: string,
  warnings: string[],
  remoteWarning?: string,
): TooltimeConfig {
  const next = { ...base, remote: { ...base.remote } };
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key as keyof TooltimeConfig)) warnings.push(`${path}: unknown key '${key}'.`);
  }

  if (input.mode !== undefined) {
    if (mode(input.mode)) next.mode = input.mode;
    else warnings.push(`${path}: mode must be off, analytics, or coach.`);
  }

  if (input.includeBaselineGuidance !== undefined) {
    if (typeof input.includeBaselineGuidance === "boolean") next.includeBaselineGuidance = input.includeBaselineGuidance;
    else warnings.push(`${path}: includeBaselineGuidance must be a boolean.`);
  }

  if (input.remote !== undefined) {
    if (remoteWarning) warnings.push(`${path}: ${remoteWarning}`);
    else next.remote = applyRemote(next.remote, input.remote, path, warnings);
  }

  for (const [key, [minimum, maximum]] of Object.entries(NUMBER_RULES) as Array<[keyof typeof NUMBER_RULES, [number, number]]>) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
      warnings.push(`${path}: ${key} must be an integer from ${minimum} to ${maximum}.`);
      continue;
    }
    next[key] = value;
  }

  return next;
}

function existingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function pathContainedBy(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function containedBy(root: string, candidate: string): boolean {
  return pathContainedBy(resolve(root), resolve(candidate))
    || pathContainedBy(existingPath(root), existingPath(candidate));
}

function allowsFileRemoteConfig(agentDir: string, cwd: string, configPath: string): boolean {
  return isAbsolute(agentDir) && !containedBy(cwd, agentDir) && !containedBy(cwd, configPath);
}

export function loadTooltimeConfig(options: LoadTooltimeConfigOptions): LoadedTooltimeConfig {
  const warnings: string[] = [];
  const sources: string[] = [];
  let config = { ...DEFAULT_TOOLTIME_CONFIG, remote: { ...DEFAULT_TOOLTIME_CONFIG.remote } };
  const globalPath = join(options.agentDir, "tooltime.json");
  const globalInput = readObject(globalPath, warnings);
  if (globalInput) {
    const remoteWarning = allowsFileRemoteConfig(options.agentDir, options.cwd, globalPath)
      ? undefined
      : "remote configuration is ignored because the agent directory is relative or inside the current project; use PI_TOOLTIME_REMOTE_* variables.";
    config = applyObject(config, globalInput, globalPath, warnings, remoteWarning);
    sources.push(globalPath);
  }

  if (options.projectTrusted) {
    const projectPath = join(options.cwd, CONFIG_DIR_NAME, "tooltime.json");
    const projectInput = readObject(projectPath, warnings);
    if (projectInput) {
      config = applyObject(
        config,
        projectInput,
        projectPath,
        warnings,
        "project remote configuration is ignored; configure remote export globally or through PI_TOOLTIME_REMOTE_*.",
      );
      sources.push(projectPath);
    }
  }

  const env = options.env ?? process.env;
  const envMode = env.PI_TOOLTIME_MODE?.trim();
  let modeOverride: TooltimeMode | undefined;
  if (envMode) {
    if (mode(envMode)) {
      config.mode = envMode;
      modeOverride = envMode;
    } else warnings.push("PI_TOOLTIME_MODE must be off, analytics, or coach.");
  }

  const remoteEnabled = env.PI_TOOLTIME_REMOTE_ENABLED?.trim().toLowerCase();
  if (remoteEnabled) {
    if (remoteEnabled === "true") config.remote.enabled = true;
    else if (remoteEnabled === "false") config.remote.enabled = false;
    else warnings.push("PI_TOOLTIME_REMOTE_ENABLED must be true or false.");
  }
  const remoteEndpoint = env.PI_TOOLTIME_REMOTE_ENDPOINT?.trim();
  if (remoteEndpoint) config.remote.endpoint = remoteEndpoint;
  if (config.remote.enabled && !config.remote.endpoint) warnings.push("Remote export is enabled, but no endpoint is configured.");

  return { config, sources, warnings, ...(modeOverride ? { modeOverride } : {}) };
}
