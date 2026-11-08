---
name: ba
description: Use when verid requirements or scope need research, clarification or a spec.
---

# verid: understand the work

Inventory `.verid/docs/` first (read-only), then the request, code and tests. For
DOCX/PDF or large inputs use verid:context-engineering's `references/document-reading.md`:
outline, search, read cited sections, and account for every source section before spec.
Separate evidence, assumptions and open choices. Talk in the main thread.

Ask only when the answer changes what gets built and nothing read answers it; otherwise
state your call and reason as a proposal the developer can correct. Until you know why they
want it, ask why, openly. Then ask one question at a time, at most 5 per round, saying why
it matters, with 2–4 options and your pick first: AskUserQuestion on Claude Code, numbered
choices on Codex. Silence is not agreement. Record each Q → A under `## Clarifications` in
`.verid/research.md`.

At project start cover: functional scope; domain/data; UX; nonfunctional needs; integrations;
edge cases/errors; security/abuse; constraints/tradeoffs; terminology; completion signals;
placeholders. Write `.verid/research.md` as in `references/research.md`, citing
`.verid/docs/` files.

Then write `.verid/spec.md` as in `references/spec.md` (this skill's folder):
REQ, NFR and SEC requirements, abuse cases, data classes, out of scope. Agree it with the
developer before verid:design. The plan's ACs cite these IDs.

Before each `verid order`, map the module: each rule → one testable EARS AC citing its IDs;
each example → a test name with that AC code, concrete inputs and outcomes; each question →
ask now or `[NEEDS CLARIFICATION: <question>]` in the module. More than 7 rules suggests a split.
Route agreed AC changes through verid:plan; the developer orders modules.

During build, settle ambiguous ACs here first; in signed auto drive, put a question for the
developer in `.verid/blocked.md` and stop.

Keep scope minimal and agree observable success before implementation.
