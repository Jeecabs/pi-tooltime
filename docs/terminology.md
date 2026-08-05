# Terminology

Pi Tooltime uses these names in reports, config, APIs, and project discussions.

## Task Trace

A record for one accepted Pi task run. It starts before the agent starts and ends after the agent settles.

A Task Trace can include multiple model turns, retries, continuations, and parallel tool calls. A Pi session can contain many Task Traces.

Do not use *session* or *turn* as a synonym.

## Tool Span

The elapsed interval from a tool execution start event to its matching end event.

Do not use *tool result* or *command duration* as a synonym.

## Task Wall Time

Elapsed time from Task Trace start to completion.

The API field is `taskWallMs`.

## Tool Wall Time

The union of all Tool Spans in a Task Trace. Overlapping Tool Spans count once.

This value measures how long at least one tool was active. The API field is `toolWallMs`.

Do not call this value *total tool time*.

## Tool Call Time

The sum of all Tool Span durations. Overlapping Tool Spans count more than once.

This value can exceed Task Wall Time when tools run in parallel. The API field is `toolCallMs`.

Do not use *Tool Wall Time* as a synonym.

## Tool Identifier

The normalized stored tool name in `toolName`.

Pi Tooltime preserves names that match `[a-z][a-z0-9_-]{0,63}`. An unsafe name becomes a known family or `other`.

A Tool Identifier is not always coarse. It can reveal an integration or capability.

Local human reports preserve normalized Tool Identifiers. Model-visible analysis reports keep built-in labels but group custom identifiers into fixed model-safe labels.

## Tool Family

A fixed coarse source or capability class:

```text
repository, web, database, issues, process, test, shell, other
```

The API field is `family`.

## Tool Operation

A fixed coarse action class:

```text
read, search, analyze, mutate, interact, query, request, command,
test-targeted, test-full, report, unknown
```

The API field is `operation`. A raw custom-tool `action` is not stored.

The classifier maps unknown actions to `unknown` and mutating.

## Tool Scope

A fixed coarse target scope:

```text
targeted, project, outside, root, full, unknown
```

The optional API field is `scope`.

## Result Kind

A fixed coarse tool-result classification:

```text
nonempty, empty, error, unknown
```

The API field is `resultKind`.

## Source Intent

A fixed coarse class inferred from explicit words in a task prompt:

```text
repository, web, database
```

The optional API field is `intent`. Pi Tooltime leaves it absent when it finds no intent or more than one intent.

## Efficiency Finding

Deterministic evidence that some tool work might have been avoidable. A finding is not proof of waste or poor behavior.

Each finding uses a fixed code. In the current schema, `signature` equals `code`.

Do not use *violation* or *bad call* as a synonym.

## Suspected Avoidable Wall Time

The union of Tool Spans referenced by Efficiency Findings. The API field is `suspectedWasteMs`.

This value is an estimate from fixed detectors. It is not a causal measurement.

## Guidance Rule

A short fixed tool-use instruction. Repeated high-confidence Efficiency Findings can select an observed Guidance Rule.

A Guidance Rule does not contain a captured prompt, tool input, tool result, path, or fingerprint.

## Guidance Rule ID

A fixed identifier for one Guidance Rule. The API field is `guidanceId` in findings and `id` in prompt rules.

Multiple finding codes can map to the same Guidance Rule ID.

## Baseline Guidance

A fixed set of Guidance Rules. Coach Mode can use these rules before project evidence meets promotion thresholds.

Baseline Guidance does not come from local data.

## Policy Version

A 12-character SHA-256 prefix over the selected Guidance Rule IDs and text.

The optional Task Trace field is `policyVersion`. It identifies prompt policy content, not a package release.

## Analytics Mode

The passive mode that records Task Traces and computes Efficiency Findings. It does not change the system prompt.

The config value is `analytics`.

## Coach Mode

The active mode that includes analytics and appends a bounded set of Guidance Rules to the system prompt.

Coach Mode does not block or rewrite tool calls. The config value is `coach`.

## Off Mode

The mode that stops new Task Traces and prompt guidance. It does not delete existing data.

The config value is `off`.

## Local Fingerprint

A process-keyed HMAC over a bounded canonical form of one tool name and input. It has the prefix `h1:`.

The key and canonical input are not stored. Fingerprints from separate processes are intentionally not comparable.

Local Fingerprints never enter the Remote Trace.

## Remote Trace

The explicit Task Trace subset eligible for Remote Export.

A Remote Trace omits task and session IDs, Local Fingerprints, guidance text, and extra fields. It includes exact timestamps, mode, policy, timing, normalized calls, and coarse findings.

See [Remote Export](remote-export.md) for the exact schema.

## Remote Export

An explicit user opt-in that sends Remote Traces to a user-selected server. Local Task Traces remain independent.

Remote Export is off by default. Project config cannot control it.

## Relationships

- A Task Trace contains zero or more Tool Spans.
- Tool Wall Time measures tool occupancy without double-counting overlap.
- Tool Call Time measures aggregate work and can count overlap more than once.
- An Efficiency Finding references one or more Tool Spans.
- Repeated high-confidence findings can select an observed Guidance Rule.
- Coach Mode can inject Guidance Rules but cannot enforce them.
- Remote Export sends Remote Traces, not complete local Task Traces.
