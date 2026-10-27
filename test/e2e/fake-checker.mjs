// Stands in for a project's architecture checker (ArchUnit, dependency-cruiser, Import Linter):
// `fake-checker.mjs <exit> [delay ms] [file]` prints a line, waits, appends to `file` (relative
// to its working dir) when given, and exits with `exit`.
import { appendFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const [exit = "0", delay = "0", file] = process.argv.slice(2);
console.log(`fake checker: exit ${exit}`);
await setTimeout(Number(delay));
if (file) appendFileSync(file, "// touched by the checker\n");
process.exitCode = Number(exit);
