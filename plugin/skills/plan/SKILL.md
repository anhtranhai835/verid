---
name: plan
description: Use when a verid design is agreed and needs modules with testable acceptance criteria.
---

# verid: plan

Keep changes local and testable.

Use verid:ba to settle scope from research, spec and design in `.verid/`.
Read `.verid/manifest.yaml` with Read for the planner mapping and iterations.
Give a mapped planner file paths and design row names first for a proposal, then
for writing after the main conversation relays the developer's decisions.
Main drafts on Codex or without a planner. Document writers run one at a time.

Present boundaries before writing. Ask open questions one at a time with 2–3
options, tradeoffs and a recommendation. Map every requested behaviour to an AC;
each AC names one observable outcome a focused test can prove. More than seven
rules suggests splitting a coherent delivery slice. Each AC cites the spec IDs it
proves in parentheses at its end, e.g. `(REQ-1, SEC-2)`; every REQ, NFR and SEC ID needs
at least one AC, or a `Review Focus:` line saying why not. Keep each module tied to its
design table rows and public interfaces. Add `Review Focus:` for specified inputs
that no AC covers; clarify missing requirements instead of inventing behaviour.

## Format

For parallel modules, read `references/stations.md` for `Boundary:` ownership.

```markdown
# Plan

## Module: signup

Visitors create an account through the identity application interface.
Review Focus: input boundaries implied by the specification.

- AC-1: a visitor signs up with an email and password (REQ-1)
- AC-2 (e2e): signup from the home page reaches the dashboard (REQ-1)

## Module: profile

Depends: signup
Visitors who signed up edit their profile.

- AC-3: a member changes their display name (REQ-2)

## Module: product

- AC-9 (e2e): a visitor signs up, logs in and uses the product (REQ-1, NFR-1)
```

- Unique kebab-case module names; at least one AC each. AC codes are unique
  across the file; tests carry their codes, e.g. `AC-1 adds two numbers` or
  `AC_1_addsTwoNumbers` when names cannot contain dashes.
- `Depends: <module>, …` before a module's first AC names the modules it builds on;
  put them above it in the file. verid suggests ordering a module only once those are
  served, and warns (never blocks) about unknown or later names and an early order.
- A module that changes a screen users see gets a `Screens:` block with the chosen
  ASCII wireframe and its states, agreed with the developer before ordering; see
  `references/screens.md` in this skill's folder.
- `(e2e)` means a test drives the product from outside. verid accepts evidence
  from Playwright or paths matching the repo's `e2e_globs`.
- With manifest iterations, assign every module, including product, an
  `Iteration: <positive integer>` as the first nonempty line after its heading.
  The parser treats it as optional metadata there only; lowercase or later lines
  are ordinary text. Fit the duration or return the sizing question.
- Changing an AC of an ordered module adds a line under its ACs:
  `Changed <date> AC-n: <change>, because <reason>`. Keep earlier lines.
- Put `[NEEDS CLARIFICATION: <question>]` in its affected module. It prevents
  ordering; a marker before the first module makes the plan unreadable.
  Replace resolved markers with the answer and reason.
- `product` is last, with all ACs `(e2e)`, and can be ordered only after the other
  modules are served. When product is served last, the product is done.

In big-brain drive, ask the developer to read the module and run `verid order <module>`
from their terminal. One module is open; changing its signed section needs another
order because approval covers that section. Continue with verid:build.

In no-brain drive, read `references/auto-drive.md` in this skill's folder before writing the
plan.
