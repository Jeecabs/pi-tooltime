# Releasing

Pi Tooltime releases are Git tags and GitHub Releases. This project does not publish packages to npm.

Do not run `npm publish` or `pnpm publish`. Keep the package marked private unless project policy changes through a separate reviewed decision.

## 1. Pass the rights and license gate

Complete this gate before any public release:

1. Confirm that the releasing owner has the right to distribute every repository file.
2. Record the license decision from the owner.
3. Add or update required license and third-party notice files.
4. Make package metadata, repository notices, and release notes agree.
5. Get owner approval for the exact release commit.

Stop when ownership, redistribution rights, or license terms are unknown. Public source visibility does not replace this gate.

This procedure does not select or state a project license.

## 2. Select the version

Set a shell variable for the release tag:

```bash
export TAG=v0.1.0
```

Make sure these values agree:

- `package.json` version.
- The matching `CHANGELOG.md` heading and date.
- Version strings in generated output and request headers.
- README installation examples for the release.

Do not reuse or move an existing public tag.

## 3. Prepare a clean release commit

Start from the intended release branch and current remote state:

```bash
git fetch --prune origin
git switch main
git pull --ff-only origin main
git status --short
```

The status must be empty before release checks. Review the complete change from the previous release or repository start:

```bash
git log --oneline --decorate --reverse
git diff --stat "${PREVIOUS_TAG:-$(git hash-object -t tree /dev/null)}" HEAD
```

For a first release, review all tracked files. For later releases, set `PREVIOUS_TAG` to the prior tag.

## 4. Scan for secrets

Run the maintainer-approved secret scanner against Git history and the working tree. The following example uses Gitleaks:

```bash
gitleaks git --redact --no-banner .
gitleaks dir --redact --no-banner .
```

Also inspect high-risk file names and common credential markers:

```bash
git ls-files | grep -Ei '(^|/)(\.env|auth|credential|secret|token|private[-_]?key)(\.|$)' || true
git grep -nEi '(api[_-]?key|authorization:|bearer |private key|client[_-]?secret)' -- . ':!pnpm-lock.yaml' || true
```

Review every match. Stop for a real secret. Revoke it before history cleanup and release.

A clean grep is not a substitute for a secret scanner.

## 5. Install from the lockfile

Use the package-manager version in `packageManager`:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not update dependencies during a release check. Make dependency updates in a separate reviewed commit.

## 6. Verify code and committed build output

Run the repository verification command:

```bash
pnpm verify
```

`pnpm verify` checks types, tests, build output, and package contents.

Then make sure the build did not change committed `dist/` files:

```bash
git diff --exit-code -- dist
git status --short
```

The status must still be empty. If `dist/` changed, commit the source and generated output together. Repeat the checks from a clean commit.

## 7. Smoke-test the packed core

Create a tarball from the already verified files. Do not run publication scripts:

```bash
release_tmp="$(mktemp -d)"
npm pack --ignore-scripts --pack-destination "$release_tmp"
tarball="$(find "$release_tmp" -maxdepth 1 -name 'pi-tooltime-*.tgz' -print -quit)"
test -n "$tarball"
tar -tzf "$tarball"
```

Install that tarball without optional peers. Then import the Pi-independent core:

```bash
mkdir "$release_tmp/consumer"
cd "$release_tmp/consumer"
npm init -y >/dev/null
npm install --ignore-scripts --omit=optional "$tarball"
node --input-type=module <<'EOF'
const core = await import("pi-tooltime");
for (const name of [
  "TooltimeLifecycleError",
  "analyzeTraces",
  "createTaskRecorder",
  "decodeTaskTrace",
  "formatAnalysis",
]) {
  if (!(name in core)) throw new Error(`Missing core export: ${name}`);
}
console.log("core import smoke: ok");
EOF
cd -
```

This smoke test confirms that core-only use does not require the optional Pi peer at runtime.

## 8. Smoke-test the Pi extension through RPC

Run Pi with an isolated agent directory. Disable discovered extensions and load the release checkout explicitly:

