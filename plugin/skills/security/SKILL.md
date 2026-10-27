---
name: security
description: STRIDE + OWASP security review of a verid module's diff, with a red-team persona pass, secret and dependency checks and vulnerability patterns. Read-only. The final report ends with a Verdict line, pass or fail, that verid reads before it serves the module.
---

# verid:security — Security Review

Runs a structured STRIDE + OWASP security review on the module you are given: its diff, the files it
touched, and the code that reaches them. Produces a severity-ranked findings report that ends with
the Verdict verid reads. It changes nothing: it reports findings with fix suggestions, and the
build loop fixes them (a failing test first, then the code).

Use andrej-karpathy-skills:karpathy-guidelines as a review lens.

## Scope

- **In scope:** the files the module added or changed (the diff, for example `git diff --stat` and
  `git diff` of the module's branch), and the code they call or that calls them. Read all in-scope
  files before analysis.
- **Out of scope:** penetration testing, runtime security analysis, infrastructure you were not
  given, compliance audits. Name what you did not see rather than guessing about it.
- **No commands.** You read files only. The dependency audit output comes from the agent that
  dispatched you; if it is missing, say so in the report and judge the lockfile and manifest you
  can read.

---

## Review Methodology

### 1. Scope Resolution

Expand the diff into a file list, then add the code that reaches it (callers, the routes or
handlers in front of it, the data it reads and writes). Read all in-scope files before analysis.

### 2. Red-Team Pass

Iterate the 4 attacker personas over the scope before the sweep below, one persona per phase:

1. **Security Adversary** — external hacker; auth bypass, injection, IDOR, privilege escalation
2. **Supply Chain Attacker** — dependency/CI poisoning; CVEs, unsigned artifacts, overly permissive CI
3. **Insider Threat** — compromised internal account; horizontal/vertical escalation, bulk export, audit gaps
4. **Infrastructure Attacker** — runtime/deployment foothold; SSRF, secrets in env, container misconfig

Each persona phase follows the iteration protocol:

- Select next untested attack vector from persona's probe list
- Assume that attacker's mindset — reason as adversary, not defender
- Probe relevant code, trace data flows, find missing guards
- Validate with proof (file:line, attack scenario, impact)
- Log it to the findings table of your report, with a `persona` column
- Chain: prior persona findings compound into later phases

> See `references/red-team-personas.md` for the full persona catalog: threat models, typical attack vectors, and per-persona probe checklists.

### 3. STRIDE Analysis

Evaluate each threat category systematically:

- **S**poofing — identity/authentication weaknesses
- **T**ampering — input validation, integrity controls
- **R**epudiation — audit logging gaps
- **I**nformation Disclosure — data leakage, secret exposure
- **D**enial of Service — rate limits, resource exhaustion
- **E**levation of Privilege — broken access control, RBAC gaps

### 4. OWASP Top 10 Check

Map findings to OWASP categories (A01–A10). See `references/stride-owasp-checklist.md` for per-category checks.

### 5. Secret Detection

Load `references/secret-patterns.md` for regex patterns, and search the in-scope files with Grep for each pattern category:

- API keys and tokens (AWS, GitHub, Stripe, etc.)
- Private keys and certificates
- Database connection strings with credentials
- Hardcoded passwords in code

**Exclude**: `.env.example`, test fixtures, documentation, `node_modules/`, `dist/`

For each match:

- Verify it's a real secret (not a placeholder like `YOUR_API_KEY`)
- Rate severity: CRITICAL (exposed prod key), HIGH (real credential), MEDIUM (possible credential)

Check that `.env` files are not committed: read `.gitignore` for `.env` patterns, and name any `.env`, `.env.local` or `.env.production` file the diff adds.

### 6. Dependency Audit

Read the audit output you were given for the detected stack (`npm audit --json`, `pip-audit`,
`govulncheck`, `bundle audit`, `cargo audit`; see `references/stride-owasp-checklist.md`), and any
dependency the module added or upgraded in its manifest or lockfile. Categorize by severity
(critical/high/moderate/low). Without audit output, read the manifest and lockfile and report the
audit as not run.

### 7. Code Pattern Analysis

Load `references/vulnerability-patterns.md` for patterns, and search the in-scope files with Grep for dangerous patterns:

- SQL injection (string concatenation in queries)
- XSS (innerHTML, dangerouslySetInnerHTML without sanitization)
- Command injection (exec/spawn with unsanitized input)
- Path traversal (user input in file paths)
- Insecure randomness (Math.random for security)
- eval() / Function() with dynamic input

For each match:

- Read surrounding code context (5-10 lines)
- Reason whether it's a real vulnerability or false positive
- Rate severity and suggest fix

### 8. Finding Categorization

Deduplicate across the phases above, then assign each finding a severity level (see Severity Definitions below).

---

## Credential Hygiene (Mandatory)

All findings MUST mask secret values before they appear in the report. Never emit raw JWTs (`eyJ...`), 32+ char hex strings, AWS key prefixes (`AKIA`, `ASIA`), or connection strings with embedded passwords. Use `<REDACTED_TOKEN>`, `<REDACTED_PASSWORD>`, or reference the env var name only; for other secrets show the first 4 + last 2 chars at most.

- NEVER execute secrets or credentials found during the review
- NEVER modify code — only report findings with fix suggestions
- If a real credential is found, recommend immediate rotation

---

## Severity Definitions

| Severity | Description                                          | Fix Priority              |
| -------- | ---------------------------------------------------- | ------------------------- |
| Critical | Exploitable now, data breach or RCE risk             | Immediate — block release |
| High     | Exploitable with moderate effort, significant impact | This sprint               |
| Medium   | Limited exploitability or impact                     | Next sprint               |
| Low      | Theoretical risk, defense-in-depth improvement       | Backlog                   |
| Info     | Best practice suggestion, no direct risk             | Optional                  |

---

## Report

Your final message is the report itself, with nothing after it:

```
## Security Review: <module>

### Summary
- Files reviewed: N (the diff, plus the code that reaches it)
- Findings: X critical, Y high, Z medium, W low, V info
- Dependency audit: <command and result, or "not given">
- Not seen: <what was out of reach, or "nothing">

### Findings

| # | Severity | Persona | Category | File:Line | Description | Fix Recommendation |
|---|----------|---------|----------|-----------|-------------|-------------------|
| 1 | Critical | Security Adversary | Injection | api/users.ts:45 | SQL string concatenation | Use parameterized queries |
| 2 | High | Insider Threat | Auth | auth/login.ts:12 | No rate limiting | Add express-rate-limit |

### Coverage
STRIDE: S[✓] T[✓] R[✗] I[✓] D[✓] E[✓]
OWASP: A01[✓] A02[✗] A03[✓] … A10[✓]

Verdict: fail
```

This example fails: it has a Critical and a High finding.

## Verdict

The last line of the report, alone on its line, is exactly `Verdict: pass` or `Verdict: fail`, with
nothing after it. Write `Verdict: pass` only when no finding is Critical or High. Medium, Low and Info
findings alone do not fail a review. Otherwise write `Verdict: fail`, and let Findings say what must
change.

verid records the report under `.verid/.state/reviews/`. When `roles.security` is mapped, a module
is served only when its security review passed after the last change; any later write in the project
outside `.verid/` voids it, dependency, config and `.env` files included. In an auto drive the third failed security review of a module leaves the
drive stuck, so name what is wrong exactly.
