# Architecture

## Goals

Pi Tooltime separates measurement from behavior change. Analytics Mode does not change the system prompt. Coach Mode uses a bounded fixed guidance policy.

The feedback loop has six stages:

```text
observe -> detect -> aggregate -> promote -> inject -> compare
```

## Three parts

Pi Tooltime has three parts:

1. The Pi-independent Node.js core classifies calls, records traces, detects findings, aggregates evidence, and builds guidance.
2. The Pi adapter connects lifecycle events, commands, session state, status, and system-prompt injection.
3. Internal I/O adapters store local Task Traces and optionally send a smaller remote subset.

The package root exports only the core. It does not import Pi APIs. See [Core API](core-api.md).

## Lifecycle

The Pi adapter uses these events:

1. `session_start` loads config, local history, storage, and the optional remote adapter.
2. `before_agent_start` closes stale work and starts a Task Trace. Coach Mode can append guidance here.
3. `tool_execution_start` starts a Tool Span with a monotonic clock.
4. `tool_result` sees final tool input after tool-call hooks. It refreshes normalized classification and the fingerprint.
5. `tool_execution_end` closes the matching Tool Span by `toolCallId`. It also classifies the result.
6. `agent_end` records the latest low-level run outcome.
7. `agent_settled` closes the Task Trace after automatic work settles. It schedules local and optional remote writes.
8. `session_shutdown` closes incomplete work and flushes pending writes.

Pi Tooltime does not write trace files or start Remote Export inside a measured Tool Span. These operations start after the Task Trace closes.

Storage and remote failures do not fail the agent. Their latest errors appear in `/tooltime status`.

## Trace boundary

A Task Trace starts at `before_agent_start` and ends at `agent_settled`. It can include multiple model turns, automatic retries, continuations, and parallel tool calls.

This boundary follows one accepted Pi task run. It does not create a trace for each model response.

`/tooltime analyze` sends an aggregate report as a user message. The adapter skips the next Task Trace so self-analysis does not change the analytics.

The report is still visible to the model and its provider. The model formatter groups custom tool identifiers into fixed labels before sending it. Pi can also persist the report in the session.

See [Data and privacy](data-and-privacy.md).

## Parallel tool calls

Pi can run sibling tool calls in parallel. A sum of durations counts overlap more than once.

For intervals `[start, end]`, the core calculates:

```text
toolWallMs = duration(union(intervals))
toolCallMs = sum(duration(interval))
```

`toolWallMs` measures time with at least one active tool. `toolCallMs` measures aggregate tool work.

Use `toolWallMs` for user-visible tool occupancy. Keep `toolCallMs` for diagnosis.

## Classification boundary

The adapter and core inspect these transient values:

- Task prompt for one explicit Source Intent.
- Tool name and input for call classification and fingerprinting.
- Tool result for fixed coarse Result Kind.
- Final assistant stop reason for task outcome.

Pi Tooltime preserves safe lowercase tool identifiers. Other stored call classifications use fixed vocabularies.

A custom input `action` maps to a fixed coarse operation. Pi Tooltime discards the raw action. Unknown actions become `unknown` and mutating.

The Task Trace schema has no fields for raw prompts, inputs, results, file contents, database rows, or project paths. It contains normalized local IDs, exact timestamps, normalized tool identifiers, timing, and Local Fingerprints.

Local Fingerprints are process-keyed `h1:` HMAC values. They support same-input comparisons only within one process. Remote Traces omit them.

See [Data and privacy](data-and-privacy.md) for field lists and inference risks.

## Detection

Detectors use fixed finding codes and fixed Guidance Rule mappings.

The current detectors are:

| Code | Trigger summary | Confidence |
| --- | --- | --- |
| `repeat.expensive-identical` | A repeated nonmutating fingerprint passes the duration threshold, with no mutation between calls. | High |
| `test.full-suite-loop` | A later full-suite call repeats the prior suite or follows a mutation. | High |
| `search.broad-scope` | A search or analysis targets root or outside the project. | High for root, medium for outside. |
| `search.slow-empty` | A search reaches `slowCallMs` and has an empty or error Result Kind. | Medium |
| `route.explicit-web-local-search` | Repository search or analysis occurs before a web source for explicit web intent. | High |
| `route.explicit-database-local-search` | Repository search or analysis occurs before a database source for explicit database intent. | High |
| `route.explicit-repository-database-query` | A database query occurs before a repository source for explicit repository intent. | High |

