import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const version = packageJson.version;
const tag = `v${version}`;
const major = version.split(".", 1)[0];
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const assertLine = (path, expected, count = 1) => {
  const matches = read(path)
    .split("\n")
    .filter((line) => line.trim() === expected).length;
  assert.equal(matches, count, `${path} must contain ${count} exact line(s): ${expected}`);
};

assert.equal(packageJson.name, "pi-tooltime", "package name must remain pi-tooltime");
assert.equal(packageJson.private, true, "GitHub-only releases must keep private: true");
assert.equal(packageJson.type, "module", "package must remain ESM");
assert.equal(packageJson.packageManager, "pnpm@10.28.2", "package manager must match the release toolchain");
assert.equal(packageJson.engines?.node, ">=22.19.0", "Node engine must match the supported runtime");
assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.83.0", "Pi peer range must match the supported runtime");
assert.equal(packageJson.author, "Lachlan Jacobs <lachlan.jacobs@protonmail.com>", "package author must use the approved identity");
assert.equal(packageJson.repository?.url, "git+https://github.com/Jeecabs/pi-tooltime.git", "repository URL must target the canonical repository");
assert.equal(packageJson.bugs?.url, "https://github.com/Jeecabs/pi-tooltime/issues", "bugs URL must target the canonical repository");
assert.equal(packageJson.homepage, "https://github.com/Jeecabs/pi-tooltime#readme", "homepage must target the canonical README");
assert.match(version, semver, "package version must use SemVer 2.0.0");

assertLine("src/version.ts", `export const PACKAGE_VERSION = "${version}";`);
assertLine("dist/version.js", `export const PACKAGE_VERSION = "${version}";`);
assertLine("dist/version.d.ts", `export declare const PACKAGE_VERSION = "${version}";`);
assertLine("src/remote.ts", '"User-Agent": `pi-tooltime/${PACKAGE_VERSION}`,');
assertLine("dist/remote.js", '"User-Agent": `pi-tooltime/${PACKAGE_VERSION}`,');
assertLine("README.md", `pi install git:github.com/Jeecabs/pi-tooltime@${tag}`);
assertLine("README.md", `pi remove git:github.com/Jeecabs/pi-tooltime@${tag}`);
assertLine("README.md", `pi remove git:github.com/Jeecabs/pi-tooltime@${tag} -l`);
assertLine("README.md", "- Git access to GitHub. This package is not published to npm.");
assertLine(".github/ISSUE_TEMPLATE/bug_report.yml", `placeholder: ${version}`);
assertLine(".github/ISSUE_TEMPLATE/question.yml", `placeholder: ${version}`);
assertLine("CHANGELOG.md", `[Unreleased]: https://github.com/Jeecabs/pi-tooltime/compare/${tag}...HEAD`);
assertLine("CHANGELOG.md", `[${version}]: https://github.com/Jeecabs/pi-tooltime/releases/tag/${tag}`);
assertLine("docs/core-api.md", `"pi-tooltime": "github:Jeecabs/pi-tooltime#${tag}"`);
assertLine("docs/core-api.md", `- \`pi-tooltime@${major}.x\` means Core interface v${major}.`);
assertLine("docs/remote-export.md", `User-Agent: pi-tooltime/${version}`);
assertLine("docs/releasing.md", `export TAG=${tag}`);

const changelogRelease = read("CHANGELOG.md").match(/^## \[Unreleased\]\s+## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/mu);
assert.equal(changelogRelease?.[1], version, "first changelog release must match the package version");

const concreteTag = /v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/gu;
const releaseTagDocs = ["README.md", "docs/core-api.md", "docs/releasing.md"];
if (existsSync(join(root, "docs/index.html"))) releaseTagDocs.push("docs/index.html");
for (const path of releaseTagDocs) {
  const tags = new Set(read(path).match(concreteTag) ?? []);
  assert.deepEqual([...tags], [tag], `${path} must not refer to a conflicting concrete release tag`);
}

assert.ok(read("SECURITY.md").includes(`latest release in the ${major}.x series`), "SECURITY.md support line must match the package major");

if (process.argv.includes("--require-license")) {
  assert.notEqual(packageJson.license, "UNLICENSED", "select an SPDX license before release");
  assert.ok(existsSync(join(root, "LICENSE")), "add LICENSE before release");
  const licenseSection = read("README.md").split("## License", 2)[1];
  assert.ok(licenseSection, "add a README License section before release");
  assert.ok(licenseSection.includes(`\`${packageJson.license}\``), "README License section must name the package SPDX license");
}

console.log(`Release metadata: ${tag} ok`);
