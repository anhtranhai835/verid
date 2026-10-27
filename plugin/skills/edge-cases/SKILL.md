---
name: edge-cases
description: Lists an acceptance criterion's edge cases and test scenarios across 12 dimensions before its tests are written, in one pass or in a loop until no new case turns up. The tester and qa use it for each AC of a verid module.
---

# verid:edge-cases — Edge Case & Scenario Explorer

Decompose an acceptance criterion (an `AC-n` line of the open module in `.verid/plan.md`), or the code
path it reaches, across 12 dimensions to surface edge cases, risks, and test targets before its tests
are written.

Supports two modes:

- **One-shot** (default): single pass, 3–5 scenarios per relevant dimension. Fast.
- **Iterative**: loop for a bounded count, or until novelty is exhausted (saturation), when coverage must be exhaustive.

## When to Use

- Before writing the tests of each AC (generates test targets)
- Before implementing complex or stateful features
- Risk assessment during planning or code review
- API design review — surface contract edge cases early
- Deep pre-release coverage audit (saturation)

## When NOT to Use

- Trivial single-line changes or cosmetic UI tweaks
- Already well-tested, stable code with no recent modifications
- Pure configuration changes with no logic paths

---

## Options

| Option       | Default | Purpose                                                                                   |
| ------------ | ------- | ----------------------------------------------------------------------------------------- |
| Iterations N | —       | Bounded loop: run exactly N iterations, then stop with summary                            |
| Saturation   | off     | Saturation loop: keep iterating until 2 consecutive iterations produce no novel scenarios |
| Domain       | auto    | Domain hint: `software`, `product`, `business`, `security`, `marketing`                   |
| Focus        | auto    | Prioritize dimension: `edge-cases`, `failures`, `security`, `scale`                       |
| Format       | table   | Output format: `table`, `use-cases`, `test-scenarios`, `threat-scenarios`                 |

When neither iterations nor saturation is asked for: one-shot mode (the default).

---

## 12 Decomposition Dimensions

Not all 12 apply to every feature. Identify relevant dimensions first, then generate scenarios only for those.

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

---

## Workflow

### One-Shot Mode (default)

1. **Read** the AC and the code it reaches, or parse the feature description
2. **Filter dimensions** — mark which of the 12 apply; skip irrelevant ones explicitly
3. **Generate 3–5 scenarios** per relevant dimension
4. **Categorize severity** — Critical / High / Medium / Low
5. **Output** as structured table (see format below)
6. **Summarize** total scenario count by severity

### Iterative Mode (iterations or saturation)

Iterative mode runs the loop described in `references/saturation-loop.md`. Summary:

1. **Read** target and build understanding (actors, components, preconditions)
2. **Filter dimensions** — same as one-shot
3. **Loop** — each iteration:
   a. Pick highest-priority unexplored dimension or combination
   b. Generate **one** concrete situation (specific trigger, flow, expected outcome)
   c. **Classify** against all previously kept situations:
   - **New**: different dimension AND different trigger/precondition → KEEP
   - **Variant**: same dimension but different actor, data, or outcome → KEEP
   - **Duplicate**: same dimension + same trigger + same outcome → DISCARD
   - **Out of scope / Low value** → DISCARD, note the reason
     d. If kept: expand edge cases (what-if, boundary, interruption, ordering, missing data, stale data)
     e. Add a row to the scenario log in your reply (you write no file for it)
     f. Every 5 iterations: print progress summary (see format below)
4. **Halt**:
   - iterations N: stop after N iterations
   - saturation: stop when 2 consecutive iterations produce zero `New` classifications
5. **Output** final summary with coverage matrix and composite score

**Force dimension rotation** after 3 consecutive same-dimension iterations. Rotate through:
Dimension walk → Combination → Negation → Amplification → Persona shift → Temporal shift

### Severity Criteria

| Level        | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| **Critical** | Data loss, security breach, auth bypass, silent corruption |
| **High**     | Feature broken for a subset of users, data inconsistency   |
| **Medium**   | Degraded UX, recoverable error not surfaced to user        |
| **Low**      | Minor visual glitch, non-blocking warning                  |

---

## Output Format

### One-Shot

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

### Iterative — Progress Summary (every 5 iterations)

```
=== Scenario Progress (iteration 15) ===
Scenarios kept:    12  (8 new, 4 variants)
Discarded:          3  (2 duplicates, 1 out-of-scope)
Dimensions covered: 7/12 (58%)
Edge cases found:  18
Severity:          2 Critical, 4 High, 8 Medium, 4 Low
Coverage gaps:     scale, temporal, recovery
```

### Iterative — Scenario Log (in the reply)

```
iteration	dimension	classification	severity	title	description	parent
1	happy_path	new	-	Successful checkout	User completes standard checkout	-
2	error_path	new	HIGH	Payment declined	Card rejected during checkout	-
3	edge_case	duplicate	-	Empty cart	Already covered by #1	#1
```

### Iterative — Final Summary

```
## Scenario Report: AC-1 [target]  (iterations: N)

[Full table of kept scenarios, grouped by dimension]

### Coverage Matrix
[dimension × severity grid]

### Composite Score: NNN
  scenarios_generated * 10  = X
  edge_cases_found * 15     = X
  dimensions_covered * 30   = X
  unique_actors * 5         = X
  high_severity * 3         = X

### Saturation
Halted: [after N iterations — bounded] | [saturation — 2 consecutive iterations with no novel cases]
```

---

## In verid's Loop

The scenarios are test targets, not tests. In verid one behaviour gets one failing test at a time
(superpowers:test-driven-development):

| Next Step                                                       | Who                                  | How                                                                                        |
| --------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Turn the Critical and High scenarios the AC asks for into tests | the tester (or qa for an `(e2e)` AC) | One failing test per behaviour, its name carrying the AC code, then `verid taste`          |
| Note risks the plan misses                                      | the planner                          | A scenario the AC cannot hold becomes a `[NEEDS CLARIFICATION: …]` in the module's section |
| Feed the security reviewer                                      | the main conversation                | Pass the Critical security scenarios with the diff to verid:security                       |

A scenario becomes a test only when the AC asks for that behaviour, whatever its severity. A Critical
or High scenario the AC does not cover goes to your report as a question for the plan, so nobody
writes code no AC asks for.

---

## Reference

Saturation loop mechanics, novelty detection algorithm, and generation strategies:
→ `references/saturation-loop.md`
