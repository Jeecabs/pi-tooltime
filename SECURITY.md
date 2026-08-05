# Security Policy

## Supported versions

Security fixes target the latest release in the 1.x series, including the current release candidate.

| Version | Supported |
| --- | --- |
| Latest 1.x release or release candidate | Yes |
| Older releases and unreleased commits | No support commitment |

Upgrade to the latest release before you report a problem when it is safe to do so.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Jeecabs/pi-tooltime/security/advisories/new).

Do not report a vulnerability in a public issue, discussion, pull request, or session transcript.

Include these details when possible:

- Affected version or commit.
- Relevant mode and config keys.
- Steps to reproduce the problem.
- Expected and actual behavior.
- Security or privacy effect.
- Minimal proof of concept.
- Suggested fix, when available.

Use synthetic values. Remove secrets, raw prompts, tool payloads, tool output, file contents, database rows, project paths, session IDs, and Remote Export tokens.

## Security-sensitive areas

Report these classes of problems privately:

- Raw content entering a local Task Trace or Remote Trace.
- Local Fingerprints entering Remote Export.
- Project config controlling Remote Export.
- File config controlling Remote Export from a relative or project-contained agent directory.
- A valid `PI_TOOLTIME_MODE` not remaining authoritative.
- Arbitrary action, guidance, finding, or extra text surviving sanitization.
- Remote endpoint validation or redirect bypass.
- Remote bearer-token validation or token exposure in JSON, status, logs, or errors.
- Storage permission, symbolic-link, hard-link, retention, or size-limit bypass.
- `/tooltime analyze` exposing custom tool identifiers or sending more data than its model-safe report.
- A denial of service caused by hostile trace or tool input data.

Exact timestamps, normalized tool identifiers, local IDs, timing, and policy metadata are sensitive analytics. Their presence in the documented destination schema is not a redaction failure by itself.

## Disclosure

Maintainers review private reports and coordinate fixes through the GitHub advisory. Do not disclose details publicly until maintainers and the reporter agree on timing.

For non-security help, use [Support](SUPPORT.md). For data boundaries, read [Data and privacy](docs/data-and-privacy.md).
