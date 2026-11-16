# Security report contract

One report, in this order. Keep it short: findings, one line per AC, and coverage only for
the surfaces that apply. No sweep narration, scores or full STRIDE/OWASP matrices.

```markdown
Module: <name>
Review status: complete | incomplete

## Findings

- S1 High · confirmed · A01 Broken Access Control (CWE-639) · src/api/orders.ts:42 `getOrder`
  - Precondition: any signed-in user.
  - Path: `GET /orders/:id` → `getOrder(id)` → `db.orders.find(id)`; no owner filter.
  - Guards checked: `requireUser` (auth only); no policy in caller or query.
  - Impact: reads any customer's order, address included.
  - Introduced by this change. Fix: filter by `ownerId`; regression test `AC-3 refuses another user's order`.

## Coverage

- AC-1: no security surface (pure formatting), not applicable.
- AC-3: checked authorization, src/api/orders.ts:30-60; finding S1.
- Surfaces: access control checked; injection checked; secrets checked;
  dependency audit not applicable (no manifest or lockfile change).

## Missing evidence

None.

Verdict: fail
```

## Fields

- Each finding: ID, severity, confidence, category with its CWE when known, file:line or
  symbol, precondition, path, guards checked, impact, `introduced`, `exposed` (an old flaw
  made reachable) or `existing`, fix and the regression test to write.
- Confidence: `confirmed` (full path read), `likely` (one link inferred, named) or
  `reproduced` (only with an artifact that really ran). Never a percentage.
- Coverage states: `checked`, `not applicable` (with reason), `blocked` (what is missing)
  or `not run`. A required surface that is `blocked` or `not run` makes the review
  incomplete.
- Evidence you cite names its source: file path, or the audit command, cwd and exit status
  given in the dispatch. An exit status other than zero can mean vulnerabilities found, not
  a tool failure; read the output before deciding.

## Incomplete example

```markdown
Module: checkout
Review status: incomplete

## Findings

None confirmed in the files read.

## Coverage

- Surfaces: supply chain blocked: package-lock.json changed and no audit output was supplied.

## Missing evidence

- `npm audit --json` output for package-lock.json at this snapshot.

Verdict: fail
```

Nothing follows the verdict line.
