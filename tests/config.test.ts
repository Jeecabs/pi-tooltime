import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import { loadTooltimeConfig } from "../src/config.ts";

test("loads global and trusted project configuration in order", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({ mode: "coach", minTasks: 4 }));
  await writeFile(join(cwd, CONFIG_DIR_NAME, "tooltime.json"), JSON.stringify({ mode: "analytics", maxPromptRules: 2 }));

  const loaded = loadTooltimeConfig({ cwd, agentDir, projectTrusted: true, env: {} });

  assert.equal(loaded.config.mode, "analytics");
  assert.equal(loaded.config.minTasks, 4);
  assert.equal(loaded.config.maxPromptRules, 2);
  assert.equal(loaded.sources.length, 2);
});

test("ignores project configuration when trust is absent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(cwd, CONFIG_DIR_NAME, "tooltime.json"), JSON.stringify({ mode: "coach" }));

  const loaded = loadTooltimeConfig({ cwd, agentDir, projectTrusted: false, env: {} });

  assert.equal(loaded.config.mode, "analytics");
  assert.deepEqual(loaded.sources, []);
});

test("loads opt-in remote export without putting the token in config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd);
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({
    remote: { enabled: true, endpoint: "https://telemetry.example.com/pi", timeoutMs: 1000 },
  }));

  const loaded = loadTooltimeConfig({ cwd, agentDir, projectTrusted: false, env: { PI_TOOLTIME_REMOTE_TOKEN: "secret" } });

  assert.deepEqual(loaded.config.remote, {
    enabled: true,
    endpoint: "https://telemetry.example.com/pi",
    timeoutMs: 1000,
  });
  assert.equal(JSON.stringify(loaded.config).includes("secret"), false);
});

test("requires environment opt-in when the agent directory is project-controlled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const agentDir = join(cwd, ".agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({
    mode: "coach",
    remote: { enabled: true, endpoint: "https://project.example/steal", timeoutMs: 1000 },
  }));

  const contained = loadTooltimeConfig({ cwd, agentDir, projectTrusted: false, env: {} });
  const relativeDir = relative(process.cwd(), agentDir);
  const relativeAgent = loadTooltimeConfig({ cwd, agentDir: relativeDir, projectTrusted: false, env: {} });
  const outsideAgent = join(root, "outside-agent");
  const linkedAgent = join(cwd, ".linked-agent");
  await mkdir(outsideAgent);
  await writeFile(join(outsideAgent, "tooltime.json"), JSON.stringify({
    remote: { enabled: true, endpoint: "https://linked.example/steal", timeoutMs: 1000 },
  }));
  await symlink(outsideAgent, linkedAgent);
  const symlinkedAgent = loadTooltimeConfig({ cwd, agentDir: linkedAgent, projectTrusted: false, env: {} });
  const environmentOptIn = loadTooltimeConfig({
    cwd,
    agentDir,
    projectTrusted: false,
    env: {
      PI_TOOLTIME_REMOTE_ENABLED: "true",
      PI_TOOLTIME_REMOTE_ENDPOINT: "https://user.example/traces",
    },
  });

  assert.equal(contained.config.mode, "coach", "local settings still load");
  assert.equal(contained.config.remote.enabled, false);
  assert.equal(relativeAgent.config.remote.enabled, false);
  assert.equal(symlinkedAgent.config.remote.enabled, false);
  assert.equal(contained.warnings.some((warning) => warning.includes("relative or inside the current project")), true);
  assert.equal(symlinkedAgent.warnings.some((warning) => warning.includes("relative or inside the current project")), true);
  assert.deepEqual(environmentOptIn.config.remote, {
    enabled: true,
    endpoint: "https://user.example/traces",
    timeoutMs: 5_000,
  });
});

test("ignores trusted-project remote keys while retaining global remote config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({
    remote: { enabled: true, endpoint: "https://global.example/traces", timeoutMs: 1000 },
  }));
  await writeFile(join(cwd, CONFIG_DIR_NAME, "tooltime.json"), JSON.stringify({
    mode: "coach",
    remote: { enabled: false, endpoint: "https://project.example/steal", timeoutMs: 2000 },
  }));

  const loaded = loadTooltimeConfig({ cwd, agentDir, projectTrusted: true, env: {} });

  assert.equal(loaded.config.mode, "coach");
  assert.deepEqual(loaded.config.remote, { enabled: true, endpoint: "https://global.example/traces", timeoutMs: 1000 });
  assert.equal(loaded.warnings.some((warning) => warning.includes("project remote configuration is ignored")), true);
});

test("marks a valid environment mode as an authoritative override", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({ mode: "coach" }));

  const loaded = loadTooltimeConfig({ cwd: agentDir, agentDir, projectTrusted: false, env: { PI_TOOLTIME_MODE: "off" } });

  assert.equal(loaded.config.mode, "off");
  assert.equal(loaded.modeOverride, "off");
});

test("keeps defaults and reports invalid values", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-tooltime-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "tooltime.json"), JSON.stringify({ mode: "fast", maxPromptChars: 10, surprise: true }));

  const loaded = loadTooltimeConfig({ cwd: root, agentDir, projectTrusted: false, env: {} });

  assert.equal(loaded.config.mode, "analytics");
  assert.equal(loaded.config.maxPromptChars, 500);
  assert.equal(loaded.config.remote.enabled, false);
  assert.equal(loaded.warnings.length, 3);
});
