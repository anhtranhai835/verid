import { bilingual } from "../adapters/i18n.js";
import { extractUnit, gateUnit, inventoryUnits } from "../adapters/reheat.js";
import { VeridError } from "../adapters/state-store.js";
import { unitBase } from "../adapters/reheat-evidence.js";
import type { CliResult } from "./test.js";

/** `inventory`, `extract <unit>` or `gate <unit>`: nothing else. */
export const reheatArgs = (args: readonly string[]): boolean =>
  (args.length === 1 && args[0] === "inventory") ||
  (args.length === 2 && (args[0] === "extract" || args[0] === "gate"));

/**
 * `verid reheat <inventory|extract|gate>`: the three steps an adapter performs on a legacy system.
 * The adapter is developer-approved code, so agents run these like `verid taste`; the signature
 * on a unit's parity record is the one step they never take (`verid serve`, or the board).
 * Exit 0: done. 1: the gate failed or the adapter failed, with no state changed. 3: the gate
 * passed and the parity record is not signed yet.
 */
export async function reheatCommand(project: string, args: readonly string[]): Promise<CliResult> {
  const [step, unit = ""] = args;
  try {
    if (step === "inventory") {
      const { units, added } = await inventoryUnits(project);
      return say(
        0,
        `verid: reheat inventory · ${units} unit${units === 1 ? "" : "s"}, ${added.length} new in .verid/plan.md`,
        bilingual("reheat.inventory_next", {}),
      );
    }
    if (step === "extract") {
      const { files, skill } = await extractUnit(project, unit);
      return say(
        0,
        `verid: reheat extract ${unit} · ${files.length} file${files.length === 1 ? "" : "s"} in ${unitBase(unit)}/spec/legacy/`,
        bilingual("reheat.extract_next", { unit, skill: skill ?? "verid:reheat" }),
      );
    }
    const result = await gateUnit(project, unit);
    const head = `verid: reheat gate ${unit} · ${result.pass ? "pass" : "fail"}`;
    if (!result.pass)
      return say(1, head, ...result.lines, bilingual("reheat.gate_failed", { unit }));
    if (!result.signed)
      return say(3, head, ...result.lines, bilingual("reheat.gate_unsigned", { unit }));
    return say(0, head, ...result.lines);
  } catch (error) {
    // An adapter that fails is not a verid refusal: exit 1, and the message names the step.
    if (error instanceof VeridError && error.code === "VERID_BURNT_ADAPTER")
      return {
        exit: 1,
        stdout: "",
        stderr: `verid [${error.code}]\n${bilingual(error.code, error.params)}\n`,
      };
    throw error;
  }
}

const say = (exit: number, ...lines: string[]): CliResult => ({
  exit,
  stdout: `${lines.join("\n")}\n`,
  stderr: "",
});
