// Usage: node scripts/release-notes.mjs [vX.Y.Z]
// Checks that the tag names the package.json version, then prints that version's CHANGELOG
// section as release notes. Without a tag it checks the current version. Exits 1 on a mismatch
// or an empty section. Runs from the repository root.
import { readFileSync } from "node:fs";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.argv[2];
if (tag !== undefined && tag !== `v${version}`)
  fail(`Tag ${tag} does not match package.json: expected v${version}.`);

const lines = readFileSync("CHANGELOG.md", "utf8").replaceAll("\r", "").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
const notes =
  start < 0
    ? ""
    : lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join("\n")
        .trim();
if (!notes) fail(`CHANGELOG.md has no entry under "## [${version}]".`);
process.stdout.write(`${notes}\n`);
