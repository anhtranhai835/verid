import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseManifest, renderManifest } from "../../src/core/manifest.js";
import { runnerKey } from "../../src/core/runners.js";
import * as auto from "../../src/core/auto.js";

const repo = { path: "api", source_globs: ["src/**"], test_globs: ["tests/**"] };

describe("workspace manifest", () => {
  it("scopes remembered runners by repo and runner folder", () => {
    const rows = [
      { repo: ".", dir: ".", expected: "vitest@." },
      { repo: "api", dir: ".", expected: "vitest@api" },
      { repo: "web", dir: "ui", expected: "vitest@web/ui" },
      { repo: "apps\\web", dir: "ui", expected: "vitest@apps/web/ui" },
    ];
    for (const row of rows)
      expect(runnerKey({ name: "vitest", dir: row.dir }, row.repo)).toBe(row.expected);
  });

  it("keeps option-C git semantics separately for every signed repo", () => {
    const rows = [
      { views: { api: null, web: null }, signed: { api: false, web: false }, expected: null },
      {
        views: { api: { clean: true }, web: null },
        signed: { api: true, web: false },
        expected: true,
      },
      {
        views: { api: { clean: true }, web: null },
        signed: { api: true, web: true },
        expected: false,
      },
      {
        views: { api: { clean: true }, web: { clean: false } },
        signed: { api: true, web: true },
        expected: false,
      },
      { views: { api: { clean: true } }, signed: { api: true, web: true }, expected: false },
    ];
    for (const row of rows) expect(auto.gitCleanAcross(row.views, row.signed)).toBe(row.expected);
  });
  it("defaults old manifests to monorepo and accepts both layouts with repo metadata", () => {
    const rows = [
      { layout: undefined, expected: "monorepo" },
      { layout: "monorepo", expected: "monorepo" },
      { layout: "workspace", expected: "workspace" },
    ];
    for (const row of rows) {
      const result = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        ...(row.layout && { layout: row.layout }),
        repos: [
          { ...repo, remote: "../remotes/api.git", default_branch: "main", role: "backend" },
          { ...repo, path: "web", role: "frontend" },
          { ...repo, path: "checks", role: "e2e" },
          { ...repo, path: "tools", role: "other" },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.layout).toBe(row.expected);
        expect(result.manifest.repos[0]).toEqual({
          path: "api",
          source_globs: ["src/**"],
          test_globs: ["tests/**"],
          remote: "../remotes/api.git",
          default_branch: "main",
          role: "backend",
        });
      }
    }
  });

  it("rejects invalid metadata and ambiguous or escaping repo paths", () => {
    const rows = [
      { layout: "other", repos: [repo] },
      { layout: "workspace", repos: [] },
      { layout: "workspace", repos: [{ ...repo, role: "mobile" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "--upload-pack=bad" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "\\\\host\\share\\api.git" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "//host/share/api.git" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "file://host/share/api.git" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "FILE://localhost/share/api.git" }] },
      { layout: "workspace", repos: [{ ...repo, remote: "file:////host/share/api.git" }] },
      { layout: "workspace", repos: [{ ...repo, default_branch: "-bad" }] },
      { layout: "workspace", repos: [{ ...repo, path: "." }] },
      { layout: "workspace", repos: [{ ...repo, path: "../api" }] },
      { layout: "workspace", repos: [{ ...repo, path: "C:\\api" }] },
      { layout: "workspace", repos: [{ ...repo, path: "/api" }] },
      { layout: "workspace", repos: [{ ...repo, path: "\\\\host\\api" }] },
      { layout: "workspace", repos: [{ ...repo, path: ".VERID/inside" }] },
      { layout: "workspace", repos: [{ ...repo, path: ".claude" }] },
      { layout: "workspace", repos: [{ ...repo, path: "LONGFO~1" }] },
      { layout: "workspace", repos: [{ ...repo, path: "api." }] },
      { layout: "workspace", repos: [{ ...repo, path: "api " }] },
      { layout: "workspace", repos: [{ ...repo, path: "NUL" }] },
      { layout: "workspace", repos: [repo, { ...repo, path: "API" }] },
      { layout: "workspace", repos: [repo, { ...repo, path: "./api/" }] },
      { layout: "workspace", repos: [repo, { ...repo, path: "api\\nested" }] },
      { layout: "monorepo", repos: [{ ...repo, path: "." }, repo] },
    ];
    for (const row of rows) {
      expect(
        parseManifest({ schemaVersion: 1, mode: "prep", ...row }).ok,
        JSON.stringify(row),
      ).toBe(false);
    }
  });

  it("normalizes harmless repo path spellings before validation and resolution", () => {
    const rows = [
      { path: "./api", expected: "api" },
      { path: "api/", expected: "api" },
      { path: "apps//web", expected: "apps/web" },
      { path: ".\\apps\\\\web\\", expected: "apps/web" },
      { path: "./", expected: "." },
    ];
    for (const row of rows) {
      const result = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        repos: [{ ...repo, path: row.path }],
      });
      expect(result.ok, row.path).toBe(true);
      if (result.ok) expect(result.manifest.repos[0]?.path).toBe(row.expected);
    }
  });

  it("accepts local file URLs and the supported network remote forms", () => {
    const rows = [
      "file:///C:/repos/api.git",
      "../remotes/api.git",
      "https://example.com/team/api.git",
      "ssh://git@example.com/team/api.git",
      "git@example.com:team/api.git",
    ];
    for (const remote of rows)
      expect(
        parseManifest({ schemaVersion: 1, mode: "prep", repos: [{ ...repo, remote }] }).ok,
        remote,
      ).toBe(true);
  });

  it("renders every repo and its workspace metadata", () => {
    const text = renderManifest(
      "prep",
      [
        { ...repo, remote: "../remotes/api.git", default_branch: "main", role: "backend" },
        { ...repo, path: "web", role: "frontend" },
      ],
      undefined,
      "human",
      "workspace",
    );
    expect(parse(text)).toEqual({
      schemaVersion: 1,
      mode: "prep",
      providers: ["claude-code"],
      allowed_skills: [],
      allowed_agents: ["general-purpose"],
      layout: "workspace",
      repos: [
        {
          path: "api",
          source_globs: ["src/**"],
          test_globs: ["tests/**"],
          remote: "../remotes/api.git",
          default_branch: "main",
          role: "backend",
        },
        { path: "web", source_globs: ["src/**"], test_globs: ["tests/**"], role: "frontend" },
      ],
    });
  });
});
