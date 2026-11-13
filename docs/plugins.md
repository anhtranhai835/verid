# Workflow plugins

Developer commands, run in your own terminal at the project root:

```sh
verid plugin add file:../verid/examples/plugins/sample
verid plugin add git:https://example.org/team/plugin.git#v1.0.0
verid plugin list
verid plugin doctor
verid plugin remove sample
```

Use `node .verid/verid.mjs` instead of `verid` with repo resources. Installation previews
all setup and event commands and asks for an explicit yes. `--yes` accepts them without
asking. There is no npm source, registry, automatic update or plugin run command.

A plugin is executable code with your permissions. Review its source before installing.
Commands execute directly, without a shell; quotes group arguments, while shell operators,
variable expansion and pipelines have no special meaning. On Windows use an executable
such as `node` or a `.exe`, rather than `.cmd`/`.ps1` shims. Each command is limited to
300 seconds. Prerequisite probes use `--version` and a 10 second limit.

## Package contract

Each package has a `verid-plugin.json` at its root:

```json
{
  "name": "sample",
  "version": "1.0.0",
  "veridApi": "1",
  "description": "Record workflow events",
  "requires": [{ "bin": "node", "version": ">=22.0.0", "install": "Install Node.js 22+" }],
  "setup": [],
  "hooks": {
    "after-order": "node hook.mjs",
    "on-state": "node hook.mjs",
    "after-serve": "node hook.mjs"
  },
  "skills": [],
  "agents": [],
  "config": {}
}
```

Names use kebab-case; reserved device names and the `verid` namespace are rejected.
Versions use `major.minor.patch`, optionally with prerelease/build metadata.
Requirement versions accept exact versions or a single `=`, `>`, `>=`, `<`, `<=`, `^`, `~`
comparison against `major.minor.patch`. `install` is advice; verid never runs it.

Setup runs once per installation in the **project root** and must be idempotent, since
another machine or a restored install runs it again. Event hooks run in the **plugin
directory**. Both receive `VERID_PROJECT`, `VERID_PLUGIN_DIR`, `VERID_PLUGIN_DATA` and
`VERID_PLUGIN_CONFIG` (JSON). Setup can use a small inline Node command to locate a
script via `process.env.VERID_PLUGIN_DIR`; shell variable substitution is unavailable.
Setup must not change the approved plugin package. A failed install is never registered;
external side effects of setup cannot be rolled back.

`skills` lists directories containing `SKILL.md`; `agents` lists Markdown definitions
with frontmatter. Relative paths must stay inside the package; links are rejected.
Resources are copied under `.verid/skills/` and `.verid/agents/` with the prefix
`<plugin>-`. Claude receives native skill/agent copies; Codex receives
local `.agents/skills/` entries. Markdown agents remain available as project resources;
their native dispatch depends on the host. Existing files belonging to other resources
are never overwritten. Registered enabled resources are automatically included in the
dispatch lists. Installing an agent does not assign any role: the developer must edit
`roles` in `.verid/manifest.yaml` to grant one. All existing role and TDD gates still apply.

## Events

JSON arrives through stdin; `VERID_PLUGIN_EVENT` also names the event.

| Event         | When emitted                               | Payload fields                                  |
| ------------- | ------------------------------------------ | ----------------------------------------------- |
| `after-order` | A CLI module order has been persisted      | `event`, `module`, `acs`, `dossier`             |
| `on-state`    | Valid taste evidence changes the TDD state | `event`, `module` (or null), `from`, `to`       |
| `after-serve` | A CLI module serve has been persisted      | `event`, `module`, `commit` (or null), `review` |

Order/serve include board actions that call the same CLI handlers. Signing an entire
no-brain plan does not order a named module; automatic module decisions inside provider
hooks do not execute plugins. Unchanged/invalid taste runs emit no state event.
Plugin stdout must be empty or one JSON object; its contents do not affect verid decisions.
A failed command, timeout, invalid JSON or changed package produces a one-line warning
and an audit entry. Approval, TDD evidence and served results remain recorded.
The [sample](../examples/plugins/sample) appends each received payload to
`.verid/.plugin-data/sample/events.jsonl`.

## Sharing and maintenance

Commit `.verid/plugins.json` (source, version, enabled flag, config, resource ownership,
package digest and Git commit SHA), generated resource copies and `.verid/.plugin-data/`.
The installed code in `.verid/.plugins/` is ignored. Installing the first plugin adds
this ignore entry; cook maintains it when the registry exists.

After cloning, run `verid cook --yes`. Missing packages are restored from the registry,
including their original config and exact approved digest. Git sources are checked out
at the recorded SHA even if the named ref has moved; without `--yes`, Git restoration
asks for confirmation. File sources resolve relative to the project root, so use a
shared relative source path when possible. An unavailable source or changed local
package needs developer attention; restore refuses to execute the changed version.
`cook --dry-run` does not fetch or execute plugin code.

Edit `enabled` or `config` in the registry as the developer. Disabled plugins do not
receive events or contribute dispatch names. `plugin doctor` reports missing code,
prerequisites, resource copies, version drift and integrity errors; `verid doctor`
includes these checks. `doctor --ci` validates the committed registry without probing
machine-local installations. Remove deletes the package and its recorded resource
files, retaining shared data. To install a new version, remove and add it explicitly.

Agents cannot write the registry, downloaded code, plugin data or generated definitions,
or invoke any plugin command. `VERID_BURNT_PLUGIN_PROTECTED` cannot be overridden with
`/verid tip`. These hook checks do not sandbox a plugin you chose to trust: its arbitrary
code has the same operating-system permissions as you.
