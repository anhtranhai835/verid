import type { PlanModule } from "./plan.js";
import { citedIds, liveRequirements } from "./spec.js";

export interface ContextInput {
  module: PlanModule;
  /** Plan file path and the sha256 of the module's section (with its dossier). */
  plan: { path: string; sha: string | null };
  /** null when the spec file is missing. */
  spec: { path: string; text: string; sha: string | null } | null;
  /** null when the design file is missing. */
  design: { path: string; sha: string | null } | null;
  needs: { name: string; phase: string }[];
  files: { path: string; state: "ok" | "missing" | "empty" | "unresolved" }[];
  dossier: string;
  run: string;
  log: { path: string; last: string | null };
  /** Print this AC only. */
  ac?: string;
}

const LIMIT = 4000;
const LINE = 240;
const AC_LINE = /^[ \t]*[-*][ \t]+(AC-\d+)\b/;
const short = (sha: string | null) => (sha ? sha.slice(0, 8) : "none");

/**
 * A short entry point for a task: the module's ACs, the spec lines they cite quoted as written,
 * what it waits for, the state of its dossier and where the full documents are. Pure; names what
 * it could not find and what it cut, and never exceeds 4000 characters.
 */
export function contextPacket(input: ContextInput): string {
  const { module, plan, spec, design } = input;
  const title = /^Title:[ \t]*(.+?)[ \t]*$/m.exec(module.text)?.[1];
  const acLines = module.text
    .split(/\r?\n/)
    .filter((line) => AC_LINE.test(line))
    .filter((line) => input.ac === undefined || AC_LINE.exec(line)?.[1] === input.ac)
    .map((line) => line.replace(/^[ \t]*[-*][ \t]+/, ""));
  let cut = false;
  const fit = (line: string) => {
    if (line.length <= LINE) return line;
    cut = true;
    return `${line.slice(0, LINE - 1)}…`;
  };

  const acs = acLines.map(fit);
  const live = new Map(liveRequirements(spec?.text ?? ""));
  const reqs = citedIds(acLines.join("\n")).map((id) => {
    const line = live.get(id);
    if (!spec) return `${id} missing: spec not found`;
    return line === undefined
      ? `${id} missing in ${spec.path}`
      : fit(`${id}  ${line.replace(/^[-*][ \t]+[A-Z]+-\d+:[ \t]*/, "")}`);
  });
  const needs = input.needs.length
    ? [fit(`needs  ${input.needs.map((n) => `${n.name}: ${n.phase}`).join(", ")}`)]
    : [];
  const head = [
    `# ${module.name}${title ? ` · ${title}` : ""}`,
    `plan   ${plan.path}#module-${module.name}  sha ${short(plan.sha)}`,
  ];
  const specLine = spec
    ? `spec   ${spec.path}  sha ${short(spec.sha)}`
    : `spec   missing: .verid/spec.md`;
  const tail = [
    `files  ${input.files.map((f) => `${f.path} ${f.state}`).join(" · ")}`,
    `       ${input.dossier}`,
    design
      ? `design ${design.path}  sha ${short(design.sha)}  (open the section named for this module or an interface it uses)`
      : `design missing: .verid/design.md`,
    `run    ${input.run}`,
    input.log.last === null
      ? `log    ${input.log.path} · no entries`
      : fit(`log    ${input.log.path} · last: ${input.log.last}`),
  ];
  const missingAc = input.ac !== undefined && acs.length === 0;
  const build = () =>
    [
      ...head,
      ...(missingAc ? [`${input.ac} not in module ${module.name}`] : acs),
      ...needs,
      specLine,
      ...reqs,
      ...tail,
      ...(cut ? [`cut: see ${plan.path}`] : []),
    ].join("\n") + "\n";
  while (build().length > LIMIT && (reqs.length > 0 || acs.length > 1)) {
    (reqs.length > 0 ? reqs : acs).pop();
    cut = true;
  }
  return build();
}
