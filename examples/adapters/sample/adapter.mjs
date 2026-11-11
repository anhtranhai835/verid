// Sample reheat adapter for a fake legacy format: <legacyRoot>/<unit>/screen.json.
// verid runs one step per call and reads one JSON document from stdout:
//   inventory <legacyRoot>                  -> { units: [{ id, title, family?, parent? }] }
//   extract <legacyRoot> <unit> <unitDir>   -> { unit, files }   (written below <unitDir>/spec/legacy)
//   gate <legacyRoot> <unit> <specPath>     -> { unit, pass, findings: [{ severity, rule, message }] }
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [step, legacyRoot, unit, third] = process.argv.slice(2);
const screenFile = (id) => join(legacyRoot, id, "screen.json");
const screen = (id) => JSON.parse(readFileSync(screenFile(id), "utf8"));
const print = (value) => console.log(JSON.stringify(value));

if (step === "inventory") {
  const units = readdirSync(legacyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(screenFile(entry.name)))
    .map((entry) => {
      const { title, family, parent } = screen(entry.name);
      return { id: entry.name, title, ...(family && { family }), ...(parent && { parent }) };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  print({ units });
} else if (step === "extract") {
  const target = join(third, "spec", "legacy");
  mkdirSync(target, { recursive: true });
  copyFileSync(screenFile(unit), join(target, "screen.json"));
  print({ unit, files: ["screen.json"] });
} else if (step === "gate") {
  // The spec must name every input the legacy screen handles.
  const spec = existsSync(third) ? readFileSync(third, "utf8") : "";
  const findings = (screen(unit).behaviors ?? [])
    .filter((behavior) => !spec.includes(behavior.input))
    .map((behavior) => ({
      severity: "error",
      rule: "behaviour-covered",
      message: `spec/spec.md never mentions the legacy input "${behavior.input}"`,
    }));
  print({ unit, pass: findings.length === 0, findings });
} else {
  console.error("usage: adapter.mjs inventory|extract|gate ...");
  process.exit(2);
}
