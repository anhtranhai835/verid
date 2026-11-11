import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { expect, it } from "vitest";
import { tempDirs } from "../support/project.js";
import { decide, type PolicyContext } from "../../src/core/policy.js";

const root = resolve(import.meta.dirname, "../..");
const project = tempDirs("verid-skill-scripts-");

it("runs the web-testing tools inside an ESM project and generates usable auth fixtures", async () => {
  const folder = project();
  writeFileSync(join(folder, "package.json"), '{"type":"module"}\n');
  const scripts = join(root, "plugin/skills/web-testing/scripts");
  const generated = spawnSync(
    process.execPath,
    [join(scripts, "init-playwright.js"), "--dir", folder],
    {
      encoding: "utf8",
    },
  );
  expect(generated.status, generated.stderr).toBe(0);
  const auth = join(folder, "tests/e2e/auth.spec.ts");
  const dependency = /from ['"]([^'"]+)['"]/.exec(readFileSync(auth, "utf8"))?.[1];
  expect(dependency).toBeDefined();
  expect(existsSync(resolve(folder, "tests/e2e", `${dependency}.ts`))).toBe(true);
  const fixture = readFileSync(join(folder, "tests/e2e/fixtures/auth.ts"), "utf8");
  let authenticate: (
    options: object,
    use: (page: { goto: (url: string) => string }) => Promise<void>,
  ) => Promise<void>;
  runInNewContext(transformSync(fixture, { loader: "ts", format: "cjs" }).code, {
    module: { exports: {} },
    process: { env: {} },
    URL,
    require: () => ({
      test: {
        extend: (fixtures: { authenticatedPage: typeof authenticate }) => {
          authenticate = fixtures.authenticatedPage;
        },
      },
    }),
  });
  let cookies: { domain: string }[] = [];
  await authenticate!(
    {
      baseURL: "https://app.example.test",
      request: {
        post: async () => ({ ok: () => true, json: async () => ({ token: "synthetic-token" }) }),
      },
      browser: {
        newContext: async (options: { baseURL?: string }) => ({
          addCookies: async (value: typeof cookies) => {
            cookies = value;
          },
          newPage: async () => ({ goto: (url: string) => new URL(url, options.baseURL).href }),
          close: async () => {},
        }),
      },
    },
    async (page) => {
      expect(page.goto("/dashboard")).toBe("https://app.example.test/dashboard");
    },
  );
  expect(cookies[0]?.domain).toBe("app.example.test");
  const report = join(folder, "results.json");
  writeFileSync(
    report,
    JSON.stringify({
      testResults: [{ name: "example", assertionResults: [{ status: "passed" }] }],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [join(scripts, "analyze-test-results.js"), "--vitest", report, "--output", "json"],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ total: 1, passed: 1, failed: 0 });
});

it("keeps security credential guides readable while protecting actual secrets", () => {
  const ctx: PolicyContext = {
    stateDir: "/project/.verid/.state",
    manifestPath: "/project/.verid/manifest.yaml",
    transcriptsDir: "/home/.claude/projects",
    distDir: "/verid/dist",
    planPath: "/project/.verid/plan.md",
    researchMissing: false,
    specMissing: false,
    designMissing: false,
  };
  for (const rel of [
    "security/references/credential-handling.md",
    "security-scan/references/redaction-patterns.md",
  ]) {
    expect(existsSync(join(root, "plugin/skills", rel))).toBe(true);
    const path = `/project/.verid/skills/${rel}`;
    expect(
      decide({ kind: "file", tool: "Read", access: "read", path, display: path }, ctx).kind,
    ).toBe("allow");
  }
  for (const path of ["/project/.env", "/project/credentials.json", "/project/private.key"])
    expect(
      decide({ kind: "file", tool: "Read", access: "read", path, display: path }, ctx).kind,
    ).toBe("deny");
});

const python = spawnSync("python", ["--version"], { encoding: "utf8", windowsHide: true });
it.skipIf(python.error || python.status !== 0)(
  "reads bounded document excerpts with source provenance",
  () => {
    const result = spawnSync(
      "python",
      [
        "-X",
        "utf8",
        "-B",
        "-m",
        "unittest",
        "discover",
        "-s",
        join(root, "plugin/skills/context-engineering/scripts/tests"),
        "-p",
        "test_document_reader.py",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain("Ran 8 tests");
  },
);
it.skipIf(python.error || python.status !== 0)(
  "runs the database backup and restore regression suite",
  () => {
    const folder = project();
    const result = spawnSync(
      "python",
      [
        "-X",
        "utf8",
        "-B",
        "-m",
        "unittest",
        "discover",
        "-s",
        join(root, "plugin/skills/databases/scripts/tests"),
        "-p",
        "test_db_backup_regressions.py",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, TEMP: folder, TMP: folder },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain("Ran 5 tests");
  },
);
