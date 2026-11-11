# Reheat mode: rewrite a legacy system

[Back to README](../README.md)

Mode `reheat` rebuilds an old system as the modules of a plan. The old system is **read-only** and
is the standard of correct behaviour. Work is split into units (a screen, a job, a report), and each
unit is one module. An **adapter**, a developer-installed [plugin](plugins.md), reads the old format.
The usual gates stay: spec, order, failing test, taste, review. Closing a unit adds one more: a
**parity record** that the developer signs.

## Set up

```sh
verid cook --mode reheat --legacy legacy
```

`--legacy` names the old system's folder, relative to the project. In a terminal, cook asks for it when
the flag is missing. The new system goes in `app/`; edit the repos in the manifest to move it. Cook
writes:

```yaml
mode: "reheat"
repos:
  - path: "app"
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
  - path: "legacy"
    role: "legacy"
    read_only: true
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
```

A repo with `role: legacy` must say `read_only: true`, and only mode reheat accepts the role. The old
and the new folder must be separate. Then install an adapter (`verid plugin add file:<folder>`); the
[sample](../examples/adapters/sample/README.md) is the shortest one. `no-brain` drive works in this mode;
parallel stations do not.

## What the legacy repo never gets

`VERID_BURNT_LEGACY_READ_ONLY` refuses, for every agent, a write into the legacy folder: Edit, Write,
`apply_patch`, MCP file tools, shell redirects, `sed -i`, `rm`, and `git` commands that change a
repository (`commit`, `add`, `checkout`, `reset`, ...), including `git -C legacy ...`, `cd legacy && ...`
and a working directory inside it. Reading, and Git commands that only look (`status`, `diff`, `log`,
`show`), stay allowed. A `/verid tip` does not lift it. `verid taste` and architecture checks skip the
legacy repo, because a test run can delete or create files.

Shell checks read text, so a script, a variable or an alias can hide a write. For a real guarantee
give the folder a read-only checkout or a clone without push rights.

## The steps

| Step      | Command                       | What happens                                                                                             |
| --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Inventory | `verid reheat inventory`      | The adapter lists the units. Each new one becomes a draft module in `.verid/plan.md` with a dossier.     |
| Extract   | `verid reheat extract <unit>` | The adapter writes the unit's legacy material to `spec/legacy/` of its dossier. verid records the files. |
| Spec      | the adapter's skill           | The agent writes the unit's spec and documents from `spec/legacy/`, citing it.                           |
| Gate      | `verid reheat gate <unit>`    | The adapter judges the spec. A pass counts only for the files it judged.                                 |
| Order     | `verid order <unit>`          | Refused (`VERID_BURNT_REHEAT_GATE`) until the gate passed on the current files.                          |
| Build     | the usual cycle               | Failing test, code, `verid taste`, review.                                                               |
| Parity    | `release/parity.md`           | Inputs, legacy results and new results, filled in with real cases.                                       |
| Serve     | `verid serve <unit>`          | Asks the developer to sign the parity record, or takes `--parity-signed`.                                |

`verid reheat` commands are not developer-only: the adapter is code you approved, like a test runner.
Signing parity is: an agent shell cannot run `verid serve`, and the board refuses agents.

**Exit codes of `reheat gate`:** 0 passed and parity signed, 1 the gate failed or the adapter failed, 3
passed but parity is not signed yet. A failing gate on an ordered, unserved unit cancels its order, as a
change to its documents would. An adapter that fails (non-zero exit, output of the wrong shape, no answer
within 300 seconds) changes no state; set `VERID_ADAPTER_TIMEOUT_MS` to change the limit.

Inventory keeps the plan: a unit the plan already has is left as written, and running it again adds only
new units. Each new unit gets `Artifacts:` and placeholder dossier documents, so the plan stays readable
while the rest wait.

## Parity

`release/parity.md` needs three filled sections: `## Inputs`, `## Legacy results` and `## New results`.
Leaving a `[NEEDS CLARIFICATION` marker counts as empty. The signature is the sha256 of the file: any edit
voids it, and so does a change to the unit's spec or to `spec/legacy/` for the gate.

- **big-brain:** `verid serve <unit>` asks `Sign the parity record?` in your terminal. The answer binds
  to the version you were shown. In a script, add `--parity-signed`. The board's Serve button appears only
  after the unit is signed.
- **no-brain:** the drive does not open a unit whose gate has not passed, and does not serve one without a
  signature. Sign on the board (a **Sign parity** button on the unit's card) or run
  `verid serve <unit> --parity-signed` in your terminal; the drive then serves the unit itself.

`verid menu` and the board show each unit's extract, gate and parity state, with its family and parent.

## The adapter contract

An adapter is a plugin whose `verid-plugin.json` has an `adapter` block next to the usual fields:

```json
{
  "adapter": {
    "unitKind": "screen",
    "commands": {
      "inventory": "node adapter.mjs inventory \"{legacyRoot}\"",
      "extract": "node adapter.mjs extract \"{legacyRoot}\" {unit} \"{unitDir}\"",
      "gate": "node adapter.mjs gate \"{legacyRoot}\" {unit} \"{specPath}\""
    },
    "skill": "spec"
  }
}
```

Commands run in the plugin folder with the plugin's environment, no shell, 300 seconds at most. Quotes
group arguments, then `{legacyRoot}`, `{unit}`, `{unitDir}` (the unit's dossier) and `{specPath}`
(`spec/spec.md` in it) are filled in, so a path with spaces stays one argument. `skill` names, without the
`<plugin>-` prefix, a skill of the package that writes a unit's spec. Each command prints one JSON document
on stdout, 64 KiB at most:

| Command     | Prints                                                            | verid checks                                               |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `inventory` | `{"units": [{"id", "title", "parent"?, "family"?}]}`              | kebab-case ids, no repeats, at most 2000                   |
| `extract`   | `{"unit", "files": ["screen.json"]}`                              | each file exists below the unit's `spec/legacy/`, no links |
| `gate`      | `{"unit", "pass", "findings": [{"severity", "rule", "message"}]}` | the unit is the one asked about                            |

`extract` writes the files itself, below `{unitDir}/spec/legacy/`, and names every one of them relative to
that folder: a file left there that it did not name makes the gate refuse until `extract` runs again.
Exactly one enabled plugin may declare an adapter. The adapter is trusted code, not a sandbox.

## Errors

| Code                           | When                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `VERID_BURNT_LEGACY_READ_ONLY` | A write into the legacy repo. Never overridable.                             |
| `VERID_BURNT_ADAPTER`          | No adapter, a failed command, a timeout, or a document of the wrong shape.   |
| `VERID_BURNT_REHEAT_GATE`      | `order` or `serve` of a unit whose gate has not passed on its current files. |
| `VERID_BURNT_PARITY`           | `serve` of a unit whose parity record is incomplete or unsigned.             |

`verid doctor` reports a legacy repo without `read_only: true` and a reheat project with no adapter.
