import { createHash } from "node:crypto";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_INPUTS } from "../core/plan.js";
import { parityProblem, unitStatus, type UnitStatus } from "../core/reheat.js";
import type { State } from "../core/state.js";
import { ownEntry } from "../core/station.js";
import { errno } from "./state-store.js";

/** A unit's dossier is the module folder the plan names for it. */
export const unitBase = (unit: string): string => `.verid/artifacts/03-modules/${unit}`;
export const unitFolder = (project: string, unit: string): string =>
  join(project, ...unitBase(unit).split("/"));
export const legacyFolder = (project: string, unit: string): string =>
  join(unitFolder(project, unit), "spec", "legacy");
export const parityRel = (unit: string): string => `${unitBase(unit)}/release/parity.md`;

const read = (file: string): Buffer | null => {
  try {
    return readFileSync(file);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes(errno(error) ?? "")) return null;
    throw error;
  }
};

/** Every file below a folder, relative with `/` and sorted; none when it is not there. */
export function filesBelow(folder: string, prefix = ""): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(folder, prefix), { withFileTypes: true });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(errno(error) ?? "")) return [];
    throw error;
  }
  return entries
    .flatMap((entry) => {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesBelow(folder, rel) : [rel];
    })
    .sort();
}

const digest = (parts: readonly (readonly [string, Buffer | null])[]): string => {
  const hash = createHash("sha256");
  for (const [rel, content] of parts)
    hash
      .update(rel)
      .update("\0")
      .update(content ?? "\0absent")
      .update("\0");
  return hash.digest("hex");
};

/** What the extraction wrote: the listed files below spec/legacy, by name and content. */
export function extractedHash(project: string, unit: string, files: readonly string[]): string {
  const folder = legacyFolder(project, unit);
  return digest([...files].sort().map((rel) => [rel, read(join(folder, ...rel.split("/")))]));
}

/**
 * What the gate judges: the dossier documents the plan hash covers, and every file the extraction
 * left. Changing any of them makes an earlier answer of the gate stale.
 */
export function unitInputsHash(project: string, unit: string): string {
  const base = unitFolder(project, unit);
  const documents = MODULE_INPUTS.map((rel) => [rel, read(join(base, ...rel.split("/")))] as const);
  const folder = legacyFolder(project, unit);
  const extracted = filesBelow(folder).map(
    (rel) => [`spec/legacy/${rel}`, read(join(folder, ...rel.split("/")))] as const,
  );
  return digest([...documents, ...extracted]);
}

/** The parity record as saved: its text and hash, and whether it holds all three parts. */
export function readParity(
  project: string,
  unit: string,
): { text: string | null; sha256: string | null; problem: string | null } {
  const bytes = read(join(project, ...parityRel(unit).split("/")));
  if (bytes === null) return { text: null, sha256: null, problem: "the file does not exist" };
  return {
    text: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    problem: parityProblem(bytes.toString("utf8")),
  };
}

/** One unit as the commands and the boards show it. */
export function unitState(project: string, state: State, unit: string): UnitStatus | null {
  const record = ownEntry(state.reheat ?? {}, unit);
  if (record === undefined) return null;
  const parity = readParity(project, unit);
  return unitStatus(
    record,
    existsSync(unitFolder(project, unit)) ? unitInputsHash(project, unit) : null,
    parity.problem === null ? parity.sha256 : null,
  );
}

/**
 * The units a drive may not open until the gate passed on what they hold now, and the ones that
 * still lack the developer's signature on their parity record. Undefined outside mode reheat.
 */
export function reheatFacts(
  project: string,
  state: State,
): { ungated: ReadonlySet<string>; unsigned: ReadonlySet<string> } | undefined {
  if (state.reheat === undefined) return undefined;
  const ungated = new Set<string>();
  const unsigned = new Set<string>();
  for (const name of Object.keys(state.reheat)) {
    const status = unitState(project, state, name);
    if (status?.gate !== "pass") ungated.add(name);
    if (status?.parity !== "signed") unsigned.add(name);
  }
  return { ungated, unsigned };
}
