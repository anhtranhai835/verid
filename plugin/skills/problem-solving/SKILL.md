---
name: problem-solving
description: Use when a verid task is stuck because of growing complexity, repeated failed approaches, hidden assumptions, or uncertain scale.
---

# verid:problem-solving

Use one focused technique to make a blocked task tractable. This is a thinking aid; it does not change the approved module, ACs, roles, TDD cycle, or evidence rules. If a proposed solution changes requirements or scope, take it back to the developer before implementing it.

| Symptom                                   | Technique                | Read                                     |
| ----------------------------------------- | ------------------------ | ---------------------------------------- |
| Special cases keep multiplying            | Simplification cascades  | `references/simplification-cascades.md`  |
| Familiar solutions are exhausted          | Collision-zone thinking  | `references/collision-zone-thinking.md`  |
| The same problem recurs in several places | Meta-pattern recognition | `references/meta-pattern-recognition.md` |
| One approach seems mandatory              | Inversion exercise       | `references/inversion-exercise.md`       |
| Production limits are uncertain           | Scale game               | `references/scale-game.md`               |
| The cause of being stuck is unclear       | When stuck               | `references/when-stuck.md`               |

1. State the concrete obstacle and the evidence already collected. For a bug, first follow `verid:debugging` to find its cause.
2. Pick the closest symptom, read only its reference, and apply the exercise to the actual code or design.
3. Compare the resulting options against the current AC and `.verid/design.md`. Choose the smallest option that satisfies them.
4. If no option is supported, report the missing evidence or decision. Never present a thought exercise as a passing test or an approved design change.

The copied techniques and their original source are recorded in `references/attribution.md` and `LICENSE`.