```bash
rpc_agent_dir="$release_tmp/pi-agent"
printf '%s\n' \
  '{"id":"commands","type":"get_commands"}' \
  '{"id":"status","type":"prompt","message":"/tooltime status"}' |
  PI_CODING_AGENT_DIR="$rpc_agent_dir" \
  PI_TOOLTIME_MODE=off \
  pi --mode rpc --no-session --no-context-files --no-skills \
    --no-prompt-templates --no-extensions -e . \
  >"$release_tmp/rpc.jsonl"
```

Validate strict JSONL output and the command response:

```bash
node --input-type=module - "$release_tmp/rpc.jsonl" <<'EOF'
import { readFileSync } from "node:fs";

const events = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const commands = events.find((event) => event.id === "commands");
const status = events.find((event) => event.id === "status");
if (!commands?.success) throw new Error("get_commands RPC failed");
if (!commands.data.commands.some((command) => command.name === "tooltime")) {
  throw new Error("tooltime command missing");
}
if (!status?.success) throw new Error("/tooltime status RPC failed");
console.log("Pi RPC smoke: ok");
EOF
```

Review the JSONL file for `extension_error` events. Stop if any appear.

## 9. Commit and push

Update the changelog and release documentation before the release commit. Review the final diff:

```bash
git diff --check
git status --short
git log -1 --show-signature --stat
```

Push the release commit to the protected release branch through the normal review process:

```bash
git push origin main
```

Wait for the GitHub `CI` workflow on that exact commit. Both supported Node.js jobs must be green. Do not tag a commit with pending, skipped, cancelled, or failed required checks.

## 10. Create an annotated tag

Use a signed annotated tag when repository config enables tag signing and a signing identity is available:

```bash
git tag -s "$TAG" -m "Pi Tooltime ${TAG#v}"
```

When the project has no configured signing identity, create an unsigned annotated tag:

```bash
git tag -a "$TAG" -m "Pi Tooltime ${TAG#v}"
```

Verify the tag points to the green release commit:

```bash
git show --no-patch --decorate "$TAG"
git rev-parse "$TAG^{}"
git rev-parse HEAD
```

The two commit IDs must match. Then push only the selected tag:

```bash
git push origin "$TAG"
```

## 11. Create the GitHub Release

Copy the matching changelog section into a temporary release-notes file. Check every claim against the tagged code and tests.

```bash
gh release create "$TAG" \
  --verify-tag \
  --title "Pi Tooltime ${TAG#v}" \
  --notes-file /path/to/release-notes.md
```

Open the release page without authentication and verify the tag, source archives, notes, and links.

Do not attach an npm publication. Do not run an npm publish command after the GitHub Release.

## 12. Verify an unauthenticated clone

Clone the public tag without stored GitHub credentials:

```bash
public_dir="$release_tmp/public-clone"
public_home="$release_tmp/public-home"
public_xdg="$release_tmp/public-xdg"
mkdir -p "$public_home" "$public_xdg"
env -u GH_TOKEN -u GITHUB_TOKEN -u GIT_CONFIG_GLOBAL \
  HOME="$public_home" \
  XDG_CONFIG_HOME="$public_xdg" \
  GIT_CONFIG_GLOBAL=/dev/null \
  GIT_CONFIG_NOSYSTEM=1 \
  GIT_TERMINAL_PROMPT=0 \
  GIT_ASKPASS=/bin/false \
  git -c credential.helper= clone \
    --depth 1 --branch "$TAG" \
    https://github.com/Jeecabs/pi-tooltime.git \
    "$public_dir"
```

Run the frozen install and verification from that clone:

```bash
cd "$public_dir"
pnpm install --frozen-lockfile
pnpm verify
```

Repeat the packed-core and Pi RPC smoke tests from the public clone. Confirm that README installation and internal documentation links resolve.

Remove temporary files after all checks pass:

```bash
rm -rf -- "$release_tmp"
```

## 13. Record the result

Record these release facts in the maintainer log or release issue:

- Release tag and commit ID.
- Rights and license gate approval.
- Secret scanner and version.
- `pnpm verify` result.
- Clean `dist/` result.
- Tarball import result.
- Pi RPC result.
- GitHub CI run URL.
- Tag signature status.
- GitHub Release URL.
- Unauthenticated clone result.

For later changes, add entries under [Unreleased](../CHANGELOG.md). Never edit a published tag.
