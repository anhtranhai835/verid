# verid

Evidence-verified, hook-enforced TDD harness for [Claude Code](https://claude.com/claude-code).

> The agent does the work. verid verifies it. The developer approves.

verid works on two layers:

- **Enforcement layer:** a single fail-closed Claude Code hook backed by a pure policy engine. The rules live in code, not in the prompt.
- **Prompt layer (planned):** bilingual (vi/en) skills, agents and templates that drive the TDD loop and build on the [superpowers](https://github.com/obra/superpowers) skills.

## Status

**Phase 0 — walking skeleton.** Only the enforcement hook exists. There is no CLI yet (`verid init`, `verid test`, `verid done`… are planned), so setup is manual.

What the Phase 0 hook enforces:

| Rule                           | Overridable | Covers                                                                                                          |
| ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `VERID_E_STATE_PROTECTED`      | no          | Reading or writing `.verid/.state/**`                                                                           |
| `VERID_E_SECRET_PROTECTED`     | no          | Secret files: `.env*` (except templates), keys, certificates, `.ssh/**`, `.npmrc`, `*credentials*`, `*secret*`… |
| `VERID_E_TRANSCRIPT_PROTECTED` | no          | Claude Code transcripts in `~/.claude/projects/**`                                                              |
| `VERID_E_MANIFEST_PROTECTED`   | yes         | Writing `.verid/manifest.yaml`                                                                                  |
| `VERID_E_BASH_NESTED_CLAUDE`   | yes         | Bash starting a nested `claude` session                                                                         |

Every denial is counted in state and written to a hash-chained audit log. Any unexpected error on `PreToolUse` blocks the tool instead of letting it run.

A Claude Code hook is not an OS sandbox, and the Phase 0 Bash rules match strings, so they can be bypassed. See the known limitations in [docs/system-architecture.md](docs/system-architecture.md).

## Quick start

Requires Node.js 22 or newer.

```bash
npm install
npm run build        # bundles src/hook.ts into dist/hook.js
```

In the project you want to guard:

1. Create `.verid/.state/state.json` containing `{"schemaVersion":1}`.
2. Register `node <path-to-verid>/dist/hook.js` for `PreToolUse` (matcher `*`, with `"onFailure": "block"`), `UserPromptSubmit`, `Stop` and `SessionStart` in `.claude/settings.json`.

The full settings file and a step-by-step check are in [docs/manual-hook-checklist.md](docs/manual-hook-checklist.md).

### Overriding a blocked action

Only a developer typing in an interactive session can override, and only for overridable rules:

1. `/verid allow <reason>` shows you a risk warning with a one-time confirmation code. The agent never sees it.
2. `/verid confirm <code>` allows that exact blocked action once.

Overrides are rejected from subagents and `claude -p` sessions. See [ADR-0007](docs/adr/0007-two-step-override-attended-session.md).

## Development

```bash
npm test             # build, then unit and end-to-end tests
npm run typecheck
npm run format
```

The end-to-end tests spawn the real `dist/hook.js` against payloads recorded from Claude Code. Those payloads were recorded on Windows, so the end-to-end suite currently passes only there.

## Documentation

Design docs are written in Vietnamese:

- [System architecture](docs/system-architecture.md), including known limitations
- [Code standards](docs/code-standards.md)
- [Architecture decision records](docs/adr/)
- [Manual hook checklist](docs/manual-hook-checklist.md)

## Inspiration

verid stands on the shoulders of two projects:

- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — a skills library that pushes Claude Code through brainstorm, plan, test-driven development and review. verid's prompt layer is built on top of it; verid adds the hook that makes the TDD loop enforceable instead of advisory.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** (`karpathy-guidelines`) by forrestchang — guidelines derived from Andrej Karpathy's observations on LLM coding pitfalls: think before coding, simplicity first, surgical changes, goal-driven execution.

verid is an independent project and is not affiliated with either of them.

## License

[MIT](LICENSE) © 2026 Anh Tran
