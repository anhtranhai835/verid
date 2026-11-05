# Attacker lenses

Four question sets, one per attacker. Use the lens a touched surface calls for; each answer
still goes through the challenge questions in `SKILL.md` before it becomes a finding.
Chain lenses: an open endpoint found by one lens is the start of the next.

## External adversary (no access)

- Trace every new input from entry point to sink: where is validation missing?
- For each route with `:id`, `:slug` or a body id: is ownership checked server-side?
- Can a token be forged or replayed: algorithm confusion, missing expiry, weak secret?
- Does middleware order let a request reach a handler before authentication?
- Do errors, headers or debug routes reveal internals?

## Supply chain attacker (poisons an upstream)

- Is each new dependency the intended package: exact name, publisher, age, no lookalike?
- Does it run install scripts, download at build time or pull from a non-default registry?
- Does the lockfile match the manifest, with integrity hashes, and pin what CI installs?
- Do workflows grant `write-all`, run `pull_request_target` on untrusted code, or use third
  party actions by tag instead of a commit SHA?
- Do Dockerfiles or scripts run `curl | sh` or fetch without a checksum?

A new, little-used or old package is a reason to look closer, not a High finding.

## Insider (valid low-privilege account)

- Is every privileged action authorized on the server, not only hidden in the UI?
- Can user A read, change or delete user B's data, or another tenant's?
- Can a list or export return everything: no limit, no cursor, no rate limit?
- Which sensitive actions leave no audit entry?

## Infrastructure attacker (foothold in runtime or CI)

- Are secrets passed as build arguments, baked into images, or printed in logs?
- Do containers run privileged, mount the host, or reach services they do not need?
- Can a server-side fetch reach metadata or internal addresses?
- Are environment variables or health and debug endpoints exposed without authentication?
