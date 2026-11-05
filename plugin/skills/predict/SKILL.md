---
name: predict
description: Use before a major or risky verid design change to examine architecture, security, performance, user experience, and hidden assumptions.
---

# verid:predict

Use this optional review before committing to a major design or a risky change. It helps the developer decide; it is not a verid approval or a substitute for `verid:review`, `verid:security`, or `verid taste`. Skip it for small changes or a design already approved with no open question.

Read the proposal, the relevant `.verid/research.md`, `.verid/spec.md`, `.verid/design.md`, and affected code. Treat each perspective independently before combining them:

| Perspective      | Question                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Architect        | Does the change fit existing boundaries and interfaces?          |
| Security         | What trust boundary or data exposure changes?                    |
| Performance      | What happens to latency, memory, queries, and scale?             |
| UX               | What happens in normal, error, and accessible flows?             |
| Devil's advocate | Which assumption could be false, and what simpler option exists? |

List agreements and genuine conflicts. For each risk, name the evidence, impact, and a concrete mitigation. Separate confirmed defects from hypotheses. Finish with **GO**, **CAUTION**, or **STOP** and the smallest next action. A STOP means a critical assumption or risk remains unresolved; take it to the developer or gather evidence. Do not silently change signed requirements, ACs, or module scope.

This is an adaptation of ClaudeKit Predict 1.0.0. Its source and lineage are recorded in `LICENSE`.
