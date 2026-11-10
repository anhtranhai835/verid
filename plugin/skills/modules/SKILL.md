---
name: modules
description: Use in prep or recipe mode to prepare module dossiers from repo templates and carry their contracts through verid order, TDD, review and release.
---

Read `.verid/workflow.md` and the manifest. Follow the phase sequence there.
Use `verid module <kebab-name>` to create a dossier, then read the project's
`.verid/templates/module/` and fill BA, UI, spec/design, tests and security inputs.
Use source citations, concrete contracts, failure cases and traceable IDs. Resolve
clarifications with the developer; mark inapplicable sections with reasons.

Publish agreed requirements in `.verid/spec.md`, architecture in `.verid/design.md`
and executable ACs in `.verid/plan.md`. Each plan section includes
`Artifacts: .verid/artifacts/03-modules/<name>`; use `.verid/templates/plan-section.md`.
Keep requirement/AC numbers unique across modules. Per-module input changes invalidate
that module's order. Review and release records hold actual evidence after the work.

Follow the usual mapped writers, order, taste, independent read-only review and serve
gates. On Codex main writes tests and code; only its configured reviewer is spawned.
The main thread records reviewer reports. Never invent approvals or test evidence.

For prep/recipe, the developer arranges the priority queue in `verid board`. Complete module dossiers before order. Human drive binds one fresh session per selected task and stops after serve. AI drive follows that queue in one session after `verid order`; reprioritizing never interrupts current work. Remix keeps its baseline flow.
