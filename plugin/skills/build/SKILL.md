---
name: build
description: Step 5 of a verid project. Build the open module one acceptance criterion at a time, dispatching `verid:tester` for the failing test and `verid:coder` for the code, until every AC has a passing test. Use once the developer has ordered a module, or in an auto drive once the plan has passed review.
---

# verid: build the open module

Coordinate with superpowers:subagent-driven-development: you dispatch, the agents write. Every cycle
follows superpowers:test-driven-development, which verid enforces under other names: RAW = RED,
COOKING = GREEN, PLATED = REFACTOR. When a run fails for a reason you do not understand, find the
cause first with superpowers:systematic-debugging.

## Where you are

Run `verid menu`: it names the open module and the next step. `verid peek` shows the cycle and the
acceptance criteria that still have no passing test.

## One AC at a time

For each AC of the open module without a passing test:

1. **Dispatch `verid:tester`** with the module name, the AC line (with `(e2e)` if it has it), and the
   parts of `.verid/design.md` and the code it needs. It writes one failing test that names the AC
   and stops at COOKING, or at `RAW · stub` when the code under test does not exist yet.
2. **Dispatch `verid:coder`** with the same AC and the test file. It writes the stub if one is open,
   then the minimum code, runs `verid taste` until PLATED, and refactors.
3. Read both reports. Check them with `verid peek`, not by trust: only `verid taste` runs count.

Give each agent its task, not your conversation. One module and one cycle are open at a time, so
never run two writers at once.

When the manifest maps both a tester and a coder, the roles are split: you write neither tests nor
production code yourself (`VERID_BURNT_ROLE_TESTER_ONLY`, `VERID_BURNT_ROLE_CODER_ONLY`), and each
agent writes only its own part.

## End-to-end ACs

The tester writes the test of an `(e2e)` AC with Playwright, which verid recognises and counts as end
to end, or with another runner in a path that matches `e2e_globs`. The runner must write a JUnit
report that `verid taste` reads. When a project has both a unit
runner and Playwright, keep them apart as `verid cook` suggests: Playwright under `e2e/`, and the
unit runner excluding `e2e/**`.

## When verid says no

Read the message: it says what to do next. Never look for another way around a rule. If an
exception is truly needed, explain why to the developer; only they can type `/verid tip`.

## Auto drive

When the first line of `verid menu` says `drive auto` (the session-start message says it too), verid
opens the first module not yet served, so you wait for no order. Do not read the manifest with Bash
to find out: verid blocks it. The roles are split, so dispatch `verid:tester` and `verid:coder` as
above.

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
