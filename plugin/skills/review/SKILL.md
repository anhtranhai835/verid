---
name: review
description: Steps 6 to 8 of a verid project. Once every acceptance criterion of a module passes, verify the whole suite, have `verid:reviewer` and then `verid:security` (when mapped) review the module after the last change, and ask the developer to run `verid serve` (in an auto drive, commit the module and let verid serve it); for the `product` module, review the whole product and finish the branch.
---

# verid: review and serve

Use andrej-karpathy-skills:karpathy-guidelines as a review lens.

Ask for the review as superpowers:requesting-code-review describes, and claim nothing without fresh
evidence (superpowers:verification-before-completion).

## 1. Verify

Run `verid taste` for the whole suite. It must pass, with no change after it. `verid menu` should
say to evaluate the module. When the manifest configures `architecture_check`, the same run must
pass every repo's check: a module closes only on a check that passed on the files, settings, design
and module as they are, so run `verid taste` again after any later change. `verid menu` names a
repo whose check failed, gave no evidence or is stale.

## 2. Review after the last change

Dispatch `verid:reviewer` (or the reviewer the manifest maps) only once the code and tests are final.
Give it the module name, its section of `.verid/plan.md`, `.verid/design.md`, its design table rows,
and the files the module changed (for example from `git diff --stat`). Ask it to check the
dependency direction against the table every time, and SOLID and DDD by judgment, whether or not
an architecture check ran.

When the reviewer stops, verid records its final report under `.verid/.state/reviews/`. Any write to
production code or a test after that voids the review, and so does a new `verid order`; running
`verid taste` does not.

In a git project, commit the module's work on its branch before the review, with Conventional
Commit messages: verid ties a review to the work it read, so a commit, an amended message or a
changed file after it needs another review. The reviewer cannot run Git: give it the output of
`verid menu --commits`, every commit since the module began with its message and diff, then what
is still uncommitted (secret files are left out). It judges each commit as one complete change.

Read the report. If it ends `Verdict: fail`, fix it through the `verid:build` loop (a failing test
first, then the code), commit, then dispatch the reviewer again.

## 2b. Security review after the reviewer

When the manifest maps `roles.security` (`verid menu` names the security reviewer), dispatch
`verid:security` (or the security reviewer the manifest maps) once the reviewer has passed the module.
It reads code only and cannot run commands, so give it the module name, its section of
`.verid/plan.md`, `.verid/design.md`, the files the module changed (`git diff --stat`, and `git diff`
for the module), and the output of the stack's dependency audit, which you run for it (for example
`npm audit --json`, `pip-audit --format json`, `govulncheck ./...`).

verid records its final report under `.verid/.state/reviews/`, and voids it as it voids the review.
A report that ends `Verdict: fail` is fixed the same way: the `verid:build` loop, `verid taste`, the
reviewer again, then the security reviewer again.

## 3. Serve

Ask the developer to run `verid serve <module>` from their own terminal. verid serves a module only
when every AC has a passing test, the last run passed, and the reviewer's report read the work as it
is now; when `roles.security` is mapped, also only when the security reviewer's report passed on
that work. In git it also reads every commit since the module was ordered: each must be a
Conventional Commit, and more than one commit only earns a note. It prints the reports' paths, and
the developer decides.

If no reviewer is mapped, `verid serve` refuses: the developer adds `roles.reviewer` to
`.verid/manifest.yaml` and installs the agent.

## The product module

For `product`, ask the reviewer to review the whole product, every module against the design, not
only the section of `product`. Once `product` is served and no module is served after it,
`verid menu` says the product is done. Then integrate the work with
superpowers:finishing-a-development-branch.

## Auto drive

When the first line of `verid menu` says `drive auto` (the session-start message says it too), verid
serves the module itself, so never ask the developer to run `verid serve` (it refuses:
`VERID_BURNT_AUTO_SERVE`). Do not read the manifest with Bash to find out: verid blocks it. Steps 1
to 3 become:

1. **Verify** as above: `verid taste` for the whole suite, passing, with no change after it.
2. **Commit** every change of the module, new files included, on its `feat/<module>` branch
   suggested by `verid:build`; do not push:
   `git add -A`, then `git commit` with a Conventional Commit message that names the module, such as
   `feat(<module>): <what it adds>`. verid serves a
   module only when the project's tree is clean, untracked files included; only
   `.claude/settings.local.json` is left out. Bash cannot name that file, which is why `git add -A`
   is the way. Without git there is nothing to commit.
3. **Review** as above, with `verid menu --commits`: dispatch `verid:reviewer` after the commit. A
   commit after the review needs another one. Its final report ends with
   `Verdict: pass` or `Verdict: fail`. When `roles.security` is mapped, dispatch the security reviewer
   once the reviewer passes, as in step 2b. On the passes verid needs, it serves the module once they
   follow the last change and the tree is clean, and the next module opens; `verid menu` says so, or
   says what is still missing, such as a commit.
4. **On a fail**, or a report with no `Verdict:` line, fix the module through the `verid:build` loop
   (a failing test first), run `verid taste`, commit and dispatch the reviewer again. The third fail
   leaves the drive stuck. A failed security review is fixed the same way and has its own count:
   the third leaves the drive stuck too.

For `product`, a pass that closes the module ends the drive: `verid menu` says the product is done.
Leave the branch as it is, tell the developer, and let them integrate the work with
superpowers:finishing-a-development-branch.
