# Configuration

Pi Tooltime uses JSON config, environment variables, and optional session mode state. Unknown or invalid values produce warnings. They do not replace the last valid value.

## Config files

The user-global file is:

```text
<agent-dir>/tooltime.json
```

`<agent-dir>` is the value of `PI_CODING_AGENT_DIR` when set. The default path is `~/.pi/agent/tooltime.json`.

File-based Remote Export config has an extra location check. The configured agent directory must be absolute. Both the configured and resolved agent directory and `tooltime.json` paths must be outside the current project directory.

When this check fails, Pi Tooltime still reads other settings from the file. It ignores the complete `remote` value and produces a warning. `PI_TOOLTIME_REMOTE_*` environment variables still work.

The project file is:

```text
.pi/tooltime.json
```

Pi Tooltime reads project config only after Pi trusts the project. It does not read this file in an untrusted project.

A trusted project can change local analytics and coach settings. It cannot change Remote Export. Pi Tooltime ignores the complete project `remote` value and produces a warning.

## Example

```json
{
  "mode": "analytics",
  "retentionDays": 30,
  "maxTasks": 2000,
  "maxCallsPerTask": 500,
  "slowCallMs": 5000,
  "minTasks": 3,
  "minTotalDurationMs": 30000,
  "maxPromptChars": 500,
  "maxPromptRules": 3,
  "includeBaselineGuidance": true,
  "remote": {
    "enabled": false,
    "endpoint": "https://telemetry.example.com/pi-tooltime",
    "timeoutMs": 5000
  }
}
```

Put `remote` only in an eligible user-global file. Put the bearer token in `PI_TOOLTIME_REMOTE_TOKEN`, not in JSON.

## Keys

All numeric values must be integers.

| Key | Type | Default | Accepted value | Meaning |
| --- | --- | --- | --- | --- |
| `mode` | string | `analytics` | `off`, `analytics`, or `coach` | Fallback capture and prompt mode. |
| `retentionDays` | number | `30` | 1 to 3,650 | Local trace retention window. |
| `maxTasks` | number | `2000` | 10 to 10,000 | Maximum Task Traces returned for reports and guidance. It also caps each active writer file after compaction. |
| `maxCallsPerTask` | number | `500` | 10 to 5,000 | Maximum stored Tool Spans in one Task Trace. |
| `slowCallMs` | number | `5000` | 0 to 3,600,000 | Slow empty-search threshold. The repeated-call threshold is the lower of this value and 2,000 ms. |
| `minTasks` | number | `3` | 1 to 100 | Minimum affected tasks for observed guidance. |
| `minTotalDurationMs` | number | `30000` | 0 to 86,400,000 | Minimum total suspected time for observed guidance. |
| `maxPromptChars` | number | `500` | 120 to 2,000 | Maximum coach prompt length. |
| `maxPromptRules` | number | `3` | 1 to 10 | Maximum coach Guidance Rules. |
| `includeBaselineGuidance` | boolean | `true` | `true` or `false` | Fill unused coach slots with fixed baseline rules. |
| `remote.enabled` | boolean | `false` | `true` or `false` | Enable Remote Export from eligible user-global config. |
| `remote.endpoint` | string | none | Nonempty URL | Remote POST endpoint. Transport checks apply when export starts. |
| `remote.timeoutMs` | number | `5000` | 100 to 60,000 | Timeout for each remote request. |

`maxCallsPerTask` bounds stored call details. Timing totals still include calls omitted after this limit. `droppedCallCount` contains the omitted count.

Storage has separate byte limits. See [Data and privacy](data-and-privacy.md) for exact local limits and retention behavior.

## Environment variables

| Variable | Accepted value | Effect |
| --- | --- | --- |
| `PI_TOOLTIME_MODE` | `off`, `analytics`, or `coach` | Sets the authoritative mode. |
| `PI_TOOLTIME_REMOTE_ENABLED` | `true` or `false` | Enables or disables Remote Export. |
| `PI_TOOLTIME_REMOTE_ENDPOINT` | Nonempty URL | Sets or replaces the eligible file endpoint. |
| `PI_TOOLTIME_REMOTE_TOKEN` | RFC 6750-style token characters | Adds `Authorization: Bearer <token>` to remote requests. |

Pi Tooltime trims these values. It compares the Remote Export boolean without case sensitivity. An empty value has no effect.

An invalid nonempty mode or boolean produces a warning. It does not replace a valid lower-precedence value.

The remote adapter trims the token. A nonempty token must match `^[A-Za-z0-9\-._~+/]+=*$`. This permits letters, digits, `-._~+/`, and trailing `=` padding.

An unsupported character rejects exporter setup with a generic error that does not repeat the token. An empty token omits the header.

The token does not enter loaded config, local traces, remote JSON, status output, or Tooltime error messages.

## Precedence

Later sources replace earlier sources for local analytics and coach settings:

1. Built-in defaults.
2. User-global config.
3. Trusted project config.
4. Supported environment variables.

Session mode adds one rule. Without a valid `PI_TOOLTIME_MODE`, `/tooltime mode` records the selected mode in the current Pi session branch. That saved mode replaces the configured fallback.

A valid `PI_TOOLTIME_MODE` is authoritative. It replaces JSON and saved session mode state. `/tooltime mode` cannot override it.

Remote Export uses a narrower chain:

1. Built-in remote defaults.
2. The eligible user-global `remote` object.
3. `PI_TOOLTIME_REMOTE_ENABLED` and `PI_TOOLTIME_REMOTE_ENDPOINT`.
4. `PI_TOOLTIME_REMOTE_TOKEN` for the request header only.

Project `remote` config never enters this chain. File config from a relative or project-contained agent directory also stays out of this chain.

Environment variables still enter the chain in those locations. When Pi Tooltime ignores file remote config, it also ignores `timeoutMs`. Environment opt-in therefore uses the built-in timeout because no timeout environment variable exists.

## Mode behavior

`analytics` is the default. It records local Task Traces without changing the system prompt.

`coach` records Task Traces and can append Guidance Rules to the system prompt. Select it through global config, trusted project config, the mode command, or the environment.

`off` stops new Task Traces and prompt guidance. Existing local traces remain available until they expire or you delete them.

A mode command change applies to the next task. Pi stores the value as a custom session entry. Pi does not send that custom entry to the model.

## Reload behavior

Pi Tooltime does not watch config files.

After you edit a JSON file, run:

```text
/tooltime reload
```

This command waits for current agent work to finish. It closes incomplete Tooltime work, flushes pending writes, reads config, and reloads local traces.

Use `/reload` after you install or update the extension. This command reconstructs the extension and reads config again.

A running process cannot receive environment changes made in its parent shell. Restart Pi after you change `PI_TOOLTIME_*` in a shell profile or service definition.

## Validation and warnings

Pi Tooltime reports these conditions as warnings:

- Malformed JSON.
- A config root that is not an object.
- Unknown top-level or remote keys.
- A value with the wrong type or range.
- An invalid mode or environment boolean.
- Enabled Remote Export without an endpoint.
- Project `remote` configuration.
- File remote config from a relative or project-contained agent directory.
- A bearer token with unsupported characters.
- A rejected remote URL when export starts.

A warning does not fail the agent. Run `/tooltime status` to inspect active sources and the latest storage or remote error.

See [Remote Export](remote-export.md) for endpoint validation and delivery behavior.
