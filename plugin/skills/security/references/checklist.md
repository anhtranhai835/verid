# Security checklist by surface

Standards: OWASP Top 10:2025 for categories, STRIDE for threat questions, OWASP ASVS 5.0
for depth when a project asks for it. Read only the sections the change touches. Every
pattern below is a candidate to trace, never a finding by itself.

## OWASP Top 10:2025

- A01 Broken Access Control: missing owner or tenant filter, UI-only checks, IDOR, CORS,
  path traversal, SSRF.
- A02 Security Misconfiguration: debug on, default credentials, permissive headers, verbose errors.
- A03 Software Supply Chain Failures: packages, lockfiles, install scripts, CI (supply-chain.md).
- A04 Cryptographic Failures: weak or homemade crypto, plaintext secrets, predictable randomness.
- A05 Injection: SQL, NoSQL, OS command, template, LDAP, XSS built from strings.
- A06 Insecure Design: business rule bypass, missing abuse case, skipped state step.
- A07 Authentication Failures: weak sessions, no login rate limit, tokens without expiry.
- A08 Software or Data Integrity Failures: unsigned updates, untrusted deserialization.
- A09 Security Logging and Alerting Failures: events not logged, secrets or personal data logged.
- A10 Mishandling of Exceptional Conditions: fail-open errors, swallowed exceptions, half writes.

## Authentication and sessions (STRIDE: spoofing)

- Every non-public route requires authentication on the server side.
- Passwords hashed with Argon2id (bcrypt or scrypt for existing stores), never fast hashes.
- Tokens expire and are verified server-side; JWT algorithm fixed, `none` rejected.
- Cookies `Secure`, `HttpOnly`, `SameSite`; OAuth uses `state` and PKCE.
- Login and reset rate-limited; no default credentials shipped.

## Authorization and business logic (elevation, tampering)

- Each handler checks permission for the object, the function and the property it touches.
- Queries scope by owner or tenant (`WHERE user_id = :current`), including bulk and export.
- State changes follow the designed order; replay, double submit and race (TOCTOU) checked.
- Admin and privileged paths have their own server-side guard, not only hidden UI.
- Modifying another user's resource returns a denial, not a silent success.

## Input to sink (tampering)

- Parameterized queries; no string-built SQL, NoSQL, shell or template.
- Subprocess with an argument array, never a shell string containing input.
- Output encoded for its context; no `innerHTML`, `dangerouslySetInnerHTML`, `v-html`,
  `|safe` or unescaped template tags with input.
- No `eval`, `new Function` or string timers on input; no `pickle.loads`, unsafe
  `yaml.load` or `unserialize` on untrusted data.
- Validation at the trust boundary: type, length, format; canonicalize before checking.

## Files, paths and local CLIs

- User-controlled paths resolved and checked for containment after canonicalization.
- Symlinks, junctions, `..`, absolute and UNC paths, drive letters and case on Windows.
- Archives checked for entries escaping the target (zip slip); size and count limits.
- Uploads checked by content and size, stored outside the web root, served with a fixed type.
- Temp files created exclusively; check-then-use races avoided.

## Outbound requests

- URL fetch from input only through an allowlist; redirects and DNS rebinding re-checked;
  metadata addresses (`169.254.169.254`, `metadata.google.internal`) unreachable.
- Credentials not forwarded to hosts the input chose; timeouts and response size limits.
- Webhooks verify signatures and reject replays.

## Disclosure, logging and errors (information disclosure, repudiation)

- Errors do not leak stack traces, paths, queries or secrets; responses return only needed fields.
- Security events (login, denial, export, configuration change) logged with actor and time;
  logs hold no secrets or personal data.
- Error paths fail closed: a failed check denies, a failed write does not leave a half state.
- TLS verification never disabled (`rejectUnauthorized: false`, `verify=False`).

## Resources (denial of service)

- Pagination and limits on list endpoints; body size limits; timeouts on external calls.
- Regular expressions on input checked for catastrophic backtracking.
- Background jobs bounded in concurrency and retries.
