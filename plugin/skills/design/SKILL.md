---
name: design
description: Steps 1 and 2 of a verid project in prep or recipe mode. Find out with the developer what the project is for and write `.verid/research.md`, then agree how it is built and write `.verid/design.md`, which unlocks the plan; in an auto drive, ask the developer to sign both with `verid order`. Use before writing `.verid/plan.md`.
---

# verid: research and design

Use andrej-karpathy-skills:karpathy-guidelines (Think Before Coding) when proposing.

Hold the conversation itself with superpowers:brainstorming. This skill adds the files verid
expects and the gates that guard them. Keep the conversation with the developer in the main
thread: subagents cannot ask them questions. Read `roles` in `.verid/manifest.yaml` with Read,
never Bash. Dispatch the mapped researcher first, then the mapped architect; use the mapped
agent types even when they come from another plugin.

For each mapped role, dispatch a proposal-only pass with the request, specification, existing
code and the decisions so far. Present its draft before any write. Relay its open questions to
the developer one at a time, each with 2–3 options, trade-offs and a recommendation. Do not
silently settle scope or component boundaries. Once the developer agrees, dispatch that same
role again with the answers and approval to write its document. You write nothing yourself for
a mapped role. When a role is unmapped, do its step in the main conversation with the same
proposal and question workflow. Never run two document writers at once.

## 1. Research → `.verid/research.md`

Find out what the project is for, who uses it, how it should work, and where any specification or
documents are. Ask one question at a time, with 2–3 options, their trade-offs and your
recommendation. Do not guess. In recipe mode, read the specification the developer points to.

Have the mapped researcher write what you learn into `.verid/research.md`; write it yourself
only when no researcher is mapped. It reads existing code first and covers the problem, users,
constraints, options with trade-offs and open questions. Until it exists, verid keeps `.verid/plan.md`
locked (`VERID_BURNT_PLAN_NO_RESEARCH`).

## 2. Design → `.verid/design.md`

Once research is agreed and written, dispatch the mapped architect to propose how the project
is built. Agree it with the developer, then have the architect write it down (or write it
yourself when no architect is mapped):

- **Architecture:** the parts and the boundaries between them.
- **Data:** what is stored or passed around, and its shape.
- **Interfaces:** APIs, commands or screens, and how errors reach the user.
- **Decisions:** each choice, with the options you set aside and why.
- **Dependencies:** directed edges between components, with no cycles (a DAG).
- **Out of scope:** what this project will not do.

Keep it short: the plan and the tests carry the detail. The decisions are the developer's.

Until `.verid/design.md` exists, verid denies writing `.verid/plan.md`
(`VERID_BURNT_PLAN_NO_DESIGN`), and `verid order` refuses (`VERID_BURNT_DESIGN_MISSING`).

## The design is signed

Each `verid order` signs `.verid/design.md` together with the module. If the design changes after
the order, verid locks production code until the developer runs `verid order <module>` again. A
module already served is not affected. An editor that only re-saves the file (a BOM, CRLF line
endings) changes it too. So settle the design before the first order; changing it later is allowed,
and costs a new order.

## Auto drive

When the first line of `verid menu` says `drive auto` (the session-start message says it too), the
developer signs once and the agents run the rest. Do not read the manifest with Bash to find out:
verid blocks it.

Once `.verid/research.md` and `.verid/design.md` are written and the developer agrees with both, ask
them to read the two files and run `verid order` (no module name) from their own terminal. That one
command signs both; `verid order <module>` is refused (`VERID_BURNT_AUTO_ORDER_MODULE`), and you never
run `verid order` yourself. Then stop and wait: until it is signed, production code stays locked and
verid does not hold you. When the developer says it is done, the first line of `verid menu` says
`signed`, and its next step is the plan.

From then on do not ask the developer anything more: write the plan with the `verid:plan` skill and
the rest follows. Do not edit the research or the design after the signature, or the drive is stuck
until the developer signs again. If the design turns out to be wrong, write why and the options into
`.verid/blocked.md` and stop; the developer decides and signs again.

## Next

Split the work into modules with the `verid:plan` skill. `verid menu` always says what comes next.
