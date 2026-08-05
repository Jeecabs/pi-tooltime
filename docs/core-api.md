# Core API

Pi Tooltime ships a Pi-independent Node.js core for evaluation harnesses and other programs. The package root does not register the extension, write files, or make network requests.

The curated interface below is Core v1. Package version 1.0.0 establishes the stable compatibility contract described in [Versioning](#versioning).

## Requirements and package shape

- Node.js 22.19.0 or later.
- ECMAScript modules. CommonJS `require()` is not supported.
- A pinned Git dependency. Pi Tooltime is not published to npm.

Add a release tag to a consuming project:

```json
{
  "dependencies": {
    "pi-tooltime": "github:Jeecabs/pi-tooltime#v1.0.0"
  }
}
```

The package has two exports:

| Export | Target | Purpose |
| --- | --- | --- |
| `pi-tooltime` | `dist/core/index.js` | Pi-independent Core v1 interface. |
| `pi-tooltime/extension` | `dist/index.js` | Pi extension default export. |

`@earendil-works/pi-coding-agent` is an optional peer dependency. A core-only runtime does not need it. The extension export needs a Pi host.

Do not import `src/*.ts`, `dist/core/*.js`, or undeclared package subpaths. Those files are implementation details.

## Runtime interface

The root exports five runtime values:

```text
TooltimeLifecycleError
analyzeTraces
createTaskRecorder
decodeTaskTrace
formatAnalysis
```

The root exports these named types:

```text
DecodeIssue
DecodeIssueCode
DecodeTaskTraceResult
FormatAnalysisOptions
LifecycleErrorCode
RecorderOptions
TaskIntent
TaskOutcome
TaskRecorder
TaskTrace
ToolEvent
TooltimeClock
TraceAnalysis
```

Adding an accidental helper to an internal module does not add it to this interface.

## Record one task

`createTaskRecorder` accepts raw lifecycle events. It classifies task intent, tool calls, and results. It also calculates fingerprints, interval timing, and findings.

```ts
import {
  analyzeTraces,
  createTaskRecorder,
  formatAnalysis,
} from "pi-tooltime";

const task = createTaskRecorder({
  sessionId: "eval-run-42",
  taskId: "case-7",
  cwd: process.cwd(),
  prompt: "Inspect the repository",
});

task.record({
  type: "start",
  callId: "call-1",
  toolName: "read",
  input: { path: "src/index.ts" },
});

task.record({
  type: "finish",
  callId: "call-1",
  result: "file text",
  isError: false,
});

const trace = task.finish("completed");
const analysis = analyzeTraces([trace]);

console.log(formatAnalysis(analysis, {
  audience: "human",
  title: "Eval run 42",
}));
```

Use an `update` event when a host hook changes the final tool name or input:

```ts
task.record({
  type: "update",
  callId: "call-1",
  toolName: "read",
  input: { path: "src/core/index.ts" },
});
```

Raw prompts, current working directories, call IDs, tool inputs, and tool results do not enter the returned Task Trace.

## Recorder options

| Option | Requirement | Default |
| --- | --- | --- |
| `sessionId` | 1 to 128 letters, digits, underscores, or hyphens. Required. | None. |
| `taskId` | Same format as `sessionId`. | Random UUID. |
| `cwd` | Nonempty string, at most 4,096 characters. | `process.cwd()` captured at construction. |
| `mode` | `analytics` or `coach`. | `analytics`. |
| `prompt` | String. Core inspects only the first 32,768 characters. | None. |
| `intent` | `repository`, `web`, or `database`. It overrides prompt inference. | Inferred when unambiguous. |
| `slowCallMs` | Safe integer from 0 through 3,600,000. | 5,000. |
| `maxCalls` | Safe integer from 1 through 5,000. | 500. |
| `clock` | Optional monotonic and wall-clock adapter. | Process clocks. |

The recorder accepts at most `maxCalls` start events. It throws a lifecycle error instead of retaining unbounded call state.

## Lifecycle contract

Call sequence numbers use accepted start order, not finish order. Calls can overlap and finish in any order.

`record` uses these strict rules:

- A duplicate active call ID throws `TooltimeLifecycleError` with code `duplicate-call`.
- An update or finish for an unknown call ID throws code `unknown-call`.
- A start after the call limit throws code `call-limit`.
- Any event after task finish throws code `task-finished`.
- Invalid event values throw `TypeError` or `RangeError`.

Errors do not include caller IDs, prompts, tool input, or tool results.

`finish` closes every active call at one monotonic timestamp as an errored call. It sorts spans by start sequence. Repeated calls to `finish` return the same deeply frozen Task Trace.

A custom monotonic clock must return finite nondecreasing numbers from one clock domain. A custom wall clock must return a valid `Date`. Tool Wall Time is the interval union. Tool Call Sum includes overlap and can exceed Task Wall Time.

## Decode persisted traces

Treat parsed JSON and older local records as untrusted input:

```ts
import { decodeTaskTrace } from "pi-tooltime";

const decoded = decodeTaskTrace(JSON.parse(line));
if (!decoded.ok) {
  console.error(decoded.issues.map((issue) => issue.code));
} else {
  consume(decoded.value);
}
```

The decoder:

- Accepts Task Trace schema version 1.
- Applies the fixed field allowlist and vocabulary normalization.
- Rejects unsupported versions and invalid required fields.
- Rejects inconsistent chronology, timing, error/result, sequence, or finding references.
- Returns `normalized-trace` when it safely removes or replaces data.
- Returns a deeply frozen Task Trace.

Decoder issue codes do not contain input values.

## Analyze traces

`analyzeTraces` accepts any iterable. It decodes every item before aggregation.

```ts
const analysis = analyzeTraces(rows.map((row) => JSON.parse(row)));
console.log(analysis.taskCount);
console.log(analysis.rejectedTraceCount);
```

Malformed records increment `rejectedTraceCount`. They do not silently change `taskCount`. The function accepts at most 100,000 iterable items and rejects unsafe aggregate-number overflow.

Finding `taskCount` counts trace instances with that finding. It does not depend on caller-supplied task ID uniqueness. Multiple findings of one code and confidence in one trace count as one finding task and multiple occurrences.

Ordering is deterministic:

- Tool summaries: call duration descending, call count descending, then identifier by code-point order.
- Findings: suspected duration descending, task count descending, code by code-point order, then high confidence before medium confidence.
- Modes: code-point order.

The returned analysis and nested values are deeply frozen.

## Format analysis

The caller must select an audience:

```ts
formatAnalysis(analysis, { audience: "human", title: "Local report" });
formatAnalysis(analysis, { audience: "model" });
```

Human reports can contain normalized custom tool identifiers. Human titles remove control characters and have a 120-character limit.

Model reports use a fixed title and replace custom tool identifiers with fixed coarse labels. `formatAnalysis` accepts only an analysis returned by `analyzeTraces`. This prevents a caller-built object from injecting arbitrary scalar values into model text.

Report text is human-facing output. Do not parse it. Wording, whitespace, and display limits can change in a compatible release. Use the structured analysis for integrations.

## Privacy and performance contract

The root import and all Core v1 functions are synchronous. They do not read files or use the network.

Raw tool inputs use bounded, process-keyed HMAC fingerprints. Equal fingerprints only indicate equal bounded canonical input in one process. They do not prove input equality. Do not use fingerprints as identities, secrets, cache keys, or cross-run metrics. Remote Export omits them.

Classification handles cyclic, accessor-based, and proxy inputs conservatively. Result inspection reads at most 4,096 text characters and 256 content items. Fingerprinting has fixed depth, node, character, key, and array-item budgets.

Large analyses run on the calling thread. Use a worker when a job can block an interactive process.

## Versioning

The package major is the Core interface major:

- `pi-tooltime@1.x` means Core interface v1.
- `TaskTrace.schemaVersion` versions serialized trace fields.
- Guidance `policyVersion` identifies selected rule content.
- The `h1:` prefix versions the Local Fingerprint format.

These versions are independent. Record the exact package version or Git commit for reproducible evaluations because detector behavior can improve during a major line.

Starting with package version 1.0.0, incompatible changes require a new package major. This includes removals, required parameters, incompatible defaults, closed-vocabulary changes, and lifecycle changes.
