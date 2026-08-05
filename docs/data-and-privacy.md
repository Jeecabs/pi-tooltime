# Data and privacy

Pi Tooltime has four data boundaries: transient inspection, local Task Traces, optional Remote Traces, and model-visible reports or guidance.

Remote Export is off by default. Coach mode is also opt-in. Local analytics use an explicit stored-field allowlist.

## Transient inspection

The extension inspects these values in process memory:

- Task prompt text, to infer one coarse Source Intent.
- Tool name and input, to classify the call and calculate a Local Fingerprint.
- Up to 4,096 characters of text result content, to classify Result Kind.
- Non-text result presence, to distinguish empty and nonempty results.
- Final assistant stop reason, to classify task outcome.
- Project working directory, to classify path scope and select a storage directory.
- Optional Remote Export token, to trim, validate, and add it to the HTTP header.

These raw values can contain sensitive data. The local and remote schemas have no fields for prompt text, tool inputs, or result text. They also have no fields for file contents, database rows, or raw project paths.

The extension is not a general secret scanner. Stored metadata can still reveal usage patterns and integration names.

## Fixed classifications and tool identifiers

Most stored call values come from fixed vocabularies. These include family, operation, scope, mutation state, and Result Kind.

An input `action` string is never stored. Recognized actions map to a fixed coarse operation. An unrecognized action maps to `unknown`, and the classifier treats it as mutating.

Pi Tooltime preserves safe lowercase tool identifiers. The accepted form is:

```text
[a-z][a-z0-9_-]{0,63}
```

An unsafe identifier collapses to a known family name or `other`. A preserved identifier such as `supabase_query` can reveal the integration in use. Both local and remote call records include the normalized tool identifier.

The classifier inspects shell commands for fixed patterns. It does not store the raw command. The resulting family, operation, scope, mutation state, and fingerprint can still reveal coarse behavior.

## Local Fingerprints

A Local Fingerprint has this form:

```text
h1:<64 lowercase hexadecimal characters>
```

The extension creates a bounded canonical form of the tool name and input. It then calculates an HMAC-SHA-256 digest with a random process key.

The process key exists only in memory. It is not stored or exported. Equal canonical inputs in one Node.js process produce equal fingerprints. Fingerprints from separate processes are intentionally not comparable.

The fingerprint supports same-process repeated-call detection. It is not an identity, secret, cache key, or cross-run metric. Remote Traces omit it.

## Local Task Trace schema

Each stored Task Trace can contain only these top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Local schema version. It is `1`. |
| `taskId` | Local task identifier. |
| `sessionId` | Local Pi session identifier. |
| `startedAt` | Exact normalized ISO timestamp. |
| `completedAt` | Exact normalized ISO timestamp. |
| `outcome` | `completed`, `error`, or `aborted`. |
| `mode` | `off`, `analytics`, or `coach`. Stored traces normally use an active capture mode. |
| `intent` | Optional fixed Source Intent. |
| `policyVersion` | Optional hash of injected Guidance Rules. |
| `injectedRuleIds` | Fixed IDs for injected rules. |
| `taskWallMs` | Exact Task Wall Time in milliseconds. |
| `toolWallMs` | Exact Tool Wall Time in milliseconds. |
| `toolCallMs` | Exact Tool Call Time in milliseconds. |
| `suspectedWasteMs` | Exact calculated union for referenced finding spans. |
| `calls` | Allowlisted Tool Span records. |
| `findings` | Allowlisted Efficiency Finding records. |
| `droppedCallCount` | Calls included in timing but omitted from `calls`. |

Each local call contains only these fields:

```text
toolName, fingerprint, family, operation, scope?, mutates,
sequence, startOffsetMs, durationMs, isError, resultKind
```

Each local finding contains only these fields:

```text
code, signature, confidence, callSequences, suspectedWasteMs,
guidanceId, guidance
```

The sanitizer rebuilds each record from these fields. It discards extra top-level, call, and finding fields. It also replaces unknown classifications and guidance with fixed registry values.

The local schema contains exact timestamps, normalized local IDs, normalized tool names, timing, and fixed guidance text. Treat the JSONL files as sensitive analytics.

## Local storage path

`PI_CODING_AGENT_DIR` sets the Pi agent directory. The default is `~/.pi/agent`.

Tooltime stores traces below:

