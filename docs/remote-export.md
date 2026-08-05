# Remote Export

Remote Export sends one allowlisted Task Trace subset to a user-selected HTTP endpoint. It is off by default.

Local storage remains independent. A remote failure does not fail the agent or remove the local Task Trace.

## Consent and configuration

Eligible user-global config or user environment variables can enable Remote Export. Project `remote` config is always ignored, including in a trusted project.

User-global config is `<agent-dir>/tooltime.json`. The default agent directory is `~/.pi/agent`. `PI_CODING_AGENT_DIR` replaces that directory when set.

File-based remote config is eligible only when the configured agent directory is absolute. Both the configured and resolved agent directory and config paths must be outside the current project directory.

If this check fails, Pi Tooltime reads other file settings but ignores the complete `remote` value. It produces a warning. Environment Remote Export variables still work.

```json
{
  "remote": {
    "enabled": true,
    "endpoint": "https://telemetry.example.com/pi-tooltime",
    "timeoutMs": 5000
  }
}
```

Optional environment variables are:

```bash
export PI_TOOLTIME_REMOTE_ENABLED=true
export PI_TOOLTIME_REMOTE_ENDPOINT=https://telemetry.example.com/pi-tooltime
export PI_TOOLTIME_REMOTE_TOKEN='receiver-token'
```

The environment enable flag and endpoint apply after file config. They also work when Pi Tooltime ignores file-based remote config. The sender uses the token only for the request header.

Run `/tooltime reload` after a JSON change. Restart Pi after an environment change.

Pi shows a receiver-origin warning when Remote Export starts.

`/tooltime status` shows the receiver origin, pending count, dropped count, and latest error. It does not show the configured request path.

## Endpoint rules

The endpoint must be an absolute URL that meets all these rules:

- It has no username or password.
- It has no query string.
- It has no fragment.
- It uses HTTPS.
- It can use HTTP only for `localhost`, `127.0.0.1`, or IPv6 loopback.

The sender uses `redirect: "error"`. It does not follow a redirect response. Endpoint credential, query, fragment, transport, and redirect failures prevent delivery.

Keep routing metadata out of the query string. Put receiver-side routing behind the configured path or authentication policy.

## Request

The sender makes one `POST` for each completed Task Trace.

Headers:

```http
Content-Type: application/json
User-Agent: pi-tooltime/1.0.0
Authorization: Bearer <PI_TOOLTIME_REMOTE_TOKEN>
```

`Authorization` is absent when the trimmed token is empty or unset.

A nonempty token must match:

```text
^[A-Za-z0-9\-._~+/]+=*$
```

This permits letters, digits, `-._~+/`, and trailing `=` padding. An unsupported character rejects exporter setup with a generic error. The error does not repeat the token.

The token does not appear in request JSON, Tooltime status, or Tooltime error messages.

The request body is one JSON envelope:

```json
{
  "schemaVersion": 1,
  "type": "pi-tooltime.task-trace",
  "sentAt": "2026-08-05T12:00:06.000Z",
  "trace": {
    "schemaVersion": 1,
    "startedAt": "2026-08-05T12:00:00.000Z",
    "completedAt": "2026-08-05T12:00:05.000Z",
    "outcome": "completed",
    "mode": "coach",
    "intent": "repository",
    "policyVersion": "a0d6752d0e2d",
    "injectedRuleIds": [
      "source-routing"
    ],
    "taskWallMs": 5000,
    "toolWallMs": 3500,
    "toolCallMs": 4200,
    "suspectedWasteMs": 2000,
    "calls": [
      {
        "toolName": "read",
        "family": "repository",
        "operation": "read",
        "scope": "targeted",
        "mutates": false,
        "sequence": 1,
        "startOffsetMs": 100,
        "durationMs": 1500,
        "isError": false,
        "resultKind": "nonempty"
      },
      {
        "toolName": "grep",
        "family": "repository",
        "operation": "search",
        "scope": "project",
        "mutates": false,
        "sequence": 2,
        "startOffsetMs": 500,
        "durationMs": 700,
        "isError": false,
        "resultKind": "nonempty"
      },
      {
        "toolName": "read",
        "family": "repository",
        "operation": "read",
        "scope": "targeted",
        "mutates": false,
        "sequence": 3,
        "startOffsetMs": 2500,
        "durationMs": 2000,
        "isError": false,
        "resultKind": "nonempty"
      }
    ],
    "findings": [
      {
        "code": "repeat.expensive-identical",
        "signature": "repeat.expensive-identical",
        "confidence": "high",
        "callSequences": [
          3
        ],
        "suspectedWasteMs": 2000,
        "guidanceId": "avoid-repeat"
      }
    ],
    "droppedCallCount": 0
  }
}
```

