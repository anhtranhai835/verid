---
name: verid-onboard
description: Use when onboarding to a verid workspace, checking setup health, or reporting current module status and next step without modifying files.
---

# verid-onboard (Antigravity)

Read and report only — never modify `.verid/manifest.yaml`, source code, or git state.

## Steps

1. **Inspect Manifest & Build Files:**
   - Use `read_file` on `.verid/manifest.yaml` and existing repo build files (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, etc.).
   - Compare detected stack, `test_cmd`, `source_globs`, `test_globs`, `e2e_globs`, and `role` against `.verid/manifest.yaml`. Flag any missing globs that would cause needless TDD denials.
2. **Run Health & Status Check:**
   - Run `verid doctor` and `verid menu` (or `node .verid/verid.mjs doctor` / `node .verid/verid.mjs menu` when `.verid/verid.mjs` exists) via `run_command`.
3. **Read Project State (Compact):**
   - If `.verid/research.md` is missing, report: _"Nothing researched yet: start with `verid-ba` and place existing docs in `.verid/docs/`."_
   - Otherwise read headings/summary of `.verid/research.md`, `.verid/spec.md`, `.verid/design.md`, `.verid/plan.md`, and the last entry of `.verid/log/<open-module>.md`.
4. **Output (Max 15 lines):**
   - **Workspace table:** `Repo | Stack | Role | Branch | Status`
   - **Project summary:** 1–2 sentences, mode, drive, module phases.
   - **Next step:** Exact next action from `verid menu`.
