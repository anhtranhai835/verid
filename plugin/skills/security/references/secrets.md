# Secrets: detection, severity and masking

The only secret patterns and severity rules for `verid:security`.

## Where to look

Search every file in scope, test fixtures, docs, `.md` and `.txt` included. Skip only
`node_modules/`, `dist/`, `vendor/` and other generated output. Never skip a line because
it says TODO or because the file is a test: decide by context. A value is a placeholder
only when its context shows it (`YOUR_API_KEY`, `<token>`, `xxxx`, `example.com`, an env
read such as `process.env.KEY`). Name each `.env`, `.env.local` or `.env.production` the
change adds, and whether `.gitignore` covers it.

## Patterns

High confidence (structured):

```
AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}                       AWS access key id
gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{22,}   GitHub
glpat-[A-Za-z0-9_-]{20,}                                GitLab
(sk|rk)_live_[0-9a-zA-Z]{24,}                           Stripe live (sk_test_: lower impact)
xox[abprs]-[0-9A-Za-z-]{10,}|xapp-[0-9A-Za-z-]{10,}     Slack
AIza[0-9A-Za-z_-]{35}                                   Google API key
sk-ant-[A-Za-z0-9_-]{40,}                               Anthropic
sk-(proj-)?[A-Za-z0-9_-]{32,}                           OpenAI-style key
npm_[A-Za-z0-9]{36}|pypi-[A-Za-z0-9_-]{50,}             package registry tokens
-----BEGIN [A-Z ]*PRIVATE KEY-----                      private key
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}   JWT
```

Needs context:

```
(?i)(api[_-]?key|secret|token|credential)\s*[:=]\s*['"][A-Za-z0-9/+=_-]{16,}['"]
(?i)(password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]
(?i)(postgres|mysql|mongodb(\+srv)?|redis|amqp)://[^:/\s]+:[^@\s]+@
```

Long hex strings and hashes are not secrets by themselves: SHAs and fingerprints are normal.

## Severity

- Critical: a real credential for production or shared infrastructure in a committed file.
- High: a real credential for another environment, or one whose scope you cannot tell.
- Medium: a match whose context does not show whether it is real; say what would decide it.
- Not a finding: a placeholder or test marker shown as such by its context.

Never say a credential is live: you do not test it.

## Masking

Report path:line, the type and a masked form only, never the value, its prefix or suffix,
or the line it is on: `<REDACTED_TOKEN>`, `postgres://user:<REDACTED_PASSWORD>@host/db`, or
the variable name (`$DATABASE_URL`). Recommend rotation and removal from history for a real
credential. Masking in the report does not clean what tools already showed in this session.
