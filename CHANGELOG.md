# Changelog

All notable project changes appear in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Replaced the package-root wildcard barrel with the curated Core v1 candidate.
- Added a strict raw-event task recorder, trace decoding diagnostics, deeply frozen outputs, audience-explicit formatting, and rejected-trace accounting.
- Made finding task aggregation independent of caller-supplied task ID uniqueness.
- Made Core ordering independent of host locale and removed quadratic mutation-barrier scans from finding detection.
- Moved type checking and declaration builds to the locked TypeScript 7 native compiler (`tsgo`).

## [0.1.0] - 2026-08-05

### Added

- Added `off`, `analytics`, and `coach` modes with environment mode authority.
- Added status, report, analyze, findings, prompt preview, mode, and reload commands.
- Added local JSONL Task Traces with exact task, tool-wall, and tool-call timing.
- Added fixed call classifications, fixed Result Kinds, and process-keyed `h1:` Local Fingerprints.
- Added deterministic detectors for repeated calls, full-suite loops, broad searches, slow empty searches, and explicit source-routing mismatches.
- Added bounded baseline and observed Guidance Rules with policy version fields.
- Added the Pi-independent package-root core API and compiled declarations.
- Added opt-in Remote Export with an explicit smaller trace schema.
- Added project trust handling for project config. Pi Tooltime ignores project Remote Export values.
- Added a unique JSONL writer file for each store instance, including instances that share a session ID.

### Security

- Added explicit stored and remote allowlists that discard extra trace, call, and finding fields.
- Added fixed policy registries and conservative normalization for unsafe names and unknown actions.
- Added process-random HMAC keys so Local Fingerprints do not correlate across processes.
- Added local `0700` directory modes, `0600` trace modes, no-follow opens, and link checks.
- Added 4 MiB trace-line, 16 MiB active-writer-file, and 32 MiB read-budget limits.
- Added remote rejection for endpoint credentials, query strings, fragments, insecure non-loopback HTTP, and redirect responses.
- Added strict bearer-token character validation and generic redacted request failures.
- Added model-safe grouping for custom tool identifiers in `/tooltime analyze` reports.
- Added protection against file-based remote opt-in from relative or project-contained agent directories.
- Added bounded pending remote requests, timeouts, no retries, and status-only failure reporting.

[Unreleased]: https://github.com/Jeecabs/pi-tooltime/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Jeecabs/pi-tooltime/releases/tag/v0.1.0
