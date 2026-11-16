import { parseArgs } from "node:util";

export const COOK_OPTIONS = {
  workflow: { type: "string" },
  resources: { type: "string" },
  mode: { type: "string" },
  drive: { type: "string" },
  architecture: { type: "string" },
  layout: { type: "string" },
  legacy: { type: "string" },
  target: { type: "string" },
  provider: { type: "string", multiple: true },
  iterations: { type: "boolean" },
  duration: { type: "string" },
  "start-date": { type: "string" },
  "demo-day": { type: "string" },
  lang: { type: "string" },
  "test-cmd": { type: "string" },
  src: { type: "string", multiple: true },
  tests: { type: "string", multiple: true },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
} as const;

export const UPGRADE_OPTIONS = { "dry-run": COOK_OPTIONS["dry-run"], yes: COOK_OPTIONS.yes };

/** `--mode`, `--drive`, `--test-cmd`, `--src` and `--tests` (repeatable); null when anything else is passed. */
export function initFlags(args: string[], command: "cook" | "upgrade") {
  try {
    if (command === "upgrade") parseArgs({ args, options: UPGRADE_OPTIONS });
    const { values } = parseArgs({ args, options: COOK_OPTIONS });
    return {
      workflow: values.workflow,
      resources: values.resources,
      mode: values.mode,
      drive: values.drive,
      architecture: values.architecture,
      layout: values.layout,
      legacy: values.legacy,
      target: values.target,
      providers: values.provider,
      iterations: values.iterations,
      duration: values.duration,
      startDate: values["start-date"],
      demoDay: values["demo-day"],
      lang: values.lang,
      testCmd: values["test-cmd"],
      src: values.src ?? [],
      tests: values.tests ?? [],
      dryRun: values["dry-run"],
      yes: values.yes,
    };
  } catch {
    return null;
  }
}
