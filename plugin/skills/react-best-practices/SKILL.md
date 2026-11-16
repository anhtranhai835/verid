---
name: react-best-practices
description: Use for React and Next.js performance reviews and implementation.
---

# verid:react-best-practices

Select matching files under `rules/`: async-* for waterfalls, bundle-* for bundle
size, server-* for server work, client-* for client fetching, rerender-* for React
updates, rendering-* for rendering, js-* for hot JavaScript paths and advanced-*
for specialized patterns. Use `rules/_sections.md` if the category is unclear.
Open only relevant rules and verify their assumptions against actual code.
`AGENTS.md` is the compiled full catalog; use it for a full audit only.
`claudekit-original.md` remains optional background.

Read only the relevant rules; measure the actual bottleneck before applying an optimization.

The original file is reference material. Follow the current project's approved ACs, design, roles, and protected files whenever its examples differ. For implementation, use `verid:tdd` and run `verid taste` after the last change. This skill does not approve a module, replace a review, or authorize an external action.
