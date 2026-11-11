---
name: reheat
description: Use in mode reheat to rewrite a read-only legacy system unit by unit, with a signed parity record.
---

# verid: reheat (legacy rewrite)

Mode reheat rebuilds a legacy system as the modules of this plan: one legacy unit (a screen,
a job, a report) is one module. The legacy repo is read-only and defines correct behaviour.
Read it freely; never write in it. The hook refuses every write there, `git commit` included,
and no `/verid tip` lifts that. Do not look for a way around it.

A developer-installed adapter plugin reads the legacy format. You drive it with three commands:

1. `verid reheat inventory`: lists the units and adds a draft module for each new one to
   `.verid/plan.md`, with a dossier of placeholders.
2. `verid reheat extract <unit>`: the adapter writes the unit's legacy material to
   `.verid/artifacts/03-modules/<unit>/spec/legacy/`. Read it, never edit it.
3. Write the unit's dossier from `spec/legacy/` with the skill the command names: the spec and
   requirements, the test plan, the other documents. Cite what the legacy system does. Where it
   is unclear, write `[NEEDS CLARIFICATION: <question>]` and ask the developer.

Then `verid reheat gate <unit>`, until it exits 0 or 3 (3: passed, parity not signed yet). A
failing gate lists findings: fix the documents, not the gate. A change to the dossier or to
`spec/legacy/` makes an earlier pass stale, and a failing gate cancels the unit's order.

Order, build and review follow the usual cycle (verid:build): the developer orders the unit
(`verid order <unit>`; the no-brain drive opens it itself once the gate passed), then failing
test, code, `verid taste`, independent review.

Parity comes last. Fill `.verid/artifacts/03-modules/<unit>/release/parity.md`:

- `## Inputs`: each case's input, one row per case.
- `## Legacy results`: what the legacy system did, and where you saw it (a file or a run).
- `## New results`: what the new code does for the same input, and the test that shows it.

Cases are real ones, not intentions. Then stop: only the developer signs parity, with
`verid serve <unit>` in a terminal or on the no-brain board. Editing `parity.md` afterwards
voids the signature, so finish it before you hand over.

Never mark a unit done yourself, and never run `serve`.
