---
name: tdd
description: Use when writing or changing verid tests and production code.
---

# verid: test first

No production behaviour before a test has failed for that behaviour.
RAW = RED, COOKING = GREEN, PLATED = REFACTOR.

1. Read the AC and public interface. Write one test; include its code in the name,
   e.g. `AC-3 rejects empty names` or `AC_3_rejectsEmptyNames`.
2. Run `verid taste`. Confirm an assertion fails for the missing behaviour.
   If the test cannot load, RAW permits only a stub that lets it reach the assertion;
   taste again. A passing test in RAW has not earned implementation: find the missing case.
3. In COOKING, tests are frozen. Implement the minimum fix, then taste until PLATED.
4. Refactor only in PLATED without adding behaviour; taste after each change.

After a test write, taste before handing off. RAW · stub permits only a stub, then
taste again for an assertion failure. The main conversation writes
`.verid/log/<module>.md` after each AC; agents report paths and evidence to it.
Stop holds main on COOKING, stub or unverified writes, and once for uncovered ACs
or review. SubagentStop lets a tester/QA hand off a recorded failure or stub;
other writers must taste their changes. A hold is issued only once per stop.
For a refactor-only conversation, the developer can run `verid garnish`.

Only a passing `verid taste` after the last change counts as completion evidence;
an ad hoc runner command is useful for diagnosis but records no verid evidence.
Respect mapped tester/QA and coder ownership. Never weaken a test or bypass a denial;
return a wrong frozen test to the developer. Use verid:debugging when the cause is unclear.
For an `(e2e)` AC, drive the real product through Playwright or a path matching `e2e_globs`.

## Six rules for useful tests

1. Name the break: one observable behaviour per test; a realistic bug must make it fail.
2. Derive expectations independently with literal values or hand-checked fixtures.
3. Exercise real behaviour and your boundary contract, not source text or framework mechanics.
4. Assert real outcomes, not mocks; understand side effects before mocking a slow/external seam.
5. Keep doubles specific and complete; move test-only helpers out of production classes.
6. Prefer real components to elaborate mocks; mentally mutate branches, values and effects to check coverage.

For the full rules with examples, read `writing-good-tests.md`.

## When shortcuts sound reasonable

- **Too simple to test:** cover the break it could cause; skip tests that repeat trivial code.
- **I'll test after:** immediate green cannot prove the test catches the missing behaviour.
- **Tests after achieve the same goal:** existing code biases the cases; test first defines the outcome.
- **Already tested manually:** a manual try leaves no repeatable regression check.
- **Need to explore first:** explore, discard the spike, then build from a failing test.
- **Hard to test:** reconsider the public interface or coupling before adding mocks.
- **Existing code has no tests:** add a regression for the behaviour you are changing.

State uncertainty and ask about ambiguity.
Build only what the failing behaviour needs.
Keep edits focused and follow local style.
Define success by observable tests and recorded evidence.
