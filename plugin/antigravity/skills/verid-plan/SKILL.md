---
name: verid-plan
description: Use when a verid design is agreed and needs delivery modules and testable acceptance criteria in .verid/plan.md (prep or recipe, with human or AI drive).
---

# verid-plan (Antigravity)

Read `.verid/spec.md`, `.verid/design.md`, and `.verid/manifest.yaml`.

## Planning Rules

1. Break delivery into small, coherent `## Module: <kebab-name>` sections in `.verid/plan.md`.
2. Every `REQ-*`, `NFR-*`, and `SEC-*` from `.verid/spec.md` must be covered by at least one AC (e.g., `- AC-1: a visitor signs up with email and password (REQ-1, SEC-1)`) or an explicit `Review Focus:` line.
3. Put `Depends: <module>, ...` before a module's first AC when it depends on earlier modules.
4. If the module changes a user-facing screen, agree an ASCII wireframe (`Screens:`, `Chosen:`, `States:`) with the developer via `ask_question` before ordering.
5. Keep `## Module: product` last, with all its ACs marked `(e2e)`.
6. **Module dossiers (prep and recipe):**
   - Run `verid module <name>` (or `node .verid/verid.mjs module <name>`), fill `.verid/artifacts/03-modules/<name>/{ba,ui,spec,tests,security}`, and include `Artifacts: .verid/artifacts/03-modules/<name>` in the module's plan section.
7. **Approval Gate:**
   - Ask the developer to review the planned module and run `verid order <module>` in their terminal (or select the task in `verid board` in big-brain drive) before starting `verid-build`.
