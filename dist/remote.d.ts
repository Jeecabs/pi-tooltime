import type { TaskTrace } from "./core/types.js";
import type { RemoteTooltimeConfig } from "./config.js";
export interface RemoteFetchResponse {
    ok: boolean;
    status: number;
}
export type RemoteFetch = (input: string, init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "error";
}) => Promise<RemoteFetchResponse>;
export interface RemoteTraceExporterOptions {
    endpoint: string;
    timeoutMs: number;
    token?: string;
    fetch?: RemoteFetch;
    maxPending?: number;
    now?: () => Date;
}
export interface RemoteExporterStatus {
    endpoint: string;
    pending: number;
    dropped: number;
    error?: string;
}
export declare class RemoteTraceExporter {
    private readonly endpoint;
    private readonly displayEndpoint;
    private readonly timeoutMs;
    private readonly token;
    private readonly fetch;
    private readonly maxPending;
    private readonly now;
    private readonly pending;
    private dropped;
    private lastError;
    constructor(options: RemoteTraceExporterOptions);
    schedule(trace: TaskTrace): void;
    private send;
    flush(): Promise<void>;
    status(): RemoteExporterStatus;
}
export declare function createRemoteTraceExporter(config: RemoteTooltimeConfig, env?: NodeJS.ProcessEnv, dependencies?: Pick<RemoteTraceExporterOptions, "fetch" | "maxPending" | "now">): RemoteTraceExporter | undefined;
