import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Manifest } from "../core/manifest.js";
import { MODULE_INPUTS, parsePlan } from "../core/plan.js";
import type { PluginAdapter } from "../core/plugin.js";
import { PARITY_SECTIONS, UNIT_ID, type AdapterContext } from "../core/reheat.js";
import type { ReheatUnit, State } from "../core/state.js";
import { ownEntry } from "../core/station.js";
import { runAdapter } from "./adapter-run.js";
import { appendAudit } from "./audit-log.js";
import { contentRoot } from "./codex-settings.js";
import { bilingual } from "./i18n.js";
import { loadManifest, manifestFile } from "./manifest.js";
import { planFile } from "./plan-file.js";
import { checkedPlugin, pluginEnvironment, readPlugins } from "./plugin-store.js";
import {
  extractedHash,
  filesBelow,
  legacyFolder,
  parityRel,
  readParity,
  unitBase,
  unitFolder,
  unitInputsHash,
} from "./reheat-evidence.js";
import { ask, type Io } from "./terminal.js";
import { readState, statePaths, VeridError, withLock, writeState } from "./state-store.js";
import { checkSetupPath } from "./workspace.js";

/** Everything a reheat command needs to run the adapter: the manifest, the legacy folder, the plugin. */
export interface ReheatContext {
  manifest: Manifest;
  legacyRoot: string;
  plugin: { name: string; folder: string; adapter: PluginAdapter; env: NodeJS.ProcessEnv };
}

/**
 * The manifest of a reheat project, its read-only legacy repo and the one enabled plugin that
 * declares an adapter. The plugin must still be the package the developer approved.
 */
export async function reheatContext(project: string): Promise<ReheatContext> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  if (manifest.mode !== "reheat")
    throw new VeridError("VERID_BURNT_MODE_MISMATCH", { command: "reheat", mode: manifest.mode });
  const legacy = manifest.repos.find((repo) => repo.role === "legacy");
  if (!legacy)
    throw new VeridError("VERID_BURNT_MANIFEST_INVALID", {
      path: manifestFile(project),
      detail: "mode reheat needs a repo with role: legacy and read_only: true",
    });
  const found = readPlugins(project)
    .plugins.filter((entry) => entry.enabled)
    .flatMap((entry) => {
      const { folder, manifest: plugin } = checkedPlugin(project, entry);
      return plugin.adapter ? [{ entry, folder, adapter: plugin.adapter }] : [];
    });
  const [only, ...others] = found;
  if (!only)
    throw new VeridError("VERID_BURNT_ADAPTER", {
      step: "setup",
      detail: "no enabled plugin declares an adapter: add one with verid plugin add",
    });
  if (others.length > 0)
    throw new VeridError("VERID_BURNT_ADAPTER", {
      step: "setup",
      detail: `${found.map((item) => item.entry.name).join(", ")} all declare an adapter: disable all but one`,
    });
  return {
    manifest,
    legacyRoot: resolve(project, ...legacy.path.split(/[/\\]/)),
    plugin: {
      name: only.entry.name,
      folder: only.folder,
      adapter: only.adapter,
      env: pluginEnvironment(project, only.entry.name, only.folder, only.entry.config),
    },
  };
}

const unitContext = (project: string, root: string, unit: string): AdapterContext => ({
  legacyRoot: root,
  unit,
  unitDir: unitFolder(project, unit),
  specPath: join(unitFolder(project, unit), "spec", "spec.md"),
});

/** The unit a command names, from state; a name that is not one of the inventory's is unknown. */
function knownUnit(state: State, unit: string): ReheatUnit {
  const record = UNIT_ID.test(unit) ? ownEntry(state.reheat ?? {}, unit) : undefined;
  if (record === undefined)
    throw new VeridError("VERID_BURNT_MODULE_UNKNOWN", {
      module: unit,
      modules: Object.keys(state.reheat ?? {}).join(", ") || "none: run verid reheat inventory",
    });
  return record;
}

const oneLine = (text: string, max = 120): string =>
  text
    .replace(/[\s\x00-\x1f]+/g, " ")
    .trim()
    .slice(0, max)
    .replaceAll("[", "(")
    .replaceAll("]", ")");

/** The text a placeholder document holds until the unit is extracted and written up. */
const stub = (unit: string, title: string) =>
  `# ${unit}\n\nLegacy unit "${oneLine(title)}": pending. Run \`verid reheat extract ${unit}\`, then write this document from spec/legacy/.\n`;

