# Contributing to Pi Tooltime

## Before you start

Search existing issues before you propose a change. Open an issue before you start a large change.

Pi Tooltime uses the [MIT License](LICENSE). By submitting a contribution, you agree to license it under MIT. You also confirm that you have the right to do so.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need:

- Node.js 22.19.0 or later.
- pnpm 10.28.2.
- Pi 0.83.0 or later for extension smoke tests.

`pnpm check` and `pnpm build` use the locked TypeScript 7 native compiler (`tsgo`).

Install the locked dependencies and build the package:

```bash
pnpm install --frozen-lockfile
pnpm build
```

Run the extension from the checkout:

```bash
pi -e .
```

## Make a change

Keep each change focused. Follow the names and relationships in [Terminology](docs/terminology.md).

Preserve these data boundaries:

- Local analytics stay on the local machine by default.
- Remote Export requires eligible user-global or environment opt-in.
- Project Remote Export config stays ignored.
- File-based remote config stays ignored when the agent directory is relative or inside the project.
- Stored schemas do not add raw prompts, tool payloads, tool output, file contents, database rows, or project paths.
- Local Fingerprints stay local and process-keyed.
- Remote bearer tokens keep their strict character validation and generic rejection errors.
- Remote records use their explicit smaller allowlist.
- Guidance text comes only from the fixed registry.
- `/tooltime analyze` remains clearly model-visible, model-safe in tool labels, and excluded from Tooltime capture.

Safe lowercase tool identifiers are intentionally preserved. Do not describe all tool names as coarse or anonymous.

Input action values must map to fixed operations. Do not store arbitrary action text.

Add or update tests for changed behavior. A data-schema change needs local sanitization, storage, and Remote Export coverage.

Run the most focused test while you work. For example:

```bash
node --test --experimental-strip-types tests/remote.test.ts
```

Select the test file that covers your change.

## Update generated output and docs

The repository commits generated `dist/` files. Run:

```bash
pnpm build
```

Include related `dist/` changes in the same pull request.

Update public docs and [CHANGELOG.md](CHANGELOG.md) when behavior, config, fields, exports, security controls, or commands change.

Lint substantial technical prose with `ste_lint` when it is available. Do not apply that linter to code, identifiers, or canonical Code of Conduct text.

## Run full checks

Before you open a pull request, run:

```bash
pnpm verify
git diff --check
git diff --exit-code -- dist
```

The last command must run after `pnpm verify`. It confirms that committed build output is current.

If the command shows a `dist/` diff, rebuild and commit the generated files. Then repeat all checks.

## Open a pull request

Use the pull request template. Explain the reason for the change and its privacy effect.

Do not include secrets, raw prompts, tool payloads, tool output, file contents, database rows, or project paths. Sanitize logs and screenshots.

Tooltime status can contain absolute config and storage paths. It can also contain a Remote Export receiver origin. Redact these values before you post diagnostics.

Maintainers can request changes before merge. Release work must also follow the [release process](docs/releasing.md).

## Project links

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Data and privacy](docs/data-and-privacy.md)
- [Core API](docs/core-api.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
