import { parsePlan } from "../core/plan.js";
import type { State } from "../core/state.js";
import { VeridError } from "./state-store.js";

/** Add dossier references to pending sections, preserving served sections byte for byte. */
export function upgradeModulePlan(raw: string, state: State, iterations = false) {
  const parsed = parsePlan(raw, iterations);
  if (!parsed.ok)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", {
      path: ".verid/plan.md",
      detail: parsed.detail,
    });
  let text = raw;
  const pending: string[] = [];
  const preserved = new Set(
    parsed.modules
      .filter((module) => {
        const approval = state.modules[module.name];
        return (
          approval?.served_at != null &&
          (/^Artifacts:/m.test(module.text) ||
            approval.sha256 === createHash("sha256").update(module.text).digest("hex"))
        );
      })
      .map((module) => module.name),
  );
  for (const module of parsed.modules) {
    if (preserved.has(module.name)) continue;
    pending.push(module.name);
    if (/^Artifacts:/m.test(module.text)) continue;
    const eol = module.text.includes("\r\n") ? "\r\n" : "\n";
    const lines = module.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let at =
      /^\uFEFF?##[ \t]+Module:/.test(module.text) || module.text.startsWith("\uFEFF") ? 1 : 0;
    while (
      at < lines.length &&
      (/^\s*$/.test(lines[at]!) || /^(?:Title|Depends|Iteration):/.test(lines[at]!))
    )
      at++;
    const before = lines.slice(0, at).join("");
    const section =
      before +
      (before && !before.endsWith("\n") ? eol : "") +
      `Artifacts: .verid/artifacts/03-modules/${module.name}${eol}` +
      lines.slice(at).join("");
    text = text.replace(module.text, () => section);
  }
  const after = parsePlan(text, iterations);
  if (
    !after.ok ||
    parsed.modules.some(
      (module, index) =>
        after.modules[index]?.name !== module.name ||
        (preserved.has(module.name) &&
          after.modules.find((item) => item.name === module.name)?.text !== module.text),
    )
  )
    throw new VeridError("VERID_BURNT_PLAN_INVALID", {
      path: ".verid/plan.md",
      detail: "upgrade would change a served module; no files written",
    });
  return { text, pending };
}
import { createHash } from "node:crypto";