/**
 * The parity record a unit starts from: the project's own template, else verid's. A project cooked
 * before this mode has neither folder yet, so a minimal record with the same three parts stands in.
 */
function parityTemplate(project: string): string {
  const rel = "module-reheat/release/parity.md";
  for (const file of [
    join(project, ".verid", "templates", ...rel.split("/")),
    join(contentRoot(), "templates", ...rel.split("/")),
  ])
    if (existsSync(file)) return readFileSync(file, "utf8");
  const parts = PARITY_SECTIONS.map(
    (name) => `## ${name}\n\n[NEEDS CLARIFICATION: fill in ${name.toLowerCase()}]\n`,
  );
  return `# {{module}}: parity record\n\n${parts.join("\n")}`;
}

/**
 * `verid reheat inventory`: ask the adapter for the legacy units, record them, and give each one a
 * module of its own in `.verid/plan.md` with a dossier of placeholders. A unit the plan already
 * has is left as written; nothing is rewritten, so the command can run again.
 */
export async function inventoryUnits(project: string): Promise<{ units: number; added: string[] }> {
  const { legacyRoot, plugin } = await reheatContext(project);
  const found = await runAdapter(
    plugin.adapter.commands.inventory,
    plugin.folder,
    "inventory",
    unitContext(project, legacyRoot, ""),
    plugin.env,
  );
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const file = planFile(project);
    checkSetupPath(project, ".verid/plan.md");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const parsed = parsePlan(before);
    if (!parsed.ok)
      throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: file, detail: parsed.detail });
    if (before.trim() !== "" && !/^##[ \t]+Module:/m.test(before))
      throw new VeridError("VERID_BURNT_PLAN_INVALID", {
        path: file,
        detail: "it has no `## Module:` heading, so units cannot be added to it",
      });
    const named = new Set(before.trim() === "" ? [] : parsed.modules.map((module) => module.name));
    const added = found.units.filter((unit) => !named.has(unit.id));
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    const sections = added.map((unit) =>
      [
        `## Module: ${unit.id}`,
        `Artifacts: ${unitBase(unit.id)}`,
        `Legacy unit: ${oneLine(unit.title)}${unit.family ? ` (family ${oneLine(unit.family, 60)})` : ""}${unit.parent ? ` (part of ${unit.parent})` : ""}`,
        "",
      ].join(eol),
    );
    const head =
      before.trim() === "" ? `# Plan${eol}${eol}` : before.endsWith("\n") ? before : before + eol;
    const after =
      sections.length === 0
        ? before
        : head + (head.endsWith(`${eol}${eol}`) ? "" : eol) + sections.join(eol);
    // Everything is checked and built before the first write, and the audit entry comes first.
    const writes: { rel: string; content: string }[] = [];
    const template = parityTemplate(project);
    for (const unit of found.units) {
      const base = unitBase(unit.id);
      for (const input of MODULE_INPUTS)
        writes.push({ rel: `${base}/${input}`, content: stub(unit.id, unit.title) });
      writes.push({
        rel: parityRel(unit.id),
        content: template.replaceAll("{{module}}", unit.id),
      });
    }
    for (const { rel } of writes) checkSetupPath(project, rel);
    appendAudit(paths.audit, {
      event: "reheat_inventory",
      units: found.units.length,
      added: added.map((unit) => unit.id),
    });
    for (const { rel, content } of writes) {
      const target = join(project, ...rel.split("/"));
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: "wx" });
    }
    if (after !== before) writeFileSync(file, after);
    const reheat: Record<string, ReheatUnit> = { ...state.reheat };
    for (const unit of found.units) {
      const known = ownEntry(reheat, unit.id);
      reheat[unit.id] = {
        title: unit.title,
        ...(unit.parent !== undefined && { parent: unit.parent }),
        ...(unit.family !== undefined && { family: unit.family }),
        ...(known?.extracted && { extracted: known.extracted }),
        ...(known?.gate && { gate: known.gate }),
        ...(known?.parity && { parity: known.parity }),
      };
    }
    writeState(paths, { ...state, reheat });
    return { units: found.units.length, added: added.map((unit) => unit.id) };
  });
}

/**
 * `verid reheat extract <unit>`: the adapter writes the unit's legacy material below its
 * `spec/legacy/` folder and names the files; verid checks that each is there, then records them.
 */
