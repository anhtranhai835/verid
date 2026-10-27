---
name: build
description: Step 5 of a verid project. Build the open module one acceptance criterion at a time, dispatching `verid:tester` for the failing test and `verid:coder` for the code, until every AC has a passing test. Use once the developer has ordered a module, or in an auto drive once the plan has passed review.
---

# verid: build the open module

Use andrej-karpathy-skills:karpathy-guidelines before building each AC.

Coordinate with superpowers:subagent-driven-development: you dispatch, the agents write. Every cycle
follows superpowers:test-driven-development, which verid enforces under other names: RAW = RED,
COOKING = GREEN, PLATED = REFACTOR. When a run fails for a reason you do not understand, find the
cause first with superpowers:systematic-debugging.

## Where you are

Run `verid menu`: it names the open module and the next step. `verid peek` shows the cycle and the
acceptance criteria that still have no passing test.

Read the mappings in `.verid/manifest.yaml` with Read, never Bash. Use the mapped tester, coder
and qa agent types; an unmapped qa role falls back to the tester for end-to-end tests.

In a workspace, read each repo's path and role. Use the `role: frontend` repo for end-to-end
tests by default, or the designated `role: e2e` repo when the design places them there. qa may
write end-to-end tests in any listed repo; give it that repo's path and its repo-relative
`e2e_globs`. Keep the TDD gate and one shared cycle across repos. Run `verid taste` from the
workspace root to collect every repo's evidence.

## A branch per module

In a git project, suggest one branch `feat/<module>` for the open module, for example
`feat/signup`. This is a suggestion for the developer in human drive; the hook does not enforce
branches. In auto drive, create or switch to that module's branch from the completed work so
far, and commit that module on it during `verid:review`. Keep prior modules' commits; never
discard changes to switch branches. The clean-tree check is unchanged. Without git, skip this.

For a workspace, apply the branch suggestion to each repo involved in the module and commit
its changes there. Commit shared planning changes in the `.verid` repo too; auto waits for
every listed repo and `.verid` to be clean. The workspace root has no git repository.

## One AC at a time

For each AC of the open module without a passing test:

1. **Dispatch the mapped qa for an `(e2e)` AC when available; otherwise the mapped tester**
   (`verid:qa` and `verid:tester` by default), with the module name, the AC line and the
   parts of `.verid/design.md` and the code it needs. It writes one failing test that names the AC
   and stops at COOKING, or at `RAW · stub` when the code under test does not exist yet.
2. **Dispatch `verid:coder`** with the same AC and the test file. It writes the stub if one is open,
   then the minimum code, runs `verid taste` until PLATED, and refactors.
3. Read both reports. Check them with `verid peek`, not by trust: only `verid taste` runs count.

Give each agent its task, not your conversation, and in it the design table rows, allowed edges
and public interfaces of `.verid/design.md` that its AC touches. Agents from other plugins mapped
in `roles` do not know verid or the table: their task is all they get. One module and one cycle are
open at a time, so never run two writers at once.

When the manifest configures `architecture_check`, `verid taste` runs the project's checker after a
passing suite. A failing check (`VERID_BURNT_ARCHITECTURE_FAILED`) is fixed in the code through the
coder, like a failing test; nobody weakens its rules. One that shows no evidence
(`VERID_BURNT_ARCHITECTURE_UNAVAILABLE`) needs its command or inputs restored, and a change to the
manifest is the developer's.

When the manifest maps both a tester and a coder, the roles are split: you write neither tests nor
production code yourself (`VERID_BURNT_ROLE_TESTER_ONLY`, `VERID_BURNT_ROLE_CODER_ONLY`), and each
agent writes only its own part.

## End-to-end ACs

The mapped qa writes the test of an `(e2e)` AC; if unmapped, the tester does. Use Playwright by
default, with selectors read from the real UI source and the AC code in each test name. qa
writes only tests whose paths match `e2e_globs`, including Playwright tests, never production
code or unit tests; return missing setup or interface questions to the main conversation. The
main conversation relays questions one at a time. In auto after signing, a question that needs
the developer becomes `.verid/blocked.md`.
Every test the Playwright runner reports counts as end to end; with another runner, use a path
that matches `e2e_globs`. The runner must write a JUnit report that `verid taste` reads. When a
project has both a unit runner and Playwright, keep them apart as `verid cook` suggests: Playwright under `e2e/`, and the
unit runner excluding `e2e/**`.

## When verid says no

Read the message: it says what to do next. Never look for another way around a rule. If an
exception is truly needed, explain why to the developer; only they can type `/verid tip`.

## Auto drive

When the first line of `verid menu` says `drive auto` (the session-start message says it too), verid
opens the first module not yet served, so you wait for no order. Do not read the manifest with Bash
to find out: verid blocks it. The roles are split, so dispatch the mapped tester (qa for an
`(e2e)` AC when mapped) and coder as above. Commit each module on its `feat/<module>` branch.

- **Three coder rounds per AC.** A round ends when a coder's stop goes through while a failing test
  whose name carries that AC code is still red. The third such round leaves the drive stuck. Give the
  coder the failing test and the AC, and make sure the test is right before you dispatch it; a test
  without the AC code in its name cannot be counted.
- **Stop holds you** at every stop until the drive is done or stuck, and three holds in a row with
  nothing changed leave it stuck. Take the next step `verid menu` names instead of stopping or
  repeating a step.
- **When the rounds run out**, the drive is stuck and production code and tests are locked
  (`VERID_BURNT_AUTO_STUCK`). Do not look for a way around it, neither by writing code or tests
  yourself nor by asking for `/verid tip`: only the developer clears a stuck drive.
- **When you cannot go on**: a rule blocks work the module needs, or the design must change. Write
  what stops you, your question and the options into `.verid/blocked.md`, then stop. The developer
  settles it and runs `verid order` to continue.

## Done

When every AC of the module has a passing test, `verid menu` says to evaluate the module. Continue
with the `verid:review` skill.
