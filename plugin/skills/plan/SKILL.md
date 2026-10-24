---
name: plan
description: Step 3 of a verid project. Split the work in `.verid/plan.md` into modules with acceptance criteria, mark end-to-end ones `(e2e)`, end with the `product` module, and ask the developer to order the next module (in an auto drive, have the reviewer check the plan instead). Use once `.verid/design.md` exists.
---

# verid: the plan

Use andrej-karpathy-skills:karpathy-guidelines (Simplicity First) when proposing modules.

When the manifest has `iterations`, assign every module, including `product`, one `Iteration: <n>`
line as the first nonempty line under its heading, fitting the configured duration. If the work
does not fit, ask the developer through the proposal or blocked-note workflow before writing.

Break the work down with superpowers:writing-plans, but write the result in verid's format below,
in `.verid/plan.md`. verid reads this file: a module the parser rejects cannot be ordered. Dispatch
the mapped planner when `roles.planner` in `.verid/manifest.yaml` exists (read it with Read,
never Bash). Dispatch it first for a proposal, with the research, design, specification and
existing code. Present its module boundaries before any write; do not finalise them silently.
Relay the planner's open questions to the developer one at a time, with its 2–3 options,
trade-offs and recommendation. Then dispatch it again with the decisions and approval to write.
The main conversation writes nothing in `.verid/plan.md` when a planner is mapped. Without one,
write the plan in the main conversation using the same proposal and question workflow.

## Format

```markdown
# Plan

## Module: signup

Visitors create an account.

- AC-1: a visitor signs up with an email and a password
- AC-2: an email already in use is rejected with a message
- AC-3 (e2e): a visitor signs up from the home page and lands on the dashboard

## Module: product

The whole product, as a user meets it.

- AC-9 (e2e): a visitor signs up, logs in and adds two numbers
```

- Each module starts with `## Module: <name>`. Names are kebab-case and appear once.
- With manifest `iterations`, `Iteration: <positive integer>` is optional and belongs on the first
  nonempty line after the module heading. Lowercase `iteration:`, lines before the first module
  heading and every later line in a section are ignored as metadata.
  With iterations off, every `Iteration:` line is ordinary text.
- Each acceptance criterion is one line, `- AC-<n>: <behaviour>`, inside a module. Codes are unique
  across the whole file. Write the behaviour, not the code: each AC becomes a test whose name
  carries its code.
- Each module needs at least one AC. A module can add a short description and a test list.
- Mark an AC `(e2e)` when only an end-to-end test proves it: `- AC-3 (e2e): …`. verid counts it only
  from a passing end-to-end test: one the Playwright runner reports, or one in a path that matches
  `e2e_globs` in `.verid/manifest.yaml`.
- Where something is unclear, write `[NEEDS CLARIFICATION: <the question>]` and ask the developer,
  one question at a time, with 2–3 options, their trade-offs and your recommendation. A module that
  still holds a marker cannot be ordered, and a marker above the first module makes the whole plan
  unreadable. Once you agree, replace the marker with the answer and why.

## The `product` module

`## Module: product` is reserved for the last step: acceptance criteria for the product as a whole,
every one of them `(e2e)`. The developer can order it only once every other module is served
(`VERID_BURNT_PRODUCT_TOO_EARLY`). Once it is served, and no module is served after it, the product
is done.

## Ordering

One module is open at a time. When a module is ready, ask the developer to read its section and run
`verid order <module>` from their own terminal. Until then, production code stays locked. Changing
the open module's section after the order locks it again until the next order, so put questions
about the open module into its section before asking for the order, not after.

Build the open module with the `verid:build` skill. `verid menu` always says what comes next.

## Auto drive

When the first line of `verid menu` says `drive auto` (the session-start message says it too), verid
opens and serves the modules itself, in the order of the file, and the developer signs only the
research and the design. Do not read the manifest with Bash to find out: verid blocks it. Skip
"Ordering": `verid order <module>` is refused (`VERID_BURNT_AUTO_ORDER_MODULE`).

- Have the mapped planner draft the plan once the head line of `verid menu` says `signed`, or
  draft it yourself if unmapped. `product` is the last module in the
  file, with every AC `(e2e)`; verid does not take a plan that ends otherwise.
- Answer each `[NEEDS CLARIFICATION]` yourself: pick the option you would recommend and replace the
  marker with the answer and why. The exception is a question whose answer changes
  `.verid/design.md`, or that only the developer can answer. Then do not guess: write the question
  and the options, with their trade-offs, into `.verid/blocked.md` and stop. The drive waits for
  the developer, who answers and runs `verid order` to continue.
- In this signed auto workflow, resolve the planner's questions within the design yourself,
  record why, and dispatch the planner again with those decisions to write the plan. If its
  proposal changes the signed design or needs the developer, write `.verid/blocked.md` yourself
  and stop. The planner can write only `.verid/plan.md` and cannot record that block for you.
- When `verid menu` says to have the reviewer check the plan, dispatch `verid:reviewer` (or the mapped
  reviewer) with `.verid/plan.md` and `.verid/design.md`, and say that it is the plan it reviews, not
  a module. Its final report ends with `Verdict: pass` or `Verdict: fail`. On a fail, fix the plan
  from its findings and dispatch it again. The third fail leaves the drive stuck, and so does a
  report with no `Verdict:` line.
- Once the plan passes, the first module opens by itself: continue with the `verid:build` skill. An
  edit to the plan after that needs a new review, and an edit to a module already served leaves
  the drive stuck, so settle the plan before it passes.
