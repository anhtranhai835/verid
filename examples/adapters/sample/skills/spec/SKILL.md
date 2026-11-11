---
name: spec
description: Write one legacy screen's spec from its extracted screen.json, naming every behaviour.
---

# Screen spec

Read `.verid/artifacts/03-modules/<unit>/spec/legacy/screen.json`.

Write `spec/spec.md` in the same dossier with one line per behaviour of the screen, as
`Behaviour: <input> -> <result>`, so the gate can find each input. Fill the dossier's other
documents from the same file, citing it. Then run `verid reheat gate <unit>`.
