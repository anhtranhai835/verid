# Cook reference

## Cook flags

```sh
verid cook --mode prep --resources repo --provider codex --lang en --yes
```

| Flag                                         | Values or effect                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--mode`                                     | `prep`, `recipe`, `remix` or `reheat`.                                               |
| `--resources`                                | `installed` or `repo`.                                                               |
| `--provider`                                 | `claude-code`, `codex` or `antigravity`; repeat for several.                         |
| `--drive`                                    | `big-brain` or `no-brain` for prep/recipe (`human`, `ai` and `auto` remain aliases). |
| `--architecture`                             | `ddd`, `clean`, `layered` or `none`.                                                 |
| `--layout`                                   | `monorepo` or `workspace`; otherwise detected.                                       |
| `--legacy`                                   | For `--mode reheat`: the legacy system's folder, which stays read-only.              |
| `--lang`                                     | `en` or `vi`; this machine's CLI language.                                           |
| `--test-cmd`                                 | Custom command containing `{junit}` or `VERID_JUNIT`.                                |
| `--src` / `--tests`                          | Repeatable source and test globs.                                                    |
| `--iterations`                               | Enable calendar planning; supply duration, start date and demo day below.            |
| `--duration` / `--start-date` / `--demo-day` | For example `"2 weeks"`, `2026-11-09`, `Sunday`.                                     |
| `--dry-run`                                  | Show the plan without writing.                                                       |
| `--yes`                                      | Accept suggested defaults and skip confirmation.                                     |

Interactive iteration planning uses 14 days and puts the demo on the last day.
Iteration metadata does not change AC order or TDD gates.

When a manifest exists, its configuration takes precedence over setup flags. The
developer edits it to change choices, then runs cook again. For a switch to repo
resources, also change Claude role names from `verid:<name>` to `verid-<name>`.
The Codex reviewer name stays `verid_reviewer`.

## Preview before writing

```sh
verid cook --mode prep --resources repo --provider codex --dry-run
```

The preview shows a file tree: `+` creates, `~` updates, `=` keeps, and `!` introduces
a note. Confirmation applies the checked plan. Existing instruction text outside
`<!-- verid:begin -->` and `<!-- verid:end -->` stays intact.

## Modes and drive

| Mode     | Starting point          | First work                                                                            |
| -------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `prep`   | An idea                 | Research, clarification, spec and design.                                             |
| `recipe` | Existing specifications | Validate the inputs, then design and plan.                                            |
| `remix`  | Existing code           | Record the baseline with `verid stock`.                                               |
| `reheat` | A legacy system         | Install an adapter, then `verid reheat inventory`. See [reheat mode](reheat-mode.md). |

`big-brain` leaves order and serve to the developer. `no-brain` starts when the developer
signs research, spec and design with `verid order`. It reviews the plan and works
module by module. Questions that block progress go into `.verid/blocked.md`; the
developer resolves them and resumes with `verid order`.
