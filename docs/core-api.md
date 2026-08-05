# Core API

Pi Tooltime ships a Pi-independent Node.js core for eval harnesses and other programs. The package root does not register the extension, write local traces, or send remote requests.

## Requirements and package shape

- Node.js 22.19.0 or later.
- ECMAScript modules.
- A pinned Git dependency. Pi Tooltime is not published to npm.

Add a release tag to a consuming project:

```json
{
  "dependencies": {
    "pi-tooltime": "github:Jeecabs/pi-tooltime#v0.1.0"
  }
}
```

The package has two exports:

| Export | Target | Purpose |
| --- | --- | --- |
| `pi-tooltime` | `dist/core/index.js` | Pi-independent core. |
| `pi-tooltime/extension` | `dist/index.js` | Pi extension default export. |

`@earendil-works/pi-coding-agent` is an optional peer dependency. A core-only runtime does not need that peer. The extension export needs a Pi host. That host supplies the peer APIs.

The root does not export configuration, local storage, or Remote Export adapters. Those adapters are extension internals in v0.1.0.

## Import

Use the package root in a consuming project:

```ts
import {
  TaskRecorder,
  analyzeTraces,
  classifyToolCall,
  classifyToolResult,
} from "pi-tooltime";
```

For a direct checkout, import compiled output:

```ts
import {
  TaskRecorder,
  analyzeTraces,
} from "./dist/core/index.js";
```

Do not import `src/*.ts` from a consumer. Those files need a TypeScript loader and are not package exports.

## Record one task

This example uses synthetic call IDs and the process clock:

```ts
import {
  TaskRecorder,
  analyzeTraces,
  classifyToolCall,
  classifyToolResult,
} from "pi-tooltime";

const recorder = new TaskRecorder({
  sessionId: "eval-run-42",
  mode: "analytics",
  detection: { slowCallMs: 5_000 },
  maxCalls: 500,
});

recorder.startTool(
  "call-1",
  classifyToolCall("read", { path: "src/index.ts" }, process.cwd()),
);

recorder.finishTool("call-1", {
  isError: false,
  resultKind: classifyToolResult("file text", false),
});

const trace = recorder.finish("completed");
const analysis = analyzeTraces([trace]);

console.log({
  taskWallMs: analysis.taskWallMs,
  toolWallMs: analysis.toolWallMs,
  toolCallMs: analysis.toolCallMs,
  suspectedWasteMs: analysis.suspectedWasteMs,
});
```

Call `updateTool(callId, classification)` before `finishTool` when a hook changes tool input after execution starts.

`TaskRecorder` uses a monotonic clock for durations and a wall clock for timestamps. Tests can pass `now` and `wallNow` functions for deterministic results.

## Actual value exports

The package root exports these runtime values in v0.1.0:

| Group | Exports |
| --- | --- |
| Analysis | `analyzeTraces`, `recentTraces` |
| Classification | `classifyTaskIntent`, `classifyToolCall`, `classifyToolResult`, `toolFingerprint` |
| Detection and timing | `callUnionDurationMs`, `detectEfficiencyFindings`, `suspectedWasteDurationMs`, `unionDurationMs` |
| Guidance | `BASELINE_RULES`, `buildGuidancePrompt`, `eligibleFindingAggregates` |
| Policy constants | `FINDING_CODES`, `GUIDANCE_IDS`, `GUIDANCE_REGISTRY`, `TOOL_FAMILIES`, `TOOL_OPERATIONS`, `TOOL_RESULT_KINDS`, `TOOL_SCOPES` |
| Policy normalization | `guidanceFor`, `guidanceIdForFinding`, `normalizeFindingCode`, `normalizeGuidanceId`, `normalizeToolFamily`, `normalizeToolName`, `normalizeToolOperation`, `normalizeToolResultKind`, `normalizeToolScope` |
| Recording | `TaskRecorder` |
| Reports | `formatDuration`, `formatFindingCandidates`, `formatTraceAnalysis`, `formatTraceAnalysisForModel` |
| Sanitization | `STORED_CALL_ALLOWLIST`, `STORED_FINDING_ALLOWLIST`, `STORED_TRACE_ALLOWLIST`, `sanitizeClassification`, `sanitizeTaskTrace` |

`analyzeTraces` aggregates findings, tools, modes, and timing.

## Actual type exports

The root also exports these TypeScript types and interfaces:

```text
ClassifiedToolCall
DetectionOptions
EfficiencyFinding
EfficiencyFindingCode
FindingAggregate
FindingConfidence
FinishToolInput
GuidanceId
GuidanceOptions
GuidancePrompt
GuidanceRule
Interval
ModeSummary
TaskIntent
TaskOutcome
TaskRecorderOptions
TaskTrace
ToolCallSpan
ToolFamily
ToolName
ToolOperation
ToolResultKind
ToolScope
ToolSummary
TooltimeMode
TraceAnalysis
```

These types come from public core modules. They can change under the pre-1.0 policy.

`formatTraceAnalysisForModel` groups custom tool identifiers into fixed model-safe labels. Use it before you put a report in model context. `formatTraceAnalysis` preserves normalized tool identifiers for local human reports.

## Host adapter responsibilities

A host adapter must:

1. Create one recorder for each accepted task boundary.
2. Use stable call IDs to match tool start, update, and finish events.
3. Reclassify final tool input when hooks can mutate it.
4. Call `finish` after automatic retries and continuations settle.
5. Keep raw prompts, tool inputs, and results out of persistence.
6. Store or export only the schema for that destination.
7. Close active calls on abort or shutdown.

The Pi adapter from `pi-tooltime/extension` is one implementation.

## Classification contract

`classifyToolCall` preserves a safe lowercase tool identifier. Unsafe names collapse to a fixed family or `other`.

Input actions map to fixed coarse operations. Raw action strings are not part of `ClassifiedToolCall`. Unknown actions become `unknown` and mutating.

`classifyToolResult` inspects bounded text and returns only `nonempty`, `empty`, `error`, or `unknown`.

Call `sanitizeTaskTrace` before accepting a trace from another process or older storage. It enforces field allowlists and fixed policy values.

## Fingerprint scope

`toolFingerprint` returns a process-keyed HMAC with an `h1:` prefix. Equal canonical inputs in one process produce equal fingerprints.

The random process key is not exported or stored. Fingerprints from separate Node.js processes are intentionally not comparable.

Do not use a fingerprint as an identity, secret, cache key, or cross-run metric. Do not put it in a Remote Trace.

## Stability before 1.0

Pi Tooltime uses release tags, but its public API is pre-1.0. A minor release can change function signatures, exports, enum members, or trace fields.

Pin a tag or commit. Review the [changelog](../CHANGELOG.md) before an upgrade. Compile and test the consuming project against each new version.

`schemaVersion` versions serialized records. It does not guarantee automatic migration between releases.