`intent`, `policyVersion`, and call `scope` are optional. The sender omits each field when it is absent.

## Exact remote field set

The envelope contains only:

```text
schemaVersion, type, sentAt, trace
```

The Remote Trace contains only:

```text
schemaVersion, startedAt, completedAt, outcome, mode, intent?,
policyVersion?, injectedRuleIds, taskWallMs, toolWallMs, toolCallMs,
suspectedWasteMs, calls, findings, droppedCallCount
```

Each remote call contains only:

```text
toolName, family, operation, scope?, mutates, sequence,
startOffsetMs, durationMs, isError, resultKind
```

Each remote finding contains only:

```text
code, signature, confidence, callSequences,
suspectedWasteMs, guidanceId
```

The sender sanitizes the local trace first. It then constructs new trace, call, and finding objects from these fields. Extra fields do not pass through.

## Included data

Remote data includes:

- Exact ISO `sentAt`, `startedAt`, and `completedAt` timestamps.
- Exact mode and outcome.
- Optional fixed Source Intent.
- Optional policy version and fixed injected rule IDs.
- Exact millisecond timing totals and Tool Span offsets.
- Normalized tool identifiers.
- Fixed coarse family, operation, scope, mutation state, and Result Kind.
- Fixed coarse finding codes, confidence, call sequences, suspected time, and Guidance Rule IDs.
- Dropped call count.

The sender preserves safe lowercase tool identifiers instead of collapsing them to a family. A name can reveal an integration or capability.

## Omitted data

Remote data omits:

- Local `taskId` and `sessionId`.
- Local Fingerprints.
- Guidance Rule text.
- Raw task prompts.
- Raw tool inputs and action strings.
- Raw tool results.
- File contents, database rows, and raw project paths.
- Unknown or extra trace, call, and finding fields.

The sender omits project IDs and remote task IDs. Exact timestamps and metadata can still support correlation with other logs.

## Delivery behavior

The extension uses a bounded in-memory set of pending requests:

- Default maximum: 8 pending requests.
- Per-request timeout: `remote.timeoutMs`.
- Retries: none.
- Persistent remote queue: none.
- Redirects: rejected.

When all eight slots are busy, the sender drops the next Remote Trace and increments its dropped count. A failed request records a redacted error for status output. HTTP response errors retain only the status code. Other request errors become `Remote request failed.`

The sender treats any HTTP response with `ok: true` as success. In standard Fetch behavior, this means a 2xx status. It does not read or use the response body.

The extension flushes current pending requests during normal session shutdown. A process crash, forced termination, timeout, or network failure can lose a Remote Trace.

There is no delivery identifier or exactly-once guarantee. A receiver must tolerate missing records. It should also tolerate duplicate records from external replay or custom hosting behavior.

## Receiver duties

The receiver operator must:

1. Require authentication when the endpoint is not intentionally public.
2. Terminate TLS with a valid certificate for non-loopback endpoints.
3. Validate the envelope type, schema version, fixed enums, arrays, and numeric bounds.
4. Set request and stored-record size limits.
5. Return a 2xx response only after accepting responsibility for the record.
6. Restrict access to exact timestamps, normalized tool identifiers, and timing metadata.
7. Define retention, deletion, backup, incident response, and access-log policies.
8. Avoid adding raw prompts, payloads, results, project IDs, or fingerprints during enrichment.
9. Document how a user requests deletion when no remote task or session ID exists.

Remote Export transfers data to the trust boundary of the receiver. This repository does not control receiver storage, logs, backups, or subprocessors.

## Disable export

Set the environment override:

```bash
export PI_TOOLTIME_REMOTE_ENABLED=false
```

Then restart Pi. You can also disable `remote.enabled` in eligible user-global config and run `/tooltime reload` when no environment override enables it.

Disabling export does not delete records already delivered. Contact the receiver operator for deletion.
