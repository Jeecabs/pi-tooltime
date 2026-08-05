import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(root, "api/core-v1.json"), "utf8"));
assert.equal(contract.schemaVersion, 1);
assert.equal(Array.isArray(contract.runtimeExports), true);
assert.equal(Array.isArray(contract.declarationFiles), true);

const expectedValues = [...contract.runtimeExports].sort();
const core = await import(pathToFileURL(join(root, "dist/core/index.js")));
assert.deepEqual(Object.keys(core).sort(), expectedValues);

const declarationHash = createHash("sha256");
for (const file of contract.declarationFiles) {
  declarationHash.update(file).update("\0").update(readFileSync(join(root, file))).update("\0");
}
assert.equal(
  declarationHash.digest("hex"),
  contract.declarationSha256,
  "Core declarations changed; review the diff and update api/core-v1.json intentionally.",
);

function declarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? declarations(path) : entry.isFile() && entry.name.endsWith(".d.ts") ? [path] : [];
  });
}
for (const file of declarations(join(root, "dist"))) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /["']\.\.?\/[^"']+\.ts["']/u, `${file} contains a TypeScript declaration specifier.`);
}

const temporary = mkdtempSync(join(tmpdir(), "pi-tooltime-core-contract-"));
try {
  const packOutput = execFileSync("npm", [
    "pack",
    "--ignore-scripts",
    "--pack-destination",
    temporary,
    "--json",
  ], { cwd: root, encoding: "utf8" });
  const [{ filename }] = JSON.parse(packOutput);
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", [
    "install",
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    join(temporary, filename),
  ], { cwd: consumer, stdio: "pipe" });

  writeFileSync(join(consumer, "runtime.mjs"), `
import assert from "node:assert/strict";
import * as core from "pi-tooltime";
assert.deepEqual(Object.keys(core).sort(), ${JSON.stringify(expectedValues)});
let time = 0;
const task = core.createTaskRecorder({
  sessionId: "consumer",
  cwd: process.cwd(),
  clock: {
    monotonicNow: () => time,
    wallNow: () => new Date(1_700_000_000_000 + time),
  },
});
time = 10;
task.record({ type: "start", callId: "1", toolName: "read", input: { path: "README.md" } });
time = 20;
task.record({ type: "finish", callId: "1", result: "text", isError: false });
time = 30;
const trace = task.finish();
const analysis = core.analyzeTraces([trace]);
assert.equal(analysis.taskCount, 1);
assert.match(core.formatAnalysis(analysis, { audience: "human" }), /^Tooltime report/);
assert.equal(core.decodeTaskTrace(JSON.parse(JSON.stringify(trace))).ok, true);
`);
  execFileSync(process.execPath, [join(consumer, "runtime.mjs")], { stdio: "pipe" });

  writeFileSync(join(consumer, "consumer.ts"), `
import {
  TooltimeLifecycleError,
  analyzeTraces,
  createTaskRecorder,
  decodeTaskTrace,
  formatAnalysis,
  type DecodeIssue,
  type DecodeIssueCode,
  type DecodeTaskTraceResult,
  type FormatAnalysisOptions,
  type LifecycleErrorCode,
  type RecorderOptions,
  type TaskIntent,
  type TaskOutcome,
  type TaskRecorder,
  type TaskTrace,
  type ToolEvent,
  type TooltimeClock,
  type TraceAnalysis,
} from "pi-tooltime";
const clock: TooltimeClock = { monotonicNow: () => 0, wallNow: () => new Date(0) };
const options: RecorderOptions = { sessionId: "typed", clock };
const recorder: TaskRecorder = createTaskRecorder(options);
const event: ToolEvent = { type: "start", callId: "1", toolName: "read" };
recorder.record(event);
const intent: TaskIntent = "repository";
void intent;
const outcome: TaskOutcome = "completed";
const trace: TaskTrace = recorder.finish(outcome);
const decoded: DecodeTaskTraceResult = decodeTaskTrace(JSON.parse(JSON.stringify(trace)));
const analysis: TraceAnalysis = analyzeTraces(decoded.ok ? [decoded.value] : []);
const format: FormatAnalysisOptions = { audience: "model" };
formatAnalysis(analysis, format);
const lifecycleCode: LifecycleErrorCode = "unknown-call";
new TooltimeLifecycleError(lifecycleCode);
const issueCode: DecodeIssueCode = "invalid-trace";
const issue: DecodeIssue = { code: issueCode };
void issue;
// @ts-expect-error Core snapshots are readonly.
trace.taskId = "changed";
// @ts-expect-error Model reports do not accept caller titles.
formatAnalysis(analysis, { audience: "model", title: "unsafe" });
`);
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ["consumer.ts"],
  }));
  execFileSync(process.execPath, [
    join(root, "node_modules/@typescript/native-preview/bin/tsgo"),
    "--project",
    join(consumer, "tsconfig.json"),
  ], { cwd: consumer, stdio: "pipe" });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log("Core v1 package contract: ok");
