---
name: verid-router
description: Use when a verid task touches a specific domain (UI/UX, React, Frontend, Backend, Databases, DevOps, Mobile, Web-Testing, Edge-Cases, Security-Scan, Docs-Seeker) to load only the needed reference file.
---

# verid-router (On-Demand Domain Library)

To save ~4,000 characters of system prompt overhead per turn, verid's 17 domain and specialist packs are kept behind this single router instead of registering 25 separate top-level skills.

## How to Resolve Domain Paths

Locate the skills root `<SKILLS_ROOT>`:

- If `.verid/skills/` exists in the workspace (`resources: repo`), use `.verid/skills`.
- Otherwise use `resources/skills` inside the installed `verid` plugin (`~/.gemini/config/plugins/verid/resources/skills`) or `plugin/skills` in the `aeriq` repo.

## Domain Lookup Table (Read ONLY the matching branch)

| Symptom / Domain Task                                  | Target Skill / Script to Read or Run                                                                                                              |
| :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Input/state/timing/permission boundary tests**       | Read `<SKILLS_ROOT>/edge-cases/SKILL.md` before writing AC tests.                                                                                 |
| **UI/UX design, layout, palettes, typography, states** | Run `python <SKILLS_ROOT>/ui-ux-pro-max/scripts/search.py "<query>" --domain <style\|color\|typography\|chart\|ux>` instead of reading full docs. |
| **React / Next.js performance or rendering**           | Read `<SKILLS_ROOT>/react-best-practices/SKILL.md`, then open only the matching `<SKILLS_ROOT>/react-best-practices/rules/<rule>.md` file.        |
| **Frontend components / TypeScript UI**                | Read `<SKILLS_ROOT>/frontend-development/SKILL.md` -> matching file in `references/`.                                                             |
| **Backend APIs, auth, services, resilience**           | Read `<SKILLS_ROOT>/backend-development/SKILL.md` -> matching file in `references/`.                                                              |
| **SQL/NoSQL schemas, indexes, migrations, queries**    | Read `<SKILLS_ROOT>/databases/SKILL.md` -> matching file in `references/`.                                                                        |
| **Playwright, e2e, accessibility, load testing**       | Read `<SKILLS_ROOT>/web-testing/SKILL.md` -> matching file in `references/`.                                                                      |
| **CI/CD, Docker, Cloudflare, deployment**              | Read `<SKILLS_ROOT>/devops/SKILL.md` -> matching file in `references/`.                                                                           |
| **iOS, Android, React Native, Flutter**                | Read `<SKILLS_ROOT>/mobile-development/SKILL.md` -> matching file in `references/`.                                                               |
| **MCP server or custom tool building**                 | Read `<SKILLS_ROOT>/mcp-builder/SKILL.md` -> matching file in `references/`.                                                                      |
| **Pre-review secret / dependency / risky-path scan**   | Read `<SKILLS_ROOT>/security-scan/SKILL.md` and save redacted evidence for `verid-security`.                                                      |
| **High-stakes architectural decision stress-test**     | Read `<SKILLS_ROOT>/predict/SKILL.md` (4-persona analysis: Architect, Security, Performance, UX).                                                 |
| **Repeatedly stuck implementation / circular fixes**   | Read `<SKILLS_ROOT>/problem-solving/SKILL.md` -> `references/when-stuck.md`.                                                                      |
| **DOCX / PDF / large spec extraction**                 | Read `<SKILLS_ROOT>/context-engineering/references/document-reading.md` and run `scripts/document_reader.py`.                                     |
| **Missing external library/API documentation**         | Read `<SKILLS_ROOT>/docs-seeker/SKILL.md` or use Antigravity's `search_web`.                                                                      |
