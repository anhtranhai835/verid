---
name: edge-cases
description: Use when an AC has input, state, permission or timing boundaries.
---

# verid:edge-cases

Decompose an acceptance criterion (an `AC-n` line of the open module in `.verid/plan.md`), or the code
path it reaches, across the dimensions below to surface edge cases, risks and test targets before its
tests are written.

Use it before tests for an AC with input, state, permission or timing boundaries, for complex or
stateful features, and for API contract or risk review. For a simple AC, skip this skill and list 3–5
cases in the test report. Skip it for trivial or cosmetic changes, pure configuration, and stable
well-tested code nobody is changing.

The default is one pass. For a fixed number of iterations, a run until no new scenario appears, or
another domain, focus or output format, read `references/iterative-mode.md`.

## Dimensions

Not all 12 apply to every feature. Identify the relevant ones first, then generate scenarios only for
those.

| #   | Dimension             | What to Look For                                                                               |
| --- | --------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | **User Types**        | admin, guest, banned, new user, power user, bot/scraper                                        |
| 2   | **Input Extremes**    | empty, null, max length, unicode, special chars, SQL/script injection                          |
| 3   | **Timing**            | concurrent access, race conditions, timeout, slow network, retry storms                        |
| 4   | **Scale**             | 0 items, 1 item, 1M items, pagination boundary, cursor wrap                                    |
| 5   | **State Transitions** | first use, mid-flow abort, resume after crash, partial completion                              |
| 6   | **Environment**       | mobile/low-end CPU, no JS, screen reader, proxy/VPN, different timezone/locale                 |
| 7   | **Error Cascades**    | DB down, API timeout, disk full, OOM, network partition, partial write                         |
| 8   | **Authorization**     | expired token, wrong role, shared/public link, CORS, CSRF, privilege escalation                |
| 9   | **Data Integrity**    | duplicate entries, orphan references, encoding mismatch, concurrent schema migration           |
| 10  | **Integration**       | webhook replay, API version mismatch, third-party outage, contract drift                       |
| 11  | **Compliance**        | GDPR deletion request, audit logging gap, data retention, accidental PII exposure              |
| 12  | **Business Logic**    | edge pricing (zero/negative), coupon stacking, refund after partial delivery, free tier limits |

## One pass

1. **Read** the AC and the code it reaches, or parse the feature description
2. **Filter dimensions** — mark which of the 12 apply; skip irrelevant ones explicitly
3. **Generate 3–5 scenarios** per relevant dimension
4. **Categorize severity** — Critical / High / Medium / Low
5. **Output** the table below
6. **Summarize** total scenario count by severity

| Level        | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| **Critical** | Data loss, security breach, auth bypass, silent corruption |
| **High**     | Feature broken for a subset of users, data inconsistency   |
| **Medium**   | Degraded UX, recoverable error not surfaced to user        |
| **Low**      | Minor visual glitch, non-blocking warning                  |

```
## Scenario Report: AC-1 [target]

Dimensions analyzed: [list]
Dimensions skipped: [list + reason]

| # | Dimension | Scenario | Severity | Expected Behavior |
|---|-----------|----------|----------|-------------------|
| 1 | Input Extremes | Empty string for required name field | High | Return 400 with field error |
| 2 | Authorization | Expired JWT accessing protected route | Critical | Redirect to login, invalidate session |
| 3 | Timing | Two users submit same form simultaneously | High | Idempotency key or conflict error |

### Summary
- Critical: N
- High: N
- Medium: N
- Low: N
- Total: N scenarios across X dimensions
```

## In verid's loop

The scenarios are test targets, not tests. In verid one behaviour gets one failing test at a time
(verid:tdd):

| Next Step                                                       | Who                                  | How                                                                                        |
| --------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Turn the Critical and High scenarios the AC asks for into tests | the tester (or qa for an `(e2e)` AC) | One failing test per behaviour, its name carrying the AC code, then `verid taste`          |
| Note risks the plan misses                                      | the planner                          | A scenario the AC cannot hold becomes a `[NEEDS CLARIFICATION: …]` in the module's section |
| Feed the security reviewer                                      | the main conversation                | Pass the Critical security scenarios with the diff to verid:security                       |

A scenario becomes a test only when the AC asks for that behaviour, whatever its severity. A Critical
or High scenario the AC does not cover goes to your report as a question for the plan, so nobody
writes code no AC asks for.
