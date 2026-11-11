# Install and set up

## Requirements

- Node.js **22 or later**, with npm on `PATH`.
- Git for repository and workspace operations.
- Claude Code, Codex CLI, or both.

## Installation

### Published package (optional global installation)

```sh
npm install -g @anhtranhai835/verid
```

The one-line installers install the published npm package and attempt provider setup.
They need Node.js already installed.

**Windows — PowerShell**

```powershell
irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh
```

In an interactive terminal, the installer can ask for a project folder and start
`verid cook`. In CI or without a terminal, run cook yourself afterward.

### Current source, including the new modular workflow

Use the source build when the published npm version does not yet include a feature
described in this README:

```sh
git clone https://github.com/anhtranhai835/verid.git
cd verid
npm ci
npm run build
```

Run the built CLI once from the target project, replacing the path with your checkout:

```sh
node /path/to/verid/dist/cli.js cook --mode prep --resources repo --provider codex --yes
```

After cook, the repo includes its own CLI and bundled dependencies. From the project root:

```sh
node .verid/verid.mjs module identity
node .verid/verid.mjs menu
node .verid/verid.mjs taste
```

No global verid install or separate verid `node_modules` is required for repo mode.
Node.js, your provider and the project's test runner remain prerequisites.
The optional global executable is `verid`; the npm package is `@anhtranhai835/verid`.

### Start with modular documents and repo resources

```sh
verid cook --mode prep --resources repo --provider codex --yes
node .verid/verid.mjs module identity
```

Fill the module drafts, then publish the agreed requirements, design and ACs in
`.verid/spec.md`, `.verid/design.md` and `.verid/plan.md`. Cook does not prefill
these approval inputs with placeholder content.

For Codex, trust the project and the generated hooks through `/hooks`, then run
`verid doctor`. See [Codex setup](#codex-setup).

## Codex setup

For a project with repo resources:

1. Run cook with `--provider codex --resources repo`.
2. Open Codex at the project or workspace root.
3. Trust the project and each generated verid hook through `/hooks`.
4. Run `verid doctor` and resolve setup findings.
5. Let main write tests/code; use `verid_reviewer` with `fork_turns: "none"` for review.

Cook adds a project `.codex/config.toml` whose reviewer points at
`../.verid/agents/verid-reviewer.toml`. That overlay reads repo skills and uses a
read-only sandbox. Repo mode does not write the Codex user's config.

For `resources: installed`, cook sets up the user reviewer and uses installed skill
paths. Trust remains a user action in either mode.

The repo hook has an integration test for Codex order, RED/GREEN, read-only review
and invalidation after a module spec change. An offline check with Codex CLI
`0.166.0` also confirmed that its model-visible input includes the project
instructions and repo skills. See the [validation notes](modular-cook.md#dùng-với-codex).

## Antigravity setup

1. Run `verid setup-antigravity` once per machine, and again after each verid update.
   It installs verid's plugin in `~/.gemini/config/plugins/verid/`. Restart Antigravity.
2. Run cook with `--provider antigravity` (add `--provider claude-code` for both).
3. Run `verid doctor` and resolve setup findings.
4. Let main write tests/code; dispatch `verid-reviewer` (and `verid-security`) with
   `invoke_subagent` for review. Type `/verid peek`, `/verid tip` and `/verid confirm`
   in the chat.

verid's core reads Antigravity's hook payloads itself, so the same rules, TDD gate and
review binding apply as on Claude Code and Codex. The payload shapes are not yet checked
against recorded Antigravity fixtures. See [the integration notes](antigravity-integration.vi.md).

## Upgrading

For repo resources, `node .verid/verid.mjs cook --yes` rewires the committed version
for the current machine. To change that pinned version, review and update the repo's
runtime and resource copies. An optional global installation can be upgraded with:

```sh
npm install -g @anhtranhai835/verid
verid upgrade --dry-run
verid upgrade --yes
verid doctor
```

For a source install, update the checkout, build it and reinstall it first.
Upgrade refreshes provider wiring and instructions and adds accepted missing
defaults. Existing repo resources and module documents are preserved. Refresh
pinned resources by reviewing their changes and replacing the intended copies.

## Upgrading from 1.x

This is version 2.0.0. Legacy manifests with `workflow: classic`, `workflow: modular`, `workflow: kanban` or no workflow still load; `--workflow` is a compatibility flag. `auto` remains an alias of drive `ai`.

Run `verid upgrade --dry-run`, then `verid upgrade --yes`. Upgrade removes the retired workflow, adds templates/artifact directories, and drafts dossiers and Artifacts references for unserved modules. Complete those inputs and order again; open human tasks require a fresh session. Served sections, approvals and evidence stay intact. Run `verid doctor` to find remaining gaps.

With repo resources, update the pinned runtime in `.verid/hooks/` and relevant resources after upgrading the package; upgrade preserves existing customizations. Before downgrading to 1.x, remove `kanban.queue` from state in the developer's terminal.
