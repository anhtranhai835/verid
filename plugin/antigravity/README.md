# verid plugin for Google Antigravity (`plugin/antigravity`)

Registers verid's hooks, skills and read-only subagents in Antigravity. The rules themselves run
in verid's core (`src/adapters/antigravity.ts`), the same code Claude Code and Codex use: this
plugin holds no copy of them. Details (Vietnamese): [docs/antigravity-integration.vi.md](../../docs/antigravity-integration.vi.md).

## Layout

```text
plugin/antigravity/
├── plugin.json                  # Antigravity plugin manifest
├── hooks.json                   # SessionStart, PreInvocation, PreToolUse, PostToolUse, Stop
├── hooks/antigravity-hook.mjs   # Finds verid's runtime and runs it in this same process
├── rules/AGENTS.md              # Short always-on rule, only for workspaces with .verid/
├── agents/                      # verid-reviewer, verid-security, verid-debugger (read_file only)
├── skills/                      # verid-onboard, -ba, -design, -plan, -build, -debugging, -review, -release, -router
├── presets/                     # Valid example manifests: lite (remix), standard, strict
└── workspace-template/.agents/  # Optional workspace skills.json / plugins.json
```

## Install

In your own terminal, once per machine and again after each verid update:

```sh
verid setup-antigravity
```

It copies this folder, verid's bundle (`dist/`), messages (`i18n/`) and the shared skills,
agents and templates (`plugin/`) into `~/.gemini/config/plugins/verid/`. Restart Antigravity.

## Use in a project

```sh
verid cook --provider antigravity --mode prep --yes
verid doctor
```

- The main agent writes tests and code under the TDD gate (`RAW -> COOKING -> PLATED`); reviews
  run in a fresh `verid-reviewer` (and `verid-security`) subagent through `invoke_subagent`.
- Type `/verid peek` or `/verid menu` in the chat for status without a model call, and
  `/verid tip <reason>` then `/verid confirm <code>` for an exception.
- Outside a project with `.verid/`, every hook lets the call through untouched.
