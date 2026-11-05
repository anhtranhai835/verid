# Screens in `.verid/plan.md`

A module that changes what users see draws each changed screen before it is ordered,
so the developer approves the screen with the module. Take the screen list from
`## Screens` in `.verid/research.md`.

1. For each changed screen, draw 2–3 options as ASCII wireframes, about 40 columns
   wide: layout, every element and label, and where errors appear.
2. Ask the developer to pick one, one screen at a time: on Claude Code with
   AskUserQuestion, one option per wireframe with the wireframe as its preview; on
   Codex as numbered options.
3. Keep only the chosen option in the module, with its states, and one line for the
   options not chosen. Never invent a choice the developer did not make.

````markdown
## Module: signup

Visitors create an account through the identity application interface.

Screens:

Signup form (home page → "Create account")

```text
+--------------------------------------+
| Create your account                  |
|                                      |
| Email     [________________________] |
| Password  [________________________] |
|           (at least 12 characters)   |
|                                      |
|                 [ Create account ]   |
| Already a member? Sign in            |
+--------------------------------------+
```

Chosen: A, by the developer on 2026-11-05; B (two steps) and C (social first) rejected.
States: empty, invalid email under its field, email taken (REQ-2), submitting, done.

- AC-1: a visitor signs up with an email and password (REQ-1)
- AC-2 (e2e): signup from the home page reaches the dashboard (REQ-1)
````

- The wireframe fixes structure, elements, labels and states, not colours or exact
  spacing.
- An `(e2e)` AC that covers the screen checks the chosen wireframe's elements and
  labels.
- Changing the chosen wireframe of an ordered module is an AC change: add a
  `Changed <date>` line and have the developer order the module again.

```

```
