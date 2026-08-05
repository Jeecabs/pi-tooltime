# Pi Tooltime

[![CI](https://github.com/Jeecabs/pi-tooltime/actions/workflows/ci.yml/badge.svg)](https://github.com/Jeecabs/pi-tooltime/actions/workflows/ci.yml)

Pi Tooltime is a [Pi](https://github.com/earendil-works/pi) extension for local tool-time analytics and optional prompt coaching. It measures tool occupancy for each task. It also detects fixed patterns that might indicate avoidable work.

Local analytics are on by default. Coach mode is a separate opt-in. Remote Export stays off until the user enables it.

## Requirements and security

- Pi 0.83.0 or later.
- Node.js 22.19.0 or later.
- Git access to GitHub. This package is not published to npm.

Pi extensions run with your full user permissions. Review the source and selected Git ref before installation.

Pi Tooltime inspects task prompts, tool inputs, and tool results in memory. It persists only allowlisted analytics fields. Read [Data and privacy](docs/data-and-privacy.md) before use in a sensitive project.

## Install

Install the pinned v1.0.0-rc.1 release candidate:

```bash
pi install git:github.com/Jeecabs/pi-tooltime@v1.0.0-rc.1
```

This is a prerelease. Pin the exact tag and review the changelog before an upgrade.

Package update commands keep this ref pinned. They can reset its checkout to the selected ref, but they do not select a newer release.

To follow the default branch, install the unpinned edge version:

```bash
pi install git:github.com/Jeecabs/pi-tooltime
```

The edge version can change without a release tag. Restart Pi or run `/reload` after installation.

## Get the first report

1. Start Pi in a project.
2. Check the active mode and storage path:

   ```text
   /tooltime status
   ```

3. Submit a normal task and wait for Pi to finish.
4. Show the session report:

   ```text
   /tooltime report session
   ```

Analytics mode is the default. It records task analytics without changing the system prompt.

A report can look like this:

```text
Tooltime report · session
tasks: 3
task wall: 4m 18s
tool wall: 2m 6s (49% of task wall)
tool call sum: 2m 41s
calls: 18 (1 failed)
suspected avoidable wall: 28s

Top tools:
- bash: 1m 28s across 6 calls, 1 failed
- read: 42s across 7 calls
- grep: 31s across 5 calls

Efficiency findings:
- repeat.expensive-identical (high): 2 tasks, 20s suspected
- search.slow-empty (medium): 1 task, 8.0s suspected
```

This sample is illustrative. A finding is evidence, not proof that work was avoidable.

## Modes

| Mode | Record new Task Traces | Change the system prompt |
| --- | --- | --- |
| `off` | No | No |
| `analytics` | Yes | No |
| `coach` | Yes | Yes |

Coach mode appends at most the configured number of fixed Guidance Rules. It does not block or rewrite tool calls. Observed guidance requires repeated, high-confidence findings that meet both promotion thresholds.

Select a mode for the current Pi session:

```text
/tooltime mode coach
```

The change applies to the next task. A valid `PI_TOOLTIME_MODE` value is authoritative. The command cannot override it. See [Configuration](docs/configuration.md) for mode precedence and persistence.

## Commands

| Command | Result |
| --- | --- |
| `/tooltime` or `/tooltime status` | Show mode, config sources, storage, promotion thresholds, and Remote Export status. |
| `/tooltime mode off\|analytics\|coach` | Select the mode for the current session. |
| `/tooltime report [session\|project\|Nd]` | Show measured totals. The default scope is `project`. |
| `/tooltime analyze [session\|project\|Nd]` | Send a model-safe aggregate report to the current model for analysis. |
| `/tooltime findings` | Show finding candidates and active observed guidance. |
| `/tooltime prompt` | Preview the current coach prompt. |
| `/tooltime reload` | Reload Tooltime config and local traces. |

`Nd` selects the last `N` days, such as `7d`. The accepted range is 1 to 3,650 days.

`/tooltime analyze` creates a model-visible user message that contains the report. The report can also persist in the Pi session. Pi Tooltime excludes the resulting analysis task from its own Task Traces.

The other report and status commands use Pi notifications. They do not register a permanent model tool.

## Measurements

Pi Tooltime reports two tool-time values:

- `toolWallMs` is the union of all Tool Spans. Parallel calls count once.
- `toolCallMs` is the sum of all Tool Spans. Parallel calls can make this value exceed Task Wall Time.

Use `toolWallMs` for user-visible tool occupancy. Use `toolCallMs` to inspect aggregate tool work.

The current detectors cover these patterns:

- Repeated expensive calls with the same process-local fingerprint.
- Repeated full test suites.
- Searches at root or outside the project.
- Slow searches that return an empty or error Result Kind.
- Source-routing mismatches for an explicit single-source task intent.

See [Terminology](docs/terminology.md) for exact report and API names.

## Configuration, data, and Remote Export

The Pi agent directory comes from `PI_CODING_AGENT_DIR` when set. Its default is `~/.pi/agent`.

Global config is at `<agent-dir>/tooltime.json`. A trusted project can add local settings at `.pi/tooltime.json`.

- [Configuration](docs/configuration.md) lists every key, range, environment variable, and precedence rule.
- [Data and privacy](docs/data-and-privacy.md) lists transient, local, remote, and model-visible data.
- [Remote Export](docs/remote-export.md) defines the HTTP contract and receiver duties.

Remote Export is off by default. Project config cannot control it. File-based remote config requires an absolute agent directory. Both the configured and resolved directory and config paths must stay outside the project. User environment variables remain available in all agent-directory locations.

## Updates

A pinned Git ref stays pinned during `pi update --extensions` and `pi update --all`. These commands can reconcile the checkout to that ref.

To move a pinned installation, set `NEW_TAG` to the next reviewed release tag and run:

```bash
pi install "git:github.com/Jeecabs/pi-tooltime@${NEW_TAG:?set NEW_TAG first}"
```

Update an unpinned edge installation with:

```bash
pi update --extensions
```

Restart Pi or run `/reload` after the checkout changes.

## Core API

The package includes compiled JavaScript and declarations in `dist/`. Eval harnesses can use the Pi-independent Node.js core without loading the extension.

See [Core API](docs/core-api.md) for the curated v1-candidate interface, lifecycle contract, decoding rules, optional peer behavior, and stability policy.

## Architecture

The package has three parts:

1. A Pi-independent core records traces, calculates timing, detects findings, aggregates evidence, and builds guidance.
2. A Pi adapter connects lifecycle events, commands, session mode, and prompt injection.
3. Internal storage and remote adapters persist local traces and send the smaller remote subset when enabled.

See [Architecture](docs/architecture.md) for event ordering, trace boundaries, promotion, and eval use.

## Development and project policy

```bash
pnpm install --frozen-lockfile
pnpm verify
pi -e .
```

`pnpm verify` runs the native TypeScript check, focused tests, rebuild, packed Core contract, package linters, and package-content check.

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Release process](docs/releasing.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Uninstall and delete data

Use the same package source that appears in `pi list`. For the pinned global install above, run:

```bash
pi remove git:github.com/Jeecabs/pi-tooltime@v1.0.0-rc.1
```

For a project-local install, include both the source and `-l`:

```bash
pi remove git:github.com/Jeecabs/pi-tooltime@v1.0.0-rc.1 -l
```

Omit `@v1.0.0-rc.1` if you installed the unpinned source. Restart Pi or run `/reload` after removal.

The remove command does not delete analytics or config. Stop all Pi processes before the next commands. They permanently delete local Tooltime data and user-global Tooltime config.

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
rm -rf -- "$agent_dir/state/pi-tooltime"
rm -f -- "$agent_dir/tooltime.json"
```

Also complete these steps when applicable:

1. Delete `.pi/tooltime.json` from each project that has one.
2. Remove all `PI_TOOLTIME_*` definitions from shell profiles, service config, and secret stores.
3. Delete affected Pi session files if you must remove persisted mode entries or `/tooltime analyze` reports.
4. Ask the Remote Export receiver operator to delete exported records.
