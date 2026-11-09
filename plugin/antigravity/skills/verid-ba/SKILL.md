---
name: verid-ba
description: Use when a verid project needs requirements research, scope clarification, EARS specification (.verid/spec.md), or modular BA dossiers.
---

# verid-ba (Antigravity)

Inventory `.verid/docs/` (read-only) first, then the user request, code, and tests.

## Token-Efficient Document Reading

- For DOCX, PDF, or large markdown inputs in `.verid/docs/`, do **not** dump whole files into context. Run the local reader script via `run_command`:
  - If `.verid/skills/context-engineering/scripts/document_reader.py` exists, use it; otherwise use the plugin's `resources/skills/context-engineering/scripts/document_reader.py` (or `plugin/skills/context-engineering/scripts/document_reader.py`).
  - Run `--mode outline` first, then `--mode search` or `--mode read --block <id>` to pull only cited excerpts (capped at 6,000 chars).

## Clarification Discipline

- Ask **only** when the answer changes what gets built and nothing in `.verid/docs/` or the repo answers it; otherwise state your proposal and rationale for the developer to confirm.
- Use Antigravity's `ask_question` tool (1–3 focused questions per round, recommended option first).
- Record every Q -> A under `## Clarifications` in `.verid/research.md`.

## Outputs

1. **`.verid/research.md`** ( citing `.verid/docs/` sources with SHA-256/locator):
   Required headings: `## Problem`, `## Users`, `## Goals and completion signals`, `## Evidence`, `## Scope`, `## Constraints and assumptions`, `## Risks`, `## Screens`, `## Suggested modules`, `## Glossary`, `## Decisions`, `## Open questions`, `## Clarifications`.
2. **`.verid/spec.md`** (EARS format):
   - `- REQ-1: When <trigger>, the <system> shall <response> (source: ...)`
   - `- NFR-1: ...`, `- SEC-1: ...`
   - Plus `## Abuse cases`, `## Data classification`, `## Out of scope`.
   - Agree `.verid/spec.md` with the developer before moving to `verid-design`.