export async function extractUnit(
  project: string,
  unit: string,
): Promise<{ files: string[]; skill: string | undefined }> {
  const { legacyRoot, plugin } = await reheatContext(project);
  knownUnit(readState(statePaths(project)), unit);
  const folder = legacyFolder(project, unit);
  const rel = `${unitBase(unit)}/spec/legacy`;
  checkSetupPath(project, rel);
  mkdirSync(folder, { recursive: true });
  const found = await runAdapter(
    plugin.adapter.commands.extract,
    plugin.folder,
    "extract",
    unitContext(project, legacyRoot, unit),
    plugin.env,
  );
  const files = [...new Set(found.files)].sort();
  const wrote = (name: string) => {
    try {
      checkSetupPath(project, `${rel}/${name}`);
      return lstatSync(join(folder, ...name.split("/"))).isFile();
    } catch {
      return false;
    }
  };
  const missing = files.find((name) => !wrote(name));
  if (files.length === 0 || missing !== undefined)
    throw new VeridError("VERID_BURNT_ADAPTER", {
      step: "extract",
      detail:
        missing === undefined
          ? "it named no files"
          : `${missing} is not a file below spec/legacy of ${unit}`,
    });
  const sha256 = extractedHash(project, unit, files);
  const paths = statePaths(project);
  withLock(paths, () => {
    const state = readState(paths);
    const record = knownUnit(state, unit);
    appendAudit(paths.audit, { event: "reheat_extract", module: unit, files: files.length });
    writeState(paths, {
      ...state,
      reheat: {
        ...state.reheat,
        [unit]: { ...record, extracted: { at: new Date().toISOString(), files, sha256 } },
      },
    });
  });
  return { files, skill: plugin.adapter.skill && `${plugin.name}-${plugin.adapter.skill}` };
}

export interface GateResult {
  pass: boolean;
  signed: boolean;
  lines: string[];
}

/** Why the gate cannot judge the unit as it stands, or null when its extraction is intact. */
function extractionProblem(project: string, record: ReheatUnit, unit: string): string | null {
  if (record.extracted === undefined)
    return `it has no extraction: run verid reheat extract ${unit}`;
  const left = filesBelow(legacyFolder(project, unit));
  const same =
    left.length === record.extracted.files.length &&
    left.every((name, i) => name === record.extracted?.files[i]) &&
    extractedHash(project, unit, left) === record.extracted.sha256;
  return same
    ? null
    : `spec/legacy differs from the extraction: run verid reheat extract ${unit} again`;
}

/**
 * `verid reheat gate <unit>`: the adapter judges the unit's spec against the legacy system. The
 * answer is recorded with the hash of what it judged, so it counts only while those files stand.
 * A failing answer cancels the unit's order, as a change to its documents would.
 */
export async function gateUnit(project: string, unit: string): Promise<GateResult> {
  const { legacyRoot, plugin } = await reheatContext(project);
  const problem = extractionProblem(project, knownUnit(readState(statePaths(project)), unit), unit);
  if (problem !== null)
    throw new VeridError("VERID_BURNT_REHEAT_GATE", { module: unit, detail: problem });
  const judged = unitInputsHash(project, unit);
  const found = await runAdapter(
    plugin.adapter.commands.gate,
    plugin.folder,
    "gate",
    unitContext(project, legacyRoot, unit),
    plugin.env,
  );
  const paths = statePaths(project);
  const signed = withLock(paths, () => {
    const state = readState(paths);
    const record = knownUnit(state, unit);
    appendAudit(paths.audit, {
      event: "reheat_gate",
      module: unit,
      pass: found.pass,
      findings: found.findings.length,
    });
    const next: State = {
      ...state,
      reheat: {
        ...state.reheat,
        [unit]: {
          ...record,
          gate: {
            at: new Date().toISOString(),
            pass: found.pass,
            inputs_sha256: judged,
            findings: found.findings.length,
          },
        },
      },
    };
    writeState(paths, found.pass ? next : cancelOrder(next, unit));
    const parity = readParity(project, unit);
    return parity.problem === null && record.parity?.sha256 === parity.sha256;
  });
  const lines = found.findings
    .slice(0, 10)
    .map((item) => `  ${item.severity} ${oneLine(item.rule, 60)}: ${oneLine(item.message, 200)}`);
  if (found.findings.length > 10) lines.push(`  … ${found.findings.length - 10} more`);
  return { pass: found.pass, signed, lines };
}

