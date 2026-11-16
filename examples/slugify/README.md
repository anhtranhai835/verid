# slugify: a sample project for verid

A TypeScript library with vitest and one unwritten function, `slugify`. Build it with verid to
see a module go RAW, COOKING, PLATED, then served. Suggested acceptance criteria: a plain title,
a title with accents, an empty string. Copy the folder out of the verid repository first:

```sh
cp -r examples/slugify ~/slugify
cd ~/slugify
git init -b main
```

Each step below shows the line of its output that tells you it worked. Lines marked _to confirm
in the walkthrough_ come from steps an agent drives and are not yet recorded from a real run.

**1. Install the dependencies.**

```sh
npm install
```

npm ends with `added <n> packages`.

**2. Set verid up.** Press Enter at each question, or pass `--yes` to take every default.

```sh
verid cook
```

``Test runner: verid finds it at each `taste`; it sees vitest now.`` then, last:
`Open Claude Code and say: what's next?`

**3. Check the setup.**

```sh
verid doctor
```

`No problems found.` If it reports `plugin.verid`, install verid's agents as the message says.

**4. Say "what's next?"** in Claude Code, then ask for the slugify module. The agent writes it
into `.verid/plan.md` through `ba`, `design` and `plan` (_to confirm in the walkthrough_).

**5. Approve the module** once its acceptance criteria are right.

```sh
verid order slugify
```

_To confirm in the walkthrough._

**6. Serve it** after the agent has built each criterion and the review has passed.

```sh
verid serve slugify
```

`Module slugify is served: every one of its acceptance criteria has a passing test, ...`
(_to confirm in the walkthrough_).
