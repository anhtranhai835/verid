---
name: onboard
description: Use when a developer is new to a verid project or asks whether their workspace is set up and where the project stands.
---

# verid: onboard

Read and report. This skill writes nothing: only the developer edits
`.verid/manifest.yaml`, and nobody here clones, pulls, stashes, switches branches or
commits. Never write code.

## 1. Repos

Read `.verid/manifest.yaml` with Read. For each entry in `repos`:

1. Read the build files that exist: `package.json` and its lock file, `go.mod`,
   `pom.xml`, `build.gradle(.kts)`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`,
   `*.csproj`, `composer.json`, `Gemfile`.
2. Work out the stack, the test command (`test_cmd`), where source, unit tests and
   end-to-end tests live (`source_globs`, `test_globs`, `e2e_globs`) and the role
   (`frontend`, `backend`, `e2e`, `other`). Leave a value empty when unsure.
3. Show one table: repo, stack, `test_cmd`, globs, role, with each value that differs
   from the manifest marked. Globs that miss real source or tests are the most common
   cause of needless denials; say so when you see one.
4. Ask whether the developer wants the changes. If they do, give them the exact YAML
   lines to put in `.verid/manifest.yaml` themselves, then `verid doctor` to check.

In a monorepo with packages (`workspaces`, `pnpm-workspace.yaml`, `go.work`, Maven
modules, `apps/*`, `packages/*`, `services/*`), propose one entry per package the same way.

## 2. Health

Run `verid doctor` and `verid menu`. Report, one line each: Node, hooks and
instruction blocks, runners, role agents, each repo's branch and uncommitted changes,
and every audit warning. For each problem say who fixes it and how; fix nothing.

## 3. Briefing

Read what exists of `.verid/research.md`, `.verid/spec.md`, `.verid/design.md`,
`.verid/plan.md` and, for the open module, the last entry of `.verid/log/<module>.md`.
Write at most 15 lines:

- what the project is, in one or two sentences;
- mode, drive and, with iterations, the current one;
- each module with its phase, and what the open one is waiting for;
- the next step exactly as `verid menu` gives it.

With no `.verid/research.md` yet, say only: "Nothing researched yet: start with
verid:ba, and put any documents you already have in `.verid/docs/`."

## Output

```markdown
## Workspace

| Repo | Stack | Role | Branch | Status |
| :--- | :---- | :--- | :----- | :----- |

## Project

<briefing>

## Next step

<one line>
```

Ask one question at a time. State uncertainty instead of guessing a value.
