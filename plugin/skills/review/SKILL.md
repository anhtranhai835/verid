---
name: review
description: Use when a verid module is ready for review, a signed auto plan needs review, or the product is ready for handoff.
---

# verid: review and serve

State assumptions and ask about ambiguity. Choose the smallest adequate solution.
Keep edits focused on local style. Define success by observable tests.

Use the completion evidence described in verid:tdd. `verid menu` names the next
review and mapped roles; read the manifest with Read if a mapping is needed.

1. Generate the review snapshot with `verid menu --commits --file`. It prints
   `.verid/review/work.md`, readable by reviewers and writable only by the CLI.
   Supply that path, module name and AC codes, `.verid/plan.md` and
   `.verid/design.md` paths, and relevant design row names to the mapped reviewer.
   It reads the evidence directly; keep diffs and document excerpts out of the
   dispatch prompt. When Git evidence is absent, give the changed file paths and
   identify the missing history. The packet is a snapshot: regenerate after fixes.
2. Read the report. Findings have file:line; each AC gets one coverage line.
   Critical or Important correctness findings fail review. Project conventions
   in `.verid/rules/` are advisory, including architecture checker warnings.
   A failed review returns to verid:build, which handles the findings as its
   `references/review-findings.md` says, then a fresh snapshot and review.
3. When security is mapped and the module changed dependencies, a lockfile, or
   install, build or CI scripts, run the stack's dependency audit and save its
   output outside private state, e.g. `security-audit.json`, with the command,
   cwd and exit status. Otherwise tell security the audit is not applicable and
   why. Give the audit path and the same packet to security after the reviewer
   passes; it reads files and runs nothing. Critical or High findings, or an
   incomplete review, fail; supply what it names as missing. After repairs repeat
   the reviewer, then security.

verid records final reports under `.verid/.state/reviews/`. Later code/test writes
or a new module order invalidate a module review; any project write outside
`.verid/` invalidates security review. Running taste alone invalidates neither.
`SubagentStart` binds each review to its subject, input documents and write history.
Changes during review discard its result as `REVIEW_STALE`; dispatch a fresh reviewer.
After upgrading hooks, run `verid doctor` and trust the new hook through Codex `/hooks`.
The final line is exactly `Verdict: pass` or `Verdict: fail`, because the hook
reads it; a missing verdict fails.

In human drive, ask the developer to run `verid serve <module>`. Closure requires
covered ACs, current passing evidence and required passing reviews. A missing
reviewer requires `roles.reviewer` mapping. In auto, verid serves and opens the
next module itself; the third failed module or security review leaves it stuck.
Git commits and architecture audits do not gate closure.

For `product`, review every module against the design and the product's e2e ACs.
When product is served last, hand over:

1. Read `.verid/rules/git.md` for the project's handoff convention.
2. Use the final evidence after the last change.
3. Inspect changed files on the agreed branch.
4. Finish any remaining small, feature-scoped commits using the project's commit
   convention. Verified feature increments may already have their own commits;
   never bundle unrelated features into a large handoff commit.
5. Push the branch.
6. Open a PR describing behaviour, evidence and material limitations.
7. Give the developer the PR and findings for their squash-merge.
8. Clean up only after that merge; local merging bypasses the agreed handoff.