/** A unit whose gate failed is no longer ordered: its approval, review and open task go. */
function cancelOrder(state: State, unit: string): State {
  const approval = ownEntry(state.modules, unit);
  if (approval === undefined || approval.served_at !== null) return state;
  return {
    ...state,
    modules: Object.fromEntries(Object.entries(state.modules).filter(([name]) => name !== unit)),
    kanban: {
      ...state.kanban,
      active: state.kanban.active?.module === unit ? null : state.kanban.active,
    },
    review: state.review?.module === unit ? null : state.review,
    security: state.security?.module === unit ? null : state.security,
    review_epoch: state.review_epoch + 1,
    security_epoch: state.security_epoch + 1,
    auto: state.auto.work?.module === unit ? { ...state.auto, work: null } : state.auto,
  };
}

/**
 * Why a unit may not be ordered or served: the gate has not passed on what it holds now. Null for
 * a module that is not a legacy unit.
 */
export function gateProblem(project: string, state: State, unit: string): string | null {
  const record = ownEntry(state.reheat ?? {}, unit);
  if (record === undefined) return null;
  const extraction = extractionProblem(project, record, unit);
  if (extraction !== null) return extraction;
  if (record.gate === undefined) return `the gate has not run: run verid reheat gate ${unit}`;
  if (record.gate.inputs_sha256 !== unitInputsHash(project, unit))
    return `its spec or extraction changed since the gate ran: run verid reheat gate ${unit}`;
  return record.gate.pass
    ? null
    : `the gate failed: run verid reheat gate ${unit} for its findings`;
}

/** The state with the developer's signature on this parity record. */
const withParity = (state: State, unit: string, record: ReheatUnit, sha256: string): State => ({
  ...state,
  reheat: {
    ...state.reheat,
    [unit]: { ...record, parity: { at: new Date().toISOString(), sha256 } },
  },
});

/** `verid serve` of a unit asks the developer in a terminal; what was confirmed binds to its hash. */
export async function confirmParity(project: string, unit: string, io: Io): Promise<string | null> {
  const record = ownEntry(readState(statePaths(project)).reheat ?? {}, unit);
  const parity = readParity(project, unit);
  if (record === undefined || parity.problem !== null || parity.sha256 === null) return null;
  if (record.parity?.sha256 === parity.sha256) return parity.sha256;
  const answer = await ask(
    io,
    bilingual("reheat.sign_ask", {
      module: unit,
      file: parityRel(unit),
      sha: parity.sha256.slice(0, 8),
    }),
  );
  return answer !== null && ["y", "yes"].includes(answer.toLowerCase()) ? parity.sha256 : null;
}

/**
 * What closing a unit needs on top of the usual evidence: a passing gate on its current files and
 * a parity record, with all three parts, that the developer signed: now with `sign`, in a terminal
 * (`confirmed` is the hash they said yes to), or earlier. Throws before anything is written, and
 * returns the state's units with the signature recorded.
 */
export function serveParity(
  project: string,
  state: State,
  unit: string,
  sign: { flag: boolean; confirmed: string | null },
): { reheat: State["reheat"]; signedNow: boolean } {
  const record = ownEntry(state.reheat ?? {}, unit);
  if (record === undefined) return { reheat: state.reheat, signedNow: false };
  const gate = gateProblem(project, state, unit);
  if (gate !== null)
    throw new VeridError("VERID_BURNT_REHEAT_GATE", { module: unit, detail: gate });
  const parity = readParity(project, unit);
  if (parity.problem !== null || parity.sha256 === null)
    throw new VeridError("VERID_BURNT_PARITY", {
      module: unit,
      file: parityRel(unit),
      detail: parity.problem ?? "the file does not exist",
    });
  if (record.parity?.sha256 === parity.sha256) return { reheat: state.reheat, signedNow: false };
  if (!sign.flag && sign.confirmed !== parity.sha256)
    throw new VeridError("VERID_BURNT_PARITY", {
      module: unit,
      file: parityRel(unit),
      detail: "the developer has not signed this version of it",
    });
  return { reheat: withParity(state, unit, record, parity.sha256).reheat, signedNow: true };
}

/** Signs the parity record as it is now: the developer's act, which no agent shell may perform. */
export function signParity(project: string, unit: string): string {
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const record = knownUnit(state, unit);
    const parity = readParity(project, unit);
    if (parity.problem !== null || parity.sha256 === null)
      throw new VeridError("VERID_BURNT_PARITY", {
        module: unit,
        file: parityRel(unit),
        detail: parity.problem ?? "the file does not exist",
      });
    appendAudit(paths.audit, { event: "parity_signed", module: unit, sha256: parity.sha256 });
    writeState(paths, withParity(state, unit, record, parity.sha256));
    return parity.sha256;
  });
}
