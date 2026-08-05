import { sanitizeTaskTrace } from "./core/sanitize.js";
const DEFAULT_MAX_PENDING = 8;
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/u;
class RemoteResponseError extends Error {
}
function remoteUrl(value) {
    const url = new URL(value);
    if (url.username || url.password)
        throw new Error("Remote endpoint must not contain credentials.");
    if (url.search || url.hash)
        throw new Error("Remote endpoint must not contain a query string or fragment.");
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error("Remote endpoint must use HTTPS. Loopback HTTP is allowed for local development.");
    }
    return url;
}
function bearerToken(value) {
    const token = value?.trim();
    if (!token)
        return undefined;
    if (!BEARER_TOKEN.test(token))
        throw new Error("Remote bearer token contains unsupported characters.");
    return token;
}
function remoteFailure(error) {
    return error instanceof RemoteResponseError ? error : new Error("Remote request failed.");
}
function toRemoteTrace(value) {
    const trace = sanitizeTaskTrace(value);
    if (!trace)
        throw new Error("Remote trace is invalid.");
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
    endpoint;
    displayEndpoint;
    timeoutMs;
    token;
    fetch;
    maxPending;
    now;
    pending = new Set();
    dropped = 0;
    lastError;
    constructor(options) {
        const endpoint = remoteUrl(options.endpoint);
        this.endpoint = endpoint.toString();
        this.displayEndpoint = endpoint.origin;
        this.timeoutMs = options.timeoutMs;
        this.token = bearerToken(options.token);
        this.fetch = options.fetch ?? globalThis.fetch;
        this.maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
        this.now = options.now ?? (() => new Date());
    }
    schedule(trace) {
        if (this.pending.size >= this.maxPending) {
            this.dropped++;
            return;
        }
        const work = this.send(trace).catch((error) => {
            this.lastError = remoteFailure(error);
        });
        this.pending.add(work);
        void work.finally(() => this.pending.delete(work));
    }
    async send(trace) {
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "pi-tooltime/0.1.0",
        };
        if (this.token)
            headers.Authorization = `Bearer ${this.token}`;
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
        if (!response.ok)
            throw new RemoteResponseError(`Remote exporter returned HTTP ${response.status}.`);
        this.lastError = undefined;
    }
    async flush() {
        while (this.pending.size > 0)
            await Promise.all([...this.pending]);
    }
    status() {
        return {
            endpoint: this.displayEndpoint,
            pending: this.pending.size,
            dropped: this.dropped,
            ...(this.lastError ? { error: this.lastError.message } : {}),
        };
    }
}
export function createRemoteTraceExporter(config, env = process.env, dependencies = {}) {
    if (!config.enabled || !config.endpoint)
        return undefined;
    return new RemoteTraceExporter({
        endpoint: config.endpoint,
        timeoutMs: config.timeoutMs,
        token: env.PI_TOOLTIME_REMOTE_TOKEN,
        ...dependencies,
    });
}
