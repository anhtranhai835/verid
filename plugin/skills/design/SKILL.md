---
name: design
description: Use when a verid project needs an agreed design before planning modules.
---

# verid: design

Start with verid:ba in the main conversation; let the developer describe the idea first.
Read agreed research/spec and their source map; open cited `.verid/docs/` sections as
needed, checking source versions. When the request
leaves nothing open, open with a short design to approve; otherwise lay out 2–3 approaches
with tradeoffs and your pick, and let the developer choose.

Read `.verid/rules/architecture.md`. Have the mapped architect follow
`references/design.md` in this skill's folder: architecture decisions first, one at a
time; existing code across manifest repos as file:line with reuse/extend/supersede/
duplicate; then boundaries, the module map with dependencies, data, interfaces and
tradeoffs. Agree each section with the developer.

Use a fresh reviewer as a builder check with only the proposal, specification
and code paths. Ask what cannot be built or tested as written. Resolve findings through
verid:ba. Then have the architect write `.verid/design.md` (main on Codex or if unmapped).
Document writers run one at a time.

In no-brain drive, do not wait for the developer: pick the recommended option for each open
question, record why in the design, and write `.verid/summary.md` as `references/summary.md`
says. verid signs research/spec/design itself at the next hook, and signs again when one
changes. Continue with verid:plan at once.
