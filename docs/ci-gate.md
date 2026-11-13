# CI gate

verid's gates run on the developer's machine, through hooks; a pull request pushed from a
machine without them is checked by nothing. `verid doctor --ci` checks, in the project's CI, what
the repository alone holds: the manifest, the committed verid files, the instruction blocks, a
test runner per repo, the plan's dependency order and that every spec requirement is cited by an
AC. Any of these failing exits 1.

It does not replace the hooks. TDD evidence, approvals and review results live in
`.verid/.state/`, which is never committed, so CI cannot see them. It also skips what belongs to
one machine: hook wiring, installed plugins and agents, and Codex trust.

## GitHub Actions

For a project cooked with `--resources repo` (the CLI is committed at `.verid/verid.mjs`):

```yaml
name: verid
on: [push, pull_request]
jobs:
  verid:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: node .verid/verid.mjs doctor --ci
```

Replace `npm ci` and `npm test` with your project's own install and test commands. With
`--resources installed`, install verid in the job first and run `verid doctor --ci`.

## Output

One finding per line, without colour, in the project's language. A traceability finding names
its code, such as `! SPEC_UNCOVERED: REQ-9: no AC or Review Focus line in .verid/plan.md cites it`,
followed by the fix.
