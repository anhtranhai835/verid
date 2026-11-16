# Security policy

## Supported versions

Only the latest major version receives security fixes. Today that is 1.x.

## Reporting a vulnerability

The repository and its issues are public. Open an issue titled `Security: <short summary>`
without vulnerability details and ask the maintainer for a private reporting channel.
Share the details only through that channel.

In the private report, include the verid version, the provider (Claude Code or Codex), and the smallest
steps that reproduce the problem.

## In scope

- A hook gate that an agent can get past: writing source before a failing test, closing a
  module without review, editing protected files, or acting outside its role.
- Writes to `.verid/.state/` that do not go through verid's own commands.
- Secrets or private paths leaked through hook or CLI messages, the audit log, or review packets.

## Out of scope

- A developer who disables or uninstalls verid's hooks on their own machine.
- Bugs in Claude Code or Codex themselves; report those to their vendors.
