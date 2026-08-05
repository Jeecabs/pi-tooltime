import type { DetectionOptions, TooltimeMode } from "./core/types.js";
import type { GuidanceOptions } from "./core/guidance.js";
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
export declare const DEFAULT_TOOLTIME_CONFIG: TooltimeConfig;
export declare function loadTooltimeConfig(options: LoadTooltimeConfigOptions): LoadedTooltimeConfig;
