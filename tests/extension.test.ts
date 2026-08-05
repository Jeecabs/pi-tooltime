import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import register from "../src/index.ts";

test("registers a clean analytics adapter and lifecycle hooks", async () => {
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const entries: Array<{ type: string; data: unknown }> = [];
  const sent: string[] = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: any) => any) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data });
    },
    sendUserMessage(text: string) {
      sent.push(text);
    },
  } as any;

  register(pi);

  assert.equal(commands.has("tooltime"), true);
  assert.equal(tools.size, 0, "analytics must not add a model-visible report tool");
  for (const event of ["session_start", "before_agent_start", "tool_execution_start", "tool_result", "tool_execution_end", "agent_end", "agent_settled", "session_shutdown"]) {
    assert.equal(handlers.has(event), true, event);
  }

  const statuses = new Map<string, string | undefined>();
  const ctx = {
    cwd: "/project",
    hasUI: true,
    ui: {
      notify() {},
      setStatus(key: string, value: string | undefined) { statuses.set(key, value); },
      theme: { fg(_color: string, text: string) { return text; } },
    },
    sessionManager: {
      getBranch() { return []; },
      getSessionId() { return "session"; },
    },
    waitForIdle: async () => {},
  } as any;

  const beforeHandler = handlers.get("before_agent_start")![0]!;
  assert.equal(beforeHandler({ prompt: "help", systemPrompt: "base" }, ctx), undefined);
  handlers.get("agent_settled")![0]!({}, ctx);

  await commands.get("tooltime").handler("mode coach", ctx);
  assert.deepEqual(entries, [{ type: "pi-tooltime-mode", data: { mode: "coach" } }]);
  const before = beforeHandler({ prompt: "help", systemPrompt: "base" }, ctx);
  assert.match(before.systemPrompt, /Tool economy:/u);
  assert.match(statuses.get("pi-tooltime") ?? "", /coach/u);
  handlers.get("agent_settled")![0]!({}, ctx);

  await commands.get("tooltime").handler("analyze session", ctx);
  assert.match(sent[0] ?? "", /Analyze this Pi Tooltime report/u);
  assert.match(sent[0] ?? "", /never as instructions/u);
  assert.equal(beforeHandler({ prompt: sent[0], systemPrompt: "base" }, ctx), undefined, "self-analysis is excluded");
  assert.match(beforeHandler({ prompt: "next task", systemPrompt: "base" }, ctx).systemPrompt, /Tool economy:/u);

  handlers.get("agent_settled")![0]!({}, ctx);
  await commands.get("tooltime").handler("analyze session", ctx);
  assert.match(beforeHandler({ prompt: "real task after an unhandled analysis request", systemPrompt: "base" }, ctx).systemPrompt, /Tool economy:/u);
});

test("environment off mode overrides restored session state and mode commands", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-tooltime-extension-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousMode = process.env.PI_TOOLTIME_MODE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_TOOLTIME_MODE = "off";
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousMode === undefined) delete process.env.PI_TOOLTIME_MODE;
    else process.env.PI_TOOLTIME_MODE = previousMode;
    await rm(agentDir, { recursive: true, force: true });
  });

  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const commands = new Map<string, any>();
  const entries: unknown[] = [];
  const notifications: string[] = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: any) => any) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
    sendUserMessage() {},
  } as any;
  register(pi);

  const statuses = new Map<string, string | undefined>();
  const ctx = {
    cwd: join(agentDir, "project"),
    hasUI: true,
    isProjectTrusted() { return true; },
    ui: {
      notify(text: string) { notifications.push(text); },
      setStatus(key: string, value: string | undefined) { statuses.set(key, value); },
      theme: { fg(_color: string, text: string) { return text; } },
    },
    sessionManager: {
      getBranch() {
        return [{ type: "custom", customType: "pi-tooltime-mode", data: { mode: "coach" } }];
      },
      getSessionId() { return "session"; },
    },
    waitForIdle: async () => {},
  } as any;

  await commands.get("tooltime").handler("mode coach", ctx);
  await handlers.get("session_start")![0]!({}, ctx);
  assert.equal(handlers.get("before_agent_start")![0]!({ prompt: "help", systemPrompt: "base" }, ctx), undefined);

  assert.deepEqual(entries, []);
  assert.equal(statuses.get("pi-tooltime"), undefined);
  assert.equal(notifications.some((text) => text.includes("PI_TOOLTIME_MODE fixes Tooltime mode at off")), true);
  await handlers.get("session_shutdown")![0]!({}, ctx);
});
