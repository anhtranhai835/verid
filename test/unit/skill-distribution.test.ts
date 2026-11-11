import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repoResources } from "../../src/adapters/repo-resources.js";
import { decideDispatch } from "../../src/core/dispatch.js";
import { renderInstructions } from "../../src/core/instructions.js";
import { defaultRoles, parseManifest, renderManifest } from "../../src/core/manifest.js";

const root = join(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8").replaceAll("\r\n", "\n");
const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };

describe("self-contained verid skills", () => {
  it("routes every distributed skill and agent through an existing workflow entry", () => {
    const routing = read("plugin/templates/skill-routing.md");
    const links = [
      ...routing.matchAll(/\]\((\.\.\/(skills|agents)\/([^/)]+)(?:\/SKILL\.md|\.md))\)/g),
    ];
    for (const [, path] of links)
      expect(existsSync(resolve(root, "plugin/templates", path!)), path).toBe(true);
    const skills = readdirSync(join(root, "plugin/skills")).filter((name) =>
      existsSync(join(root, "plugin/skills", name, "SKILL.md")),
    );
    const agents = readdirSync(join(root, "plugin/agents"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3));
    for (const [kind, names] of [
      ["skills", skills],
      ["agents", agents],
    ] as const)
      expect(
        [...new Set(links.filter((link) => link[2] === kind).map((link) => link[3]))].sort(),
        kind,
      ).toEqual([...names].sort());
    for (const provider of ["claude-code", "codex"] as const)
      for (const workflow of ["classic", "modular", "kanban"] as const)
        for (const resources of ["installed", "repo"] as const) {
          const parsed = parseManifest({
            schemaVersion: 1,
            mode: "prep",
            providers: [provider],
            workflow,
            resources,
            repos: [repo],
          });
          if (!parsed.ok) throw new Error(parsed.detail);
          const skillsRoot = resources === "repo" ? ".verid/skills" : "C:/installed/plugin/skills";
          const instructions = renderInstructions(parsed.manifest, provider, skillsRoot);
          expect(instructions).toContain(`${skillsRoot}/../templates/skill-routing.md`);
        }
  });

  it("reaches every distributed skill on Antigravity through a wrapper or the router", () => {
    const router = read("plugin/antigravity/skills/verid-router/SKILL.md");
    const wrapped = readdirSync(join(root, "plugin/antigravity/skills"));
    const routed = new Set([...router.matchAll(/<SKILLS_ROOT>\/([\w-]+)\//g)].map((m) => m[1]));
    for (const name of routed)
      expect(existsSync(join(root, "plugin/skills", name!, "SKILL.md")), name).toBe(true);
    const skills = readdirSync(join(root, "plugin/skills")).filter((name) =>
      existsSync(join(root, "plugin/skills", name, "SKILL.md")),
    );
    expect(
      skills.filter((name) => !routed.has(name) && !wrapped.includes(`verid-${name}`)),
    ).toEqual([]);
  });

  it("keeps skill script tests and coverage artifacts out of distributed resources", () => {
    const files = repoResources(mkdtempSync(join(tmpdir(), "verid-res-")), ["claude-code"]);
    const rels = files.map((f) => f.rel);
    expect(rels.filter((rel) => /\/scripts\/tests\/|\.coverage$|__pycache__/.test(rel))).toEqual(
      [],
    );
    expect(rels).toContain(".verid/skills/databases/scripts/db_migrate.py");
    expect(rels).toContain(".verid/templates/module/tests/test-plan.md");
  });

  it("distributes MIT provenance with each skill derived from superpowers", () => {
    const rows = ["tdd", "debugging", "design", "plan", "review"];
    for (const name of rows) {
      const license = read(`plugin/skills/${name}/LICENSE`);
      expect(license, name).toContain("https://github.com/obra/superpowers");
      expect(license, name).toContain("7.0.0");
      expect(license, name).toContain("MIT License");
      expect(license, name).toContain("Copyright (c) 2025 Jesse Vincent");
      expect(license, name).toContain("Permission is hereby granted, free of charge");
      expect(license, name).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    }
  });

  it("ships the complete pinned debugging techniques without upstream creation tooling", () => {
    // SHA-256 of the upstream 7.0.0 files; SKILL.md changes only its discovery name and the two
    // skill calls that would not resolve on a machine without superpowers.
    const rows = [
      ["SKILL.md", "51c6435d98c83c42c96ba7c35725a0b2c376cd487fb1a4e6bd0ddbe7e33ef202"],
      ["root-cause-tracing.md", "75b933b6a8c40bdb2031b10f21654395b56ec6ab6bc7b018c18d3fe57aeb7fb8"],
      ["defense-in-depth.md", "1e175fb86fc357e58c6aebf5441e481e1b7868b4380c0456b63a17eefbd18ba7"],
      [
        "condition-based-waiting.md",
        "e89fec8400d6cd50f43407cec9fab50976ba4d55d0ec2eb51c0bd68036b54c26",
      ],
      [
        "condition-based-waiting-example.ts",
        "40ae5ebe497fdf310200e43fe986552546d0a22837c0d39e855db1cfd33eb88e",
      ],
      ["find-polluter.sh", "dd7b8f13c4cc2a24b33ff87b18da9248f3e1c80a085c3316224f69ff0fa5c43c"],
    ];
    for (const [name, hash] of rows) {
      const text = read(`plugin/skills/debugging/${name}`).replaceAll("\r\n", "\n");
      const original =
        name === "SKILL.md"
          ? text
              .replace("name: debugging\n", "name: systematic-debugging\n")
              .replace("`verid:tdd` skill", "`superpowers:test-driven-development` skill")
              .replace(
                "Run `verid taste` before claiming success",
                "Use the `superpowers:verification-before-completion` skill before claiming success",
              )
          : text;
      expect(createHash("sha256").update(original).digest("hex"), name).toBe(hash);
    }
    expect(read("plugin/skills/debugging/SKILL.md")).not.toContain("superpowers:");
    for (const name of ["CREATION-LOG.md", "test-academic.md", "test-pressure-1.md"])
      expect(existsSync(join(root, "plugin/skills/debugging", name)), name).toBe(false);
  });

  it("keeps frequently loaded new skills within their agreed byte budgets", () => {
    const rows = [
      ["tdd", 3500],
      ["design", 1500],
      ["ba", 2100],
      ["plan", 3900],
      ["build", 2700],
    ] as const;
    for (const [name, limit] of rows)
      expect(Buffer.byteLength(read(`plugin/skills/${name}/SKILL.md`)), name).toBeLessThanOrEqual(
        limit,
      );
    expect(existsSync(join(root, "plugin/agents/researcher.md"))).toBe(false);
  });

  it("has BA read the developer's documents and write an EARS spec that plans trace", () => {
    const ba = read("plugin/skills/ba/SKILL.md");
    for (const text of [".verid/docs/", ".verid/spec.md", "references/spec.md"])
      expect(ba, text).toContain(text);
    const format = read("plugin/skills/ba/references/spec.md");
    for (const text of [
      "- REQ-1: When ",
      "- NFR-1: ",
      "- SEC-1: ",
      "## Abuse cases",
      "## Data classification",
      "## Out of scope",
      "(source: ",
      "[NEEDS CLARIFICATION: ",
    ])
      expect(format, text).toContain(text);
    const plan = read("plugin/skills/plan/SKILL.md");
    expect(plan).toContain(".verid/spec.md");
    expect(plan).toContain("- AC-1: a visitor signs up with an email and password (REQ-1)");
  });

  it("gives research and design one format each, with the module map the plan's Depends follow", () => {
    const rows = [
      {
        skill: "plugin/skills/ba/SKILL.md",
        pointer: "references/research.md",
        file: "plugin/skills/ba/references/research.md",
        headings: [
          "## Problem",
          "## Users",
          "## Goals and completion signals",
          "## Evidence",
          "## Scope",
          "## Constraints and assumptions",
          "## Risks",
          "## Screens",
          "## Suggested modules",
          "## Glossary",
          "## Decisions",
          "## Open questions",
          "## Clarifications",
        ],
      },
      {
        skill: "plugin/skills/design/SKILL.md",
        pointer: "references/design.md",
        file: "plugin/skills/design/references/design.md",
        headings: [
          "## Architecture decisions",
          "## Existing code",
          "## Boundaries",
          "## Module map",
          "## Data",
          "## Interfaces",
          "## Tradeoffs",
          "## Out of scope",
        ],
      },
    ];
    for (const { skill, pointer, file, headings } of rows) {
      expect(read(skill), skill).toContain(pointer);
      const lines = read(file).split(/\r?\n/);
      expect(
        lines.filter((line) => /^## /.test(line)),
        file,
      ).toEqual(headings);
    }
    const design = read("plugin/skills/design/references/design.md");
    expect(design).toContain("| Module | Responsibility | Interfaces | Depends | Repos | Size |");
    expect(design).toContain("```mermaid");
  });

  it("onboards read-only: proposes manifest values for the developer, checks health and briefs", () => {
    const text = read("plugin/skills/onboard/SKILL.md");
    expect(text).toMatch(/^---\nname: onboard\ndescription: /);
    for (const phrase of [
      "verid doctor",
      "verid menu",
      ".verid/manifest.yaml",
      "only the developer edits",
      ".verid/log/",
      "15 lines",
      "Never write code",
    ])
      expect(text, phrase).toContain(phrase);
  });

  it("draws changed screens as ASCII options, keeps the chosen one, and checks the result against it", () => {
    expect(read("plugin/skills/plan/SKILL.md")).toContain("references/screens.md");
    const format = read("plugin/skills/plan/references/screens.md");
    for (const text of ["Screens:", "```text", "Chosen: ", "States: ", "AskUserQuestion"])
      expect(format, text).toContain(text);
    for (const file of [
      "plugin/skills/build/SKILL.md",
      "plugin/agents/reviewer.md",
      "plugin/codex/verid-reviewer.toml",
    ])
      expect(read(file), file).toContain("chosen wireframe");
  });

  it("keeps drive- and layout-specific steps out of the always-read plan and build skills", () => {
    const rows = [
      ["plan", "references/auto-drive.md", "## Auto drive", "a third failed or missing verdict"],
      ["build", "references/modes.md", "In remix mode", "Characterize untested behaviour"],
    ] as const;
    for (const [name, pointer, gone, moved] of rows) {
      const skill = read(`plugin/skills/${name}/SKILL.md`);
      expect(skill, name).toContain(pointer);
      expect(skill, name).not.toContain(gone);
      expect(read(`plugin/skills/${name}/${pointer}`), name).toContain(moved);
    }
  });

  it("checks review findings before fixing them and logs what failed", () => {
    const build = read("plugin/skills/build/SKILL.md");
    expect(build).toContain("references/review-findings.md");
    expect(build).toContain("- Tried: ");
    expect(read("plugin/skills/review/SKILL.md")).toContain("references/review-findings.md");
    const findings = read("plugin/skills/build/references/review-findings.md");
    for (const text of ["failing test", "The developer decides", "verid menu --commits --file"])
      expect(findings, text).toContain(text);
    expect(read("plugin/antigravity/skills/verid-build/SKILL.md")).toContain("`Tried`");
  });

  it("keeps the rarely used edge-case modes out of the always-read skill", () => {
    const skill = read("plugin/skills/edge-cases/SKILL.md");
    expect(Buffer.byteLength(skill)).toBeLessThanOrEqual(5800);
    expect(skill).toContain("references/iterative-mode.md");
    expect(skill).toContain("| 12  | **Business Logic**");
    const iterative = read("plugin/skills/edge-cases/references/iterative-mode.md");
    for (const text of ["Saturation", "Composite Score", "saturation-loop.md"])
      expect(iterative, text).toContain(text);
  });

  it("states the board and drive rules once per context", () => {
    const sentence = "the developer arranges the priority queue";
    expect(read("plugin/templates/workflow.md")).toContain(sentence);
    for (const file of ["plugin/skills/modules/SKILL.md", "plugin/templates/skill-routing.md"])
      expect(read(file), file).not.toContain(sentence);
  });

  it("asks only what changes the build, asks why first, and proposes the rest", () => {
    const rows = [
      [
        "ba",
        [
          "Ask only when the answer changes what gets built",
          "as a proposal the developer can correct",
          "ask why",
        ],
      ],
      ["design", ["leaves nothing open", "short design", "2–3 approaches"]],
    ] as const;
    for (const [name, phrases] of rows) {
      const text = read(`plugin/skills/${name}/SKILL.md`);
      for (const phrase of phrases) expect(text, `${name}: ${phrase}`).toContain(phrase);
    }
  });

  it("audits external skill dispatch unless the developer explicitly adds it", () => {
    const rows = [
      { name: "verid:tdd", additions: [], want: "allow" },
      { name: "verid:ba", additions: [], want: "allow" },
      { name: "superpowers:test-driven-development", additions: [], want: "deny" },
      { name: "andrej-karpathy-skills:karpathy-guidelines", additions: [], want: "deny" },
      { name: "superpowers:brainstorming", additions: ["superpowers:*"], want: "allow" },
    ];
    for (const { name, additions, want } of rows)
      expect(
        decideDispatch(
          "Skill",
          { skill: name },
          { allowed_skills: additions, allowed_agents: [] },
          new Set(),
        ).kind,
        name,
      ).toBe(want);
  });

  it("indexes bundled workflow and ClaudeKit-derived skills at their installed paths for Codex", () => {
    const parsed = parseManifest({ schemaVersion: 1, mode: "prep", repos: [repo] });
    if (!parsed.ok) throw new Error(parsed.detail);
    const text = renderInstructions(parsed.manifest, "codex", "C:/installed/plugin/skills");
    for (const name of ["ba", "tdd", "debugging", "design", "plan", "build", "review", "onboard"])
      expect(text).toContain(`C:/installed/plugin/skills/${name}/SKILL.md`);
    expect(text).toContain("ClaudeKit skills:");
    expect(text).toContain("C:/installed/plugin/skills/");
    expect(text).not.toContain("superpowers:");
    expect(text).not.toContain("researcher");
  });

  it("ships optional ClaudeKit domain references behind verid workflow wrappers", () => {
    const names = [
      "backend-development",
      "frontend-development",
      "databases",
      "devops",
      "mobile-development",
      "web-testing",
      "react-best-practices",
      "mcp-builder",
      "context-engineering",
      "ui-ux-pro-max",
      "security-scan",
      "docs-seeker",
    ];
    for (const name of names) {
      const skill = read(`plugin/skills/${name}/SKILL.md`);
      expect(skill, name).toContain(`name: ${name}`);
      expect(skill, name).toContain("verid taste");
      expect(skill, name).toContain("claudekit-original.md");
      const original = read(`plugin/skills/${name}/claudekit-original.md`);
      expect(original, name).toContain(`name: verid:${name}\n`);
      expect(original, name).not.toMatch(/\bck:[a-z]/);
    }
  });

  it("resolves every bundled file the ClaudeKit topic indexes link to", () => {
    expect(read("plugin/skills/frontend-development/SKILL.md")).toContain("references/");
    const pattern =
      /(?:\]\(|`)(?:\.\/)?((?:references|reference|resources|scripts)\/[\w./-]+\.\w+|[\w-]+\.md)(?:\)|`)/g;
    for (const name of ["frontend-development", "databases", "web-testing"]) {
      const base = `plugin/skills/${name}`;
      const links = [...read(`${base}/claudekit-original.md`).matchAll(pattern)].map(
        (match) => match[1]!,
      );
      expect(links.length, name).toBeGreaterThan(0);
      for (const link of links)
        expect(existsSync(join(root, base, link)), `${name}: ${link}`).toBe(true);
    }
    const webIndex = read("plugin/skills/web-testing/claudekit-original.md");
    for (const guide of ["interactive-testing-patterns.md", "shadow-dom-testing.md"])
      expect(webIndex).toContain(`references/${guide}`);
  });

  it("offers ClaudeKit-derived read-only helper agents without changing role mappings", () => {
    const names = [
      "brainstormer",
      "technical-researcher",
      "code-simplifier",
      "docs-manager",
      "ui-ux-designer",
      "project-manager",
      "debugger",
    ];
    for (const name of names) {
      const agent = read(`plugin/agents/${name}.md`);
      expect(agent, name).toContain(`name: ${name}`);
      expect(agent, name).toContain("tools: Read, Glob, Grep");
      expect(agent, name).not.toMatch(/tools:.*\b(?:Write|Edit|Bash)\b/);
      expect(agent, name).toContain("verid");
      expect(
        decideDispatch("Agent", { subagent_type: `verid:${name}` }, null, new Set()).kind,
        name,
      ).toBe("allow");
    }
  });

  it("bundles standalone ClaudeKit techniques without requiring the external kit", () => {
    const problem = read("plugin/skills/problem-solving/SKILL.md");
    const predict = read("plugin/skills/predict/SKILL.md");
    expect(problem).toMatch(/^---\nname: problem-solving\ndescription: /);
    expect(problem).toContain("references/when-stuck.md");
    expect(read("plugin/skills/problem-solving/references/when-stuck.md")).toContain("#");
    expect(predict).toMatch(/^---\nname: predict\ndescription: /);
    expect(predict).toContain("Architect");
    expect(predict).toContain("Security");
    expect(predict).toContain("Performance");
    expect(predict).toContain("UX");
    expect(predict).not.toContain("ck:");
    expect(read("plugin/skills/problem-solving/LICENSE")).toContain("ClaudeKit");
    expect(read("plugin/skills/predict/LICENSE")).toContain("ClaudeKit");
  });

  it("generates manifests with only mapped agents known by default and BA in the main thread", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      roles: defaultRoles(["claude-code"]),
      repos: [repo],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.roles).not.toHaveProperty("researcher");
    const yaml = renderManifest("prep", repo, parsed.manifest.roles);
    expect(yaml).toContain("allowed_agents: []");
    expect(yaml).not.toContain("superpowers:");
    expect(yaml).not.toContain("researcher:");
  });

  it("rejects the retired researcher mapping with a concrete repair", () => {
    const rows = [{ researcher: ["custom:research"] }, { researcher: [] }];
    for (const roles of rows) {
      const parsed = parseManifest({ schemaVersion: 1, mode: "prep", roles, repos: [repo] });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.detail).toContain("roles.researcher");
      expect(parsed.detail).toContain("remove");
      expect(parsed.detail).toContain("verid:ba");
      expect(parsed.detail).toContain("verid cook");
    }
  });

  it("never asks either provider to load an external skill from translated messages", () => {
    for (const lang of ["en", "vi"]) {
      const catalog: Record<string, string> = JSON.parse(read(`i18n/${lang}.json`));
      const external = Object.entries(catalog)
        .filter(([, value]) => /superpowers:|andrej-karpathy-skills:/.test(value))
        .map(([key]) => key);
      expect(external, lang).toEqual([]);
    }
  });
});
