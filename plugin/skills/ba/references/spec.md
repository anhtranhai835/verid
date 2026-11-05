# `.verid/spec.md` format

The spec says what the product must do, before design says how. Each line is one
requirement with a unique ID; the plan's ACs cite these IDs, and verid's audit reports
requirements no AC covers. Keep it short: depth follows risk. Contracts, data, security
and payments get full detail; a small UI change may need one REQ.

Write requirements in EARS form, one observable outcome each:

- Ubiquitous: "The system shall <result>."
- Event: "When <trigger>, the system shall <result>."
- State: "While <state>, the system shall <result>."
- Unwanted: "If <condition>, then the system shall <result>."
- Optional: "Where <feature is enabled>, the system shall <result>."

End each with its source: a file in `.verid/docs/` (with section), a Clarification in
`.verid/research.md`, or the developer's decision. Never invent a requirement; ask, or mark
it `[NEEDS CLARIFICATION: <question>]`.

```markdown
# Spec

## Requirements

- REQ-1: When a visitor submits an email and password, the system shall create an account and sign them in. (source: docs/brd.md §2.1)
- REQ-2: If the email is already registered, then the system shall refuse it without saying whether the account exists. (source: Clarifications Q3)

## Non-functional

- NFR-1: The system shall answer signup within 500 ms at the 95th percentile. (source: docs/prd.pdf p. 4)

## Security

- SEC-1: The system shall store passwords only as salted, slow hashes. (source: developer)
- SEC-2: If one address fails to sign in 5 times in 10 minutes, then the system shall delay further attempts. (source: abuse case A-1)

## Abuse cases

- A-1: An attacker tries many passwords for one email → SEC-2.

## Data classification

| Data     | Class    | Rule                             |
| :------- | :------- | :------------------------------- |
| email    | personal | never in logs or URLs            |
| password | secret   | never stored, logged or returned |

## Out of scope

- Social login. (source: Clarifications Q5)

[NEEDS CLARIFICATION: must an account be confirmed by email before first sign-in?]
```

- IDs are unique and never reused: REQ-n, NFR-n, SEC-n, A-n. Change a requirement in place
  and add `Changed <date>: <change>, because <reason>` under it; a dropped one stays with
  `Dropped <date>: <reason>`.
- Every abuse case points to the SEC requirement that answers it.
- Data classes are `public`, `internal`, `personal` or `secret`.
- Agree the spec with the developer, one open question at a time, before verid:design.
