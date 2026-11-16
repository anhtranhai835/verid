import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { instructionBlock } from "../core/instructions.js";
import type { PolicyDecision, RuleCode } from "../core/errors.js";
import { normalizePath, writtenPath, type FileAction, type PreToolUse } from "./claude-code.js";
import { errno } from "./state-store.js";

/** Compare verid's text with normalized line endings. Unknown writers cannot prove preservation. */
export function decideInstructions(
  p: PreToolUse,
  writes: FileAction[],
  project: string,
  lifted: ReadonlySet<RuleCode>,
): PolicyDecision {
  const code = "VERID_BURNT_INSTRUCTIONS_PROTECTED";
  if (lifted.has(code)) return { kind: "allow", reason: "developer allowed instruction change" };
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const path = join(project, file);
    const real = normalizePath(path);
    const spelled = writtenPath(path);
    const hits = writes.filter((w) =>
      [w.path, writtenPath(resolve(p.cwd, w.display))].some((target) =>
        [real, spelled].some(
          (instruction) =>
            instruction === target ||
            instruction.startsWith(`${target}/`) ||
            instruction.startsWith(`${target}\\`),
        ),
      ),
    );
    if (hits.length === 0) continue;
    let before: string;
    try {
      before = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    } catch (err) {
      if (errno(err) !== "ENOENT") throw err;
      before = "";
    }
    const old = instructionBlock(before);
    // An indirect write or parent-directory operation has no trustworthy resulting content.
    const direct =
      hits.length === 1 &&
      hits[0]?.tool === p.tool_name &&
      hits[0]?.path === real &&
      ["Write", "Edit", "MultiEdit"].includes(p.tool_name);
    const after = direct ? editedContents(p, before) : null;
    const next = after === null ? null : instructionBlock(after.replaceAll("\r\n", "\n"));
    if (
      !old.ok ||
      (next !== null && !next.ok) ||
      (old.block !== null && (next === null || next.block !== old.block)) ||
      (old.block === null && next !== null && next.block !== null)
    )
      return {
        kind: "deny",
        code,
        target: file,
        reason: "verid instruction block changes or cannot be verified",
      };
  }
  return { kind: "allow", reason: "verid instruction blocks preserved" };
}

function editedContents(p: PreToolUse, before: string): string | null {
  if (p.tool_name === "Write")
    return typeof p.tool_input.content === "string" ? p.tool_input.content : null;
  const edits = p.tool_name === "MultiEdit" ? p.tool_input.edits : [p.tool_input];
  if (!Array.isArray(edits) || edits.length === 0) return null;
  let text = before;
  for (const edit of edits) {
    if (edit === null || typeof edit !== "object") return null;
    const { old_string: old, new_string: next, replace_all: all } = edit as Record<string, unknown>;
    if (
      typeof old !== "string" ||
      old === "" ||
      typeof next !== "string" ||
      (all !== undefined && typeof all !== "boolean")
    )
      return null;
    const index = text.indexOf(old);
    if (index < 0 || (!all && text.indexOf(old, index + 1) >= 0)) return null;
    text = all
      ? text.replaceAll(old, () => next)
      : text.slice(0, index) + next + text.slice(index + old.length);
  }
  return text;
}
