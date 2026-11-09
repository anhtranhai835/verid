---
name: verid-design
description: Use when a verid project has agreed research and spec and needs architecture decisions, reuse inventory, and .verid/design.md.
---

# verid-design (Antigravity)

Read `.verid/research.md`, `.verid/spec.md`, and `.verid/rules/architecture.md`. Open cited `.verid/docs/` sections only when needed.

## Workflow

1. **Approaches & Tradeoffs:**
   - If the design is straightforward, present a concise proposal for approval.
   - If competing architectures exist, present 2–3 options with tradeoffs (and your recommended pick first) via `ask_question`.
2. **Reuse Inventory & Boundaries:**
   - Inspect existing code across manifest repos and classify each relevant file:line as `reuse`, `extend`, `supersede`, or `duplicate`.
3. **Write `.verid/design.md`** with exact required headings:
   - `## Architecture decisions`
   - `## Existing code`
   - `## Boundaries`
   - `## Module map` (include table `| Module | Responsibility | Interfaces | Depends | Repos | Size |` + a `mermaid` dependency diagram)
   - `## Data`
   - `## Interfaces`
   - `## Tradeoffs`
   - `## Out of scope`
4. **Builder Check:**
   - Verify every `REQ-*`, `NFR-*`, and `SEC-*` in `.verid/spec.md` maps to a module and testable boundary in `.verid/design.md`, then proceed to `verid-plan`.
