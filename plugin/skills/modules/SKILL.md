---
name: modules
description: Use in prep or recipe mode to prepare module dossiers from repo templates and carry their contracts through verid order, TDD, review and release.
---

Read `.verid/workflow.md` and the manifest. Follow the phase sequence there.
Use `verid module <kebab-name>` to create a dossier, then read the project's
`.verid/templates/module/` and fill BA, UI, spec/design, tests and security inputs.
Use source citations, concrete contracts, failure cases and traceable IDs. Resolve
clarifications with the developer. A document that does not apply is one line,
`Not applicable: <reason>`; that line counts as done.

`verid module <name>` prefills requirements and the AC table when the plan has the module.
Write detail once, in the dossier. `.verid/spec.md` keeps each ID with one line, `.verid/design.md`
only the interfaces between modules, and executable ACs go in `.verid/plan.md`. Each plan section includes
`Artifacts: .verid/artifacts/03-modules/<name>`; use `.verid/templates/plan-section.md`.
Keep requirement/AC numbers unique across modules. Per-module input changes invalidate
that module's order. Review and release records hold actual evidence after the work.

Follow the usual mapped writers, order, taste, independent read-only review and serve
gates. On Codex main writes tests and code; only its configured reviewer is spawned.
The main thread records reviewer reports. Never invent approvals or test evidence.
