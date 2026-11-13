import * as z from "zod/mini";
import type { ReheatUnit } from "./state.js";

/** A unit is a module of the plan, so it carries a module's name. */
export const UNIT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const unitId = z.string().check(z.regex(UNIT_ID));
const line = z.string().check(
  z.minLength(1),
  z.maxLength(200),
  z.refine((value) => !/[\x00-\x1f]/.test(value)),
);

/** A file below a unit's spec/legacy folder: relative, portable, no way out of the folder. */
const unitFile = z.string().check(
  z.minLength(1),
  z.maxLength(200),
  z.refine((path) =>
    path
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !/[\\<>:"|?*\x00-\x1f]/.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ),
  ),
);

/** What each adapter command prints on stdout, as one JSON document. Extra keys are ignored. */
const inventoryOutput = z.looseObject({
  units: z
    .array(
      z.looseObject({
        id: unitId,
        title: line,
        parent: z.optional(unitId),
        family: z.optional(line),
      }),
    )
    .check(z.maxLength(2000)),
});
const extractOutput = z.looseObject({
  unit: unitId,
  files: z.array(unitFile).check(z.maxLength(500)),
});
const gateOutput = z.looseObject({
  unit: unitId,
  pass: z.boolean(),
  findings: z
    .array(
      z.looseObject({
        severity: z.enum(["error", "warning", "info"]),
        rule: line,
        message: z.string().check(z.maxLength(1000)),
      }),
    )
    .check(z.maxLength(200)),
});
export const ADAPTER_OUTPUT = {
  inventory: inventoryOutput,
  extract: extractOutput,
  gate: gateOutput,
} as const;
export type AdapterKind = keyof typeof ADAPTER_OUTPUT;
export type AdapterOutput<K extends AdapterKind> = z.infer<(typeof ADAPTER_OUTPUT)[K]>;

/** The placeholders an adapter command may name; each is filled with one whole argument. */
export interface AdapterContext {
  legacyRoot: string;
  unit: string;
  unitDir: string;
  specPath: string;
}

/** The three parts a parity record needs, in the order the template lists them. */
export const PARITY_SECTIONS = ["Inputs", "Legacy results", "New results"] as const;

/** Why `release/parity.md` is not yet evidence, or null when all three parts say something. */
export function parityProblem(text: string): string | null {
  for (const name of PARITY_SECTIONS) {
    const heading = new RegExp(`^##[ \\t]+${name}[ \\t]*\\r?$`, "im").exec(text);
    if (!heading) return `missing the section "## ${name}"`;
    const rest = text.slice(heading.index + heading[0].length);
    const body = rest.split(/^##[ \t]/m)[0] ?? "";
    if (!body.trim() || body.includes("[NEEDS CLARIFICATION"))
      return `the section "## ${name}" is empty`;
  }
  return null;
}

type GateState = "none" | "pass" | "fail" | "stale";
type ParityState = "none" | "unsigned" | "signed";
export interface UnitStatus {
  extracted: boolean;
  gate: GateState;
  parity: ParityState;
}

/**
 * Where a unit stands now. `inputs` is the hash of what the gate judges today and `parity` the hash
 * of the parity record when it holds all three parts; a gate or signature made on other bytes is
 * stale or unsigned, however it was recorded.
 */
export function unitStatus(
  unit: ReheatUnit,
  inputs: string | null,
  parity: string | null,
): UnitStatus {
  return {
    extracted: unit.extracted !== undefined,
    gate:
      unit.gate === undefined
        ? "none"
        : unit.gate.inputs_sha256 !== inputs
          ? "stale"
          : unit.gate.pass
            ? "pass"
            : "fail",
    parity: parity === null ? "none" : unit.parity?.sha256 === parity ? "signed" : "unsigned",
  };
}

/** One line for `verid menu`. */
export const statusText = (status: UnitStatus): string =>
  `extract ${status.extracted ? "yes" : "no"} · gate ${status.gate} · parity ${status.parity}`;
