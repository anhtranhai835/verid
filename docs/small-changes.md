# Small changes

In `prep` and `recipe` every change goes through a module (`order`, build, review, `serve`),
but the module's dossier can be short. Choose by the size of the work; the gates are the same on
every path.

| Path  | When                      | Developer runs                | Dossier                                                                                |
| ----- | ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| full  | A feature, or several ACs | `verid module <name>`         | Every input drafted from `.verid/templates/module/`                                    |
| quick | One small change, one AC  | `verid module <name> --quick` | The change and its requirement; the other inputs come as one `Not applicable` line     |
| fix   | A bug                     | `verid module <name> --fix`   | Symptom, how to reproduce, root cause (found with the debugging skill before any code) |

`verid order` refuses a quick or fix module with more than one AC, and a fix whose `## Root cause`
is empty; it names the command that makes it a full module. The fix's one AC is a test that
reproduces the bug: red before the fix, green after. Asserted by `unified-flow.e2e`: "the quick
path keeps every gate…" and "the fix path keeps every gate…".

The table below is what the hooks enforce in each mode and drive; each row names the test that
asserts it.

| Mode and drive             | Situation         | Developer runs                                                   | The agent may                                                                                              | Asserted by                                                                                                                                                  |
| -------------------------- | ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `remix`                    | Fix a line        | Nothing                                                          | Write a failing test, fix, run `verid taste`. No module is needed.                                         | `tdd.e2e`: "RAW: denies production code, allows tests and other files", "runs the whole loop together with verid taste"                                      |
| `remix`                    | Refactor only     | `verid garnish` after a green run                                | Change production code while PLATED.                                                                       | `tdd.e2e`: "lets only the developer declare a refactoring session, and only on a passing run"                                                                |
| `remix`                    | One blocked write | `/verid tip <reason>`, then `/verid confirm <code>`              | That exact write, once.                                                                                    | `tdd.e2e`: "lets the developer override the gate once, for that exact write"                                                                                 |
| `prep`/`recipe`, big-brain | No task selected  | `verid board`, then `verid order <module>`, then a fresh session | Nothing: code and tests are denied (`VERID_BURNT_TASK_SESSION`), and `/verid tip` cannot lift it.          | `rules-audit.e2e`: "keeps state, Git internals, MCP configuration and unapproved code protected"; `tdd.e2e`: "will not let /verid tip lift the task session" |
| `prep`/`recipe`, big-brain | Module ordered    | Nothing more                                                     | The normal cycle: failing test first, then code. Any file may change; the cycle does not map files to ACs. | `tdd.e2e`: "approves one module of a plan with modules, and opens production code"                                                                           |
| `prep`/`recipe`, no-brain  | No module open    | Sign with `verid order`                                          | Nothing in code (`VERID_BURNT_AUTO_NO_MODULE`) until the queue opens a module.                             | `auto.e2e`: "locks production code until a module is open, and code and tests while stuck"                                                                   |
| `prep`/`recipe`, no-brain  | One blocked write | `/verid tip <reason>`, then `/verid confirm <code>`              | That exact write, once.                                                                                    | `auto.e2e`: "lets the developer tip past an auto lock once"                                                                                                  |

After a module is served, its code is locked again. A fix to served work means editing that
module's section of `.verid/plan.md` and ordering it again.