```text
<agent-dir>/state/pi-tooltime/<project-key>/<session-id>-<writer-uuid>.jsonl
```

`project-key` is the first 20 hexadecimal characters of SHA-256 over the resolved project path. The raw path is not in the Task Trace or file name.

The project key can still support a dictionary guess when an attacker already knows likely paths. The file name contains the normalized local session ID and a random writer UUID. Do not treat path hashing as anonymization.

Each storage instance selects a new writer UUID. Instances that share a session ID use different files. The loader reads recent JSONL files for the whole project.

## Permissions and link checks

Pi Tooltime creates a missing agent directory with mode `0700`. It enforces mode `0700` on its `state`, `pi-tooltime`, and project directories.

It creates and rewrites trace files with mode `0600`. It also changes opened trace files to `0600` during reads and writes.

The storage adapter rejects target directories and untrusted path components that are symbolic links. For a non-root POSIX process, it permits root-owned system links outside the project so standard operating-system paths continue to work. It opens trace and temporary files with no-follow behavior. It also requires a regular file with one hard link.

These checks reduce accidental exposure and common link attacks. They do not replace operating-system account security or disk encryption.

## Size and load limits

The storage adapter applies these byte limits:

- One serialized trace line: 4 MiB maximum.
- One compacted active writer file: 16 MiB maximum.
- One active writer file: `maxTasks` traces maximum after compaction.
- One active-writer-file compaction read: 32 MiB maximum.
- One project-history load across recent files: 32 MiB total read budget.

The `maxTasks` and 16 MiB limits are separate caps. When trace count or file size exceeds its cap, the append queue compacts the file.

A line over 4 MiB is not stored. The loader drops malformed, partial, and oversized lines. It returns at most `maxTasks` newest valid traces after sorting by completion time.

## Retention behavior

A trace is eligible for reports only when `completedAt` is inside `retentionDays`. The loader compacts the active writer file. This physically removes expired active-writer records.

Inactive writer files use file modification time for physical deletion. This includes files from prior instances of the same session. The loader unlinks an inactive file when its modification time is older than the retention cutoff.

An inactive file with a recent modification time can still contain an expired trace. The loader excludes that trace logically, but the bytes can remain until the file itself becomes old enough for deletion.

Retention is therefore not an immediate physical-deletion guarantee for every inactive file. Use manual deletion when physical removal has a stricter deadline.

## Remote data

Remote Export sends a smaller explicit subset. It omits:

- `taskId` and `sessionId`.
- Local Fingerprints.
- Guidance text.
- All extra fields.

It includes exact envelope and trace timestamps, mode, optional intent and policy fields, timing, normalized calls, and coarse findings. It also includes normalized tool identifiers.

The optional bearer token appears only in the HTTP header. The adapter accepts letters, digits, `-._~+/`, and trailing `=` padding. It rejects other characters with an error that does not repeat the token.

See [Remote Export](remote-export.md) for the complete request schema, endpoint rules, and delivery limits.

## Model-visible data

Coach mode appends fixed Guidance Rule text to the system prompt. It can include fixed baseline rules and fixed rules selected from aggregate evidence. It does not inject captured prompts, inputs, results, paths, fingerprints, or metrics.

`/tooltime analyze` is different. It sends a formatted aggregate report as a new user message to the current model. The report includes aggregate timing, model-safe tool labels, and finding codes.

Built-in labels such as `read`, `grep`, `find`, `edit`, `write`, and `bash` remain visible. Known integration prefixes collapse to `repository`, `web`, `database`, `issues`, or `process`. All other custom tool identifiers collapse to `other`.

Pi can persist the report message in its session file and send it to the selected model provider.

Pi Tooltime skips its own Task Trace for that analysis request. Skipping capture does not make the report private from the model or provider.

`/tooltime status`, `report`, `findings`, and `prompt` use Pi notifications. The extension does not register a model-visible Tooltime tool.

## Delete local data

Stop all Pi processes first. Then run:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
rm -rf -- "$agent_dir/state/pi-tooltime"
rm -f -- "$agent_dir/tooltime.json"
```

Delete project `.pi/tooltime.json` files separately. Remove `PI_TOOLTIME_*` variables from all process environments and secret stores.

A saved mode entry or `/tooltime analyze` report can remain in a Pi session file. Delete the affected Pi session when you need to remove it.

Local deletion does not delete Remote Traces. Contact the receiver operator and follow its deletion process.
