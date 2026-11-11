---
name: verid-build
description: Use when an approved verid module is ready for TDD implementation (RAW -> COOKING -> PLATED) and verification with verid taste.
---

# verid-build (Antigravity Single-Writer TDD)

On Antigravity, execute the TDD loop directly in the **main conversation** (Single-Writer mode) to avoid spawning 20 subagent contexts per module. The `PreToolUse` and `Stop` hooks strictly enforce every transition.

## Token-Saving Loop per Uncovered AC

1. **Check Status Lightly:**
   - Run `verid peek` (or `node .verid/verid.mjs peek`) and read `.verid/log/<module>.md` if present. Read only the target module's section in `.verid/plan.md` and referenced interfaces in `.verid/design.md`.
   - If the AC touches a specialized domain (UI, React, DB, DevOps, Mobile, Web-Testing, Edge-Cases), check `verid-router` and open only the matching reference section.
2. **`RAW` (RED — Write One Failing Test):**
   - Production code is locked by the hook.
   - Write one focused test whose name includes the AC code (`AC-1 ...` or `AC_1_...`). For `(e2e)` ACs, use Playwright or a path matching `e2e_globs`.
   - Run `verid taste` via `run_command`.
   - If the test cannot load due to a missing symbol (`RAW · stub`), write only the minimal stub declaration and run `verid taste` again until it fails on the assertion (`COOKING`).
3. **`COOKING` (GREEN — Minimal Production Code):**
   - Tests are frozen by the hook.
   - Write the minimum production code to pass the test, then run `verid taste` until `PLATED`.
4. **`PLATED` (REFACTOR & LOG):**
   - Refactor only while `PLATED` without adding new behaviour; run `verid taste` after any edit.
   - Append a concise entry (`Done`, `Decided`, `Deviation`, `Tried`, `Commits`, `Next`) to `.verid/log/<module>.md`.
   - Commit small, verified increments using Conventional Commits.
5. When all module ACs pass in `verid peek`, proceed to `verid-review`. After a failed review, read `<SKILLS_ROOT>/build/references/review-findings.md` before changing code.
