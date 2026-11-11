---
name: verid-reheat
description: Use in mode reheat to rewrite a read-only legacy system unit by unit, with a signed parity record.
---

# verid-reheat (Antigravity)

Mode reheat rebuilds a read-only legacy system as the modules of the plan, one legacy unit per
module. Read the legacy repo freely; never write in it (the hook refuses, and no override lifts it).

## Steps

1. Run `verid reheat inventory`; each new unit becomes a draft module in `.verid/plan.md`.
2. Run `verid reheat extract <unit>`; read `.verid/artifacts/03-modules/<unit>/spec/legacy/`, never edit it.
3. Write the unit's dossier from that material with the skill the command names, citing what the
   legacy system does. Use `ask_question` for anything unclear, or write `[NEEDS CLARIFICATION: <question>]`.
4. Run `verid reheat gate <unit>` until it exits 0 or 3 (3: passed, parity not signed). Fix the
   documents the findings name, never the gate. A failing gate cancels the unit's order.
5. After the developer orders the unit, build it by the usual cycle: failing test, code, `verid taste`, review.
6. Fill `release/parity.md` of the unit with `## Inputs`, `## Legacy results` and `## New results`,
   real cases with where each result came from. Stop: only the developer signs parity (`verid serve <unit>`).
   An edit afterwards voids the signature. Never run `serve`.
