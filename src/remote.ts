import { sanitizeTaskTrace } from "./core/sanitize.ts";
import type { TaskTrace } from "./core/types.ts";
import type { RemoteTooltimeConfig } from "./config.ts";

const DEFAULT_MAX_PENDING = 8;
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/u;

class RemoteResponseError extends Error {}

export interface RemoteFetchResponse {
  ok: boolean;
  status: number;
}

export type RemoteFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<RemoteFetchResponse>;

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

function remoteUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Remote endpoint must not contain credentials.");
  if (url.search || url.hash) throw new Error("Remote endpoint must not contain a query string or fragment.");
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Remote endpoint must use HTTPS. Loopback HTTP is allowed for local development.");
  }
  return url;
}

function bearerToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token) return undefined;
  if (!BEARER_TOKEN.test(token)) throw new Error("Remote bearer token contains unsupported characters.");
  return token;
}

function remoteFailure(error: unknown): Error {
  return error instanceof RemoteResponseError ? error : new Error("Remote request failed.");
}

function toRemoteTrace(value: TaskTrace): Record<string, unknown> {
  const trace = sanitizeTaskTrace(value);
  if (!trace) throw new Error("Remote trace is invalid.");
  return {
    schemaVersion: trace.schemaVersion,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    outcome: trace.outcome,
    mode: trace.mode,
    ...(trace.intent ? { intent: trace.intent } : {}),
    ...(trace.policyVersion ? { policyVersion: trace.policyVersion } : {}),
    injectedRuleIds: [...trace.injectedRuleIds],
    taskWallMs: trace.taskWallMs,
    toolWallMs: trace.toolWallMs,
    toolCallMs: trace.toolCallMs,
    suspectedWasteMs: trace.suspectedWasteMs,
    calls: trace.calls.map((call) => ({
      toolName: call.toolName,
      family: call.family,
      operation: call.operation,
      ...(call.scope ? { scope: call.scope } : {}),
      mutates: call.mutates,
      sequence: call.sequence,
      startOffsetMs: call.startOffsetMs,
      durationMs: call.durationMs,
      isError: call.isError,
      resultKind: call.resultKind,
    })),
    findings: trace.findings.map((finding) => ({
      code: finding.code,
      signature: finding.signature,
      confidence: finding.confidence,
      callSequences: [...finding.callSequences],
      suspectedWasteMs: finding.suspectedWasteMs,
      guidanceId: finding.guidanceId,
    })),
    droppedCallCount: trace.droppedCallCount,
  };
}

export class RemoteTraceExporter {
  private readonly endpoint: string;
  private readonly displayEndpoint: string;
  private readonly timeoutMs: number;
  private readonly token: string | undefined;
  private readonly fetch: RemoteFetch;
  private readonly maxPending: number;
  private readonly now: () => Date;
  private readonly pending = new Set<Promise<void>>();
  private dropped = 0;
  private lastError: Error | undefined;

  constructor(options: RemoteTraceExporterOptions) {
    const endpoint = remoteUrl(options.endpoint);
    this.endpoint = endpoint.toString();
    this.displayEndpoint = endpoint.origin;
    this.timeoutMs = options.timeoutMs;
    this.token = bearerToken(options.token);
    this.fetch = options.fetch ?? (globalThis.fetch as RemoteFetch);
    this.maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
    this.now = options.now ?? (() => new Date());
  }

  schedule(trace: TaskTrace): void {
    if (this.pending.size >= this.maxPending) {
      this.dropped++;
      return;
    }

    const work = this.send(trace).catch((error: unknown) => {
      this.lastError = remoteFailure(error);
    });
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  private async send(trace: TaskTrace): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "pi-tooltime/0.1.0",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const body = JSON.stringify({
      schemaVersion: 1,
      type: "pi-tooltime.task-trace",
      sentAt: this.now().toISOString(),
      trace: toRemoteTrace(trace),
    });
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new RemoteResponseError(`Remote exporter returned HTTP ${response.status}.`);
    this.lastError = undefined;
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  status(): RemoteExporterStatus {
    return {
      endpoint: this.displayEndpoint,
      pending: this.pending.size,
      dropped: this.dropped,
      ...(this.lastError ? { error: this.lastError.message } : {}),
    };
  }
}

export function createRemoteTraceExporter(
  config: RemoteTooltimeConfig,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Pick<RemoteTraceExporterOptions, "fetch" | "maxPending" | "now"> = {},
): RemoteTraceExporter | undefined {
  if (!config.enabled || !config.endpoint) return undefined;
  return new RemoteTraceExporter({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    token: env.PI_TOOLTIME_REMOTE_TOKEN,
    ...dependencies,
  });
}
