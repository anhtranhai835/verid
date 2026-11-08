---
name: ui-ux-pro-max
description: Use for UI layout, design systems, accessibility, and interaction design.
---

# verid:ui-ux-pro-max

Choose the current UI question and query the bundled data without opening the full
catalog. From this skill directory, for example:

```text
python -B scripts/search.py "keyboard navigation" --domain ux --max-results 3
python -B scripts/search.py "dashboard" --domain product --max-results 3
python -B scripts/search.py "reduced motion" --domain web --max-results 3
```

Other domains: style, color, chart, landing, typography, icons, react, google-fonts.
The bundled stack data supports `--stack react-native`. `--design-system` is for a
complete design-system proposal; load it only when that is the task. Scripts can
be run by main or an authorized writer; read-only helpers request results from main.
Search previews may truncate fields: inspect the matching CSV row when details matter.
Keep `claudekit-original.md` as optional background, not an automatic first read.

Use the bundled data as design options, then check the chosen wireframe and user needs; avoid applying a style catalog blindly.

The original file is reference material. Follow the current project's approved ACs, design, roles, and protected files whenever its examples differ. For implementation, use `verid:tdd` and run `verid taste` after the last change. This skill does not approve a module, replace a review, or authorize an external action.
