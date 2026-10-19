// Stands in for a real test runner: copies a recorded JUnit report to the path verid passes
// as {junit}, prints some output and exits, all as scenario.json in its working dir says.
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scenario = JSON.parse(readFileSync("scenario.json", "utf8"));
if (scenario.junit)
  copyFileSync(
    join(import.meta.dirname, "..", "fixtures", "junit", scenario.junit),
    process.argv[2],
  );
console.log(scenario.output);
process.exitCode = scenario.exit;
