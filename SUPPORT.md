# Support

## Bugs

Use the [bug report form](https://github.com/Jeecabs/pi-tooltime/issues/new?template=bug_report.yml). Search [existing issues](https://github.com/Jeecabs/pi-tooltime/issues) first. Add a minimal reproduction.

Include these details when relevant:

- Pi Tooltime version or Git commit.
- Pi version.
- Node.js version.
- Operating system.
- Active Tooltime mode.
- Config source and changed keys.
- Remote Export enabled or disabled.
- Exact command and error.

Do not include a complete config file when a short synthetic example is enough.

## Questions and feature requests

Use the [question form](https://github.com/Jeecabs/pi-tooltime/issues/new?template=question.yml) for usage questions. Use the [feature request form](https://github.com/Jeecabs/pi-tooltime/issues/new?template=feature_request.yml) for proposed changes.

Read the [README](README.md), [Configuration](docs/configuration.md), and [Architecture](docs/architecture.md) first.

## Security and privacy reports

Do not open a public issue for a vulnerability or suspected privacy boundary failure. Follow the [Security Policy](SECURITY.md).

Use [GitHub private vulnerability reporting](https://github.com/Jeecabs/pi-tooltime/security/advisories/new).

## Safe diagnostics

Sanitize all diagnostics before you share them. Remove or replace:

- Secrets and bearer tokens.
- Raw prompts, tool payloads, and tool output.
- File contents and database rows.
- Project, home, config, storage, and session paths.
- Remote Export endpoints that identify an internal service.
- Session and task identifiers.
- Tool identifiers that reveal a private integration.
- Exact timestamps when they can identify user activity.

`/tooltime status` can show absolute config and storage paths. It can also show the remote receiver origin and latest error. Redact these fields.

A Tooltime report contains normalized tool identifiers, exact timing, failure counts, and finding codes. Share only the lines needed to reproduce the issue.

Use synthetic values for sensitive fields. Do not send a local JSONL trace unless a maintainer requests a sanitized minimal record.

## Project policy

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
