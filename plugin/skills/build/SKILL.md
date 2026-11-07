---
name: build
description: Use when an approved verid module is ready for implementation.
---

# verid: build

State assumptions and ask about ambiguity. Choose the smallest adequate solution.
Keep edits focused on local style. Define success by observable tests.

Read verid:tdd once for this build loop; use verid:debugging for unclear failures.
Settle ambiguous ACs through verid:ba in the main conversation.

Run `verid menu` for the open module and `verid peek` for uncovered ACs and cycle.
Read `.verid/log/<module>.md` first when it exists: it is where the last session stopped.
Read `.verid/manifest.yaml` with Read for role mappings, repo paths and globs.
Read project rules in `.verid/rules/` when relevant; conventions are advisory.

Keep Git commits small and feature-scoped. After a coherent increment passes its
relevant verification, inspect `git diff --staged` and commit only that increment
with its tests using Conventional Commits. A task can have several small commits;
never bundle unrelated features, formatting or broad refactors into one commit.
Do not commit a broken intermediate TDD state.

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

Dispatch paths and identifiers, rather than copied AC text, design excerpts or diffs;
agents read the files themselves. For custom agents, name verid:tdd and its installed
path if needed, their write responsibility, and the relevant public interfaces.
With mapped tester and coder, the main conversation delegates both writes because
the hook separates ownership. On Codex, or with unmapped roles, main handles them.

Read UI source to derive Playwright selectors. Keep Playwright under `e2e/` and
exclude `e2e/**` from the unit runner; another runner needs matching `e2e_globs`.
Evidence requires a JUnit report.

In a workspace, in remix mode or in auto drive, read `references/modes.md` in this
skill's folder first.

Once all module ACs pass, continue with verid:review.
