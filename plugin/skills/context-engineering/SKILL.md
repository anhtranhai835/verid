---
name: context-engineering
description: Use for selective document reading, focused agent handoffs, context loss or token waste in verid workflows.
---

# verid:context-engineering

Load project instructions once per context; reread after changes or lost context.
Search headings, symbols and paths before opening large files. Read matching sections
and expand through definitions, exceptions, callers and dependencies as needed.
Keep source citations and missing evidence; summaries guide navigation only.

Read only the matching guide, relative to this skill:

- DOCX, PDF or large requirement documents: `references/document-reading.md`.
- BA-to-build handoffs, repeated reads or long sessions: `references/flow-context.md`.
- Context failures: `references/context-degradation.md`.
- Memory design: `references/memory-systems.md`; compression: `references/context-compression.md`.
- Measurement: `references/evaluation.md`. Report measured characters separately from
  provider input/output/cache tokens; local estimates are not billed usage.

`claudekit-original.md` and the other bundled references are optional background.
Their usage hooks, quota APIs and numerical targets are not implemented guarantees
of verid. Never infer live usage from them or spawn helpers solely to save tokens.

Preserve approved ACs, evidence, roles and protected files. Implementation follows
`verid:tdd` and `verid taste`; this skill grants no approvals or extra permissions.
