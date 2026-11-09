---
name: verid-review
description: Use when all ACs of an ordered verid module pass and need an independent subagent review before verid serve.
---

# verid-review (Antigravity)

Independent reviews run in a fresh read-only subagent (`verid-reviewer` / `verid-security`) so the reviewer judges the diff and ACs without writer bias or main-thread context bloat.

## Steps

1. **Generate the Review Packet:**
   - Confirm `verid peek` shows `PLATED` and all module ACs covered.
   - Run `verid menu --commits --file` (or `node .verid/verid.mjs menu --commits --file`) via `run_command`. This writes `.verid/review/work.md` without dumping the full diff into your main context.
2. **Optional Dependency Audit (when dependencies/lockfiles/CI scripts changed):**
   - Run the stack's audit command and save redacted output to `security-audit.json`.
3. **Dispatch Independent Reviewer Subagent:**
   - Call `invoke_subagent` with:
     - `TypeName`: `"verid-reviewer"`
     - `Role`: `"Independent Verid Reviewer"`
     - `Prompt`: Supply only the module name, AC codes, `.verid/review/work.md`, `.verid/plan.md`, `.verid/design.md`, and relevant design row names (never paste raw diffs into the prompt).
   - verid's hook snapshots the review inputs when it allows the `invoke_subagent` call, and records the subagent's final report (ending `Verdict: pass|fail`) when that same call returns. A report from any other conversation never counts.
4. **Dedicated Security Subagent (if `roles.security` is mapped in `.verid/manifest.yaml`):**
   - After `verid-reviewer` passes, call `invoke_subagent` with `TypeName: "verid-security"` and the same packet path + `security-audit.json` status.
5. **Close or Fix:**
   - If `Verdict: fail`, fix findings through `verid-build` (test-first), regenerate `.verid/review/work.md`, and re-run a fresh `verid-reviewer`.
   - When `Verdict: pass`, ask the developer to run `verid serve <module>` in their terminal (or click **Approve & Serve** in `verid board`).
