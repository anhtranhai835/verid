# slugify: a sample project for verid

A small TypeScript library with vitest and one unwritten function, `slugify` in `src/slugify.ts`.
Build it with verid to see the whole workflow once: a module goes RAW, COOKING, PLATED, then is
served. Suggested acceptance criteria: a plain title, a title with accents, an empty string.

Copy this folder out of the verid repository first, so verid sets up the copy and not the repository:

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

**4. Say "what's next?"** in Claude Code at the project root, then ask for the slugify module.
The agent works through `ba`, `design` and `plan` and writes the module into `.verid/plan.md`.
_To confirm in the walkthrough._

**5. Approve the module** once its acceptance criteria are right.

```sh
verid order slugify
```

_To confirm in the walkthrough._

**6. Serve it** after the agent has built each criterion and the review has passed.

```sh
verid serve slugify
```

`Module slugify is served: every one of its acceptance criteria has a passing test, and the developer accepted it.`
_To confirm in the walkthrough._