A single necessary slow call is not a finding. Route findings require exactly one inferred Source Intent.

Each finding names its observed call sequences. Suspected time uses the union of those Tool Spans. Task-level `suspectedWasteMs` unions all referenced sequences again, so overlapping findings do not double-count time.

The sanitizer fixes `signature` to the finding code. Multiple finding codes can map to one Guidance Rule ID. The three route codes all map to `source-routing`.

## Promotion

Only high-confidence aggregate findings can produce observed guidance. A finding group must meet both thresholds:

```text
taskCount >= minTasks
totalWasteMs >= minTotalDurationMs
```

Defaults require three affected tasks and 30 seconds of suspected time.

The builder orders observed candidates by aggregate suspected time. It removes duplicate Guidance Rule IDs. When enabled, fixed Baseline Guidance fills unused slots.

Medium-confidence findings remain available in analytics reports. They never become observed guidance under the current policy.

## Prompt contract

The prompt builder:

- Uses complete fixed bullet lines.
- Caps the rule count.
- Caps total characters.
- Records selected rule IDs in the Task Trace.
- Hashes selected rule IDs and text into a 12-character policy version.
- Excludes captured content, metrics, and raw evidence.

Analytics Mode does not build a prompt for injection. Coach Mode appends the result during `before_agent_start`.

The policy fields support comparisons between analytics and coach cohorts. They do not prove that guidance caused a change.

## Local storage

The storage adapter groups data by the first 20 hexadecimal characters of SHA-256 over the resolved project path. It does not put the raw path in a Task Trace.

Each storage instance owns a unique JSONL writer file. Its name contains the normalized session ID and a random writer UUID.

Two instances with the same session ID never append to or compact the same active writer file. This avoids same-session append and rename races. A per-instance promise queue serializes writes and compaction.

The loader sanitizes valid lines and ignores malformed, partial, and oversized lines. It sorts valid traces by completion time and returns at most `maxTasks`.

Storage enforces allowlists, `0700` Tooltime directories, `0600` trace files, and no-follow regular-file checks. Active-file compaction uses both `maxTasks` and 16 MiB caps.

Retention has a physical deletion caveat for inactive recent files. See [Data and privacy](data-and-privacy.md) for exact limits and deletion behavior.

## Remote Export

Remote Export is off by default. Pi Tooltime ignores project Remote Export config.

File-based remote config requires an absolute agent directory. Both the configured and resolved directory and config paths must stay outside the project.

Pi Tooltime ignores the `remote` value in that file when this location check fails. Environment variables can still enable Remote Export.

When enabled, the adapter sends one Remote Trace after a task closes. It has eight pending slots by default, a timeout, and no retries.

The endpoint rejects credentials, query strings, fragments, and insecure non-loopback HTTP. Fetch rejects redirect responses.

The remote adapter accepts only RFC 6750-style bearer-token characters with optional trailing `=` padding. It rejects unsafe characters without repeating the token.

The Remote Trace omits task and session IDs, Local Fingerprints, guidance text, and extras. It includes exact timestamps, mode, policy fields, timing, normalized calls, and coarse findings.

Remote failures do not fail the agent. See [Remote Export](remote-export.md) for the exact schema and delivery limits.

## Eval integration

An eval harness can import the package root without loading Pi or the I/O adapters.

A useful derived eval summary is:

```json
{
  "task_wall_ms": 120000,
  "tool_wall_ms": 70000,
  "tool_call_ms": 95000,
  "suspected_tool_waste_ms": 42000,
  "tool_calls": 14,
  "tool_failures": 2,
  "tool_policy_version": "3ac3485ac7f1",
  "tool_policy_rule_ids": [
    "source-routing",
    "targeted-validation"
  ]
}
```

The names in this example are eval-harness fields, not extra Task Trace fields.

Do not infer causation from a simple before-and-after comparison. Run the same eval tasks in Analytics Mode and Coach Mode.

## Non-goals

Pi Tooltime does not:

- Block or rewrite tool calls.
- Run a model reviewer after each task.
- Send remote data without user opt-in.
- Persist raw prompts, payloads, results, file contents, or project paths in Tooltime schemas.
- Replace a full tracing platform or OpenTelemetry exporter.
