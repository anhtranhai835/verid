// Stands in for a real test runner: copies a recorded JUnit report to the path verid passes
// as {junit}, prints some output and exits, all as scenario.json in its working dir says.
// `delay` (ms) keeps it running, like a slow suite; `marker` is a file written once it ends.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const scenario = JSON.parse(readFileSync("scenario.json", "utf8"));
// `env`: the report path arrives in VERID_OUT, set by the shell from verid's VERID_JUNIT.
const out = process.argv[2] === "env" ? process.env.VERID_OUT : process.argv[2];
if (scenario.junit)
  copyFileSync(join(import.meta.dirname, "..", "fixtures", "junit", scenario.junit), out);
console.log(scenario.output);
await setTimeout(scenario.delay ?? 0);
if (scenario.marker) writeFileSync(scenario.marker, "finished");
process.exitCode = scenario.exit;
