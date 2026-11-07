---
name: build
description: Use when an approved verid module is ready for implementation.
---

# verid: build

State assumptions, clarify ambiguity and keep edits local. Choose the smallest
solution that meets observable tests.

Read verid:tdd once for this build loop; use verid:debugging for unclear failures.
Settle ambiguous ACs through verid:ba in the main conversation.

Use `verid menu` for the open module and `verid peek` for cycle and uncovered ACs.
Read `.verid/log/<module>.md` first if present, then `.verid/manifest.yaml` for roles,
repos and globs. Follow relevant `.verid/rules/` (advisory).

Commit small, verified feature increments with their tests using Conventional
Commits. Inspect `git diff --staged`; never mix unrelated work or commit broken
TDD states. Details: `.verid/rules/git.md`.

For each uncovered AC, dispatch one writer at a time because repos share one cycle:

1. Give the mapped tester the module name, AC code, `.verid/plan.md` path,
   `.verid/design.md` path and relevant design row names and code paths.
   For `(e2e)`, prefer the mapped qa; otherwise the tester handles it. When the module
   has `Screens:`, the e2e test checks the chosen wireframe's elements, labels and states.
2. Give the mapped coder the same identifiers and failing test path. It handles a
   permitted stub, implementation and refactoring under verid:tdd.
3. Read the reports, append to `.verid/log/<module>.md`, and continue with the next
   uncovered AC.

The main conversation alone writes the log; agents report to it. One entry per AC:

```markdown
## 2026-11-05 AC-2 (REQ-3)

- Done: what passes now, test and code paths.
- Decided: each choice and why; anything the developer settled.
- Deviation: what differs from the plan or design and why, or none.
- Commits: repo@sha, or none yet.
- Next: the next AC, or "module ready for review".
```

Never rewrite earlier entries, and keep source, test output, secrets and personal data
out of the log.

Dispatch identifiers and paths; agents read the documents. Name verid:tdd (and its
path for custom agents), write responsibility and relevant interfaces. Mapped
tester/coder roles own their writes; on Codex or without mappings, main writes.

Read UI source to derive Playwright selectors. Keep Playwright under `e2e/` and
exclude `e2e/**` from the unit runner; another runner needs matching `e2e_globs`.
Evidence requires a JUnit report.

In a workspace, in remix mode or in auto drive, read `references/modes.md` in this
skill's folder first.

Once all module ACs pass, continue with verid:review.
