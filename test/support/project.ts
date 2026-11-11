import { createRunners } from "./runners.js";
import { FIXTURE_SESSION, readyModulePlan, startTaskSession, type Payload } from "./fixtures.js";
import { projectManifest } from "./manifest.js";
import type { TestProject, ProjectOptions } from "./types.js";
import { temporaryDirectories } from "./temporary.js";
export * from "./fixtures.js";
export * from "./manifest.js";
export type * from "./types.js";
export { tempDirs } from "./temporary.js";
import { parse as parseYaml, stringify } from "yaml";
import { readState, statePaths } from "../../src/adapters/state-store.js";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { defaultRoles } from "../../src/core/manifest.js";

/** Calls into in-process.ts share process state: keep a file's tests and calls sequential. */
export function tempProject(prefix: string, options: ProjectOptions = {}) {
  const roots: string[] = [];
  const directories = temporaryDirectories(prefix, options.cleanup);
  let root: string;
  let dir: string;
  let session = options.session ?? FIXTURE_SESSION;
  let sessionCount = 0;

  const project = {
    gitManifest: (
      extra = "",
      repos = '  - path: "."\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
    ): void =>
      project.put(
        ".verid/manifest.yaml",
        "schemaVersion: 1\nmode: prep\n" + extra + "repos:\n" + repos,
      ),
    contextSetup: (language = "en", extra: Payload = {}): void => {
      project.put(
        ".verid/manifest.yaml",
        stringify({
          schemaVersion: 1,
          mode: "prep",
          providers: ["claude-code"],
          roles: defaultRoles(["claude-code"]),
          repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
          ...extra,
        }),
      );
      project.put(".verid/.state/state.json", JSON.stringify({ schemaVersion: 1, language }));
    },

    get root() {
      return root;
    },
    get dir() {
      return options.cwd?.() ?? dir;
    },
    get stateFile() {
      return project.path(".verid/.state/state.json");
    },
    get auditFile() {
      return project.path(".verid/.state/audit.jsonl");
    },
    get manifestFile() {
      return project.path(".verid/manifest.yaml");
    },
    get lockFile() {
      return project.path(".verid/.state/state.lock");
    },
    get session() {
      return session;
    },
    path: (rel: string): string => join(project.dir, ...rel.split("/")),
    put: (rel: string, text = options.defaultText ?? ""): void => {
      const file = project.path(rel);
      if (options.parents !== false) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    read: (rel: string): string => readFileSync(project.path(rel), "utf8"),
    state: (): Payload => JSON.parse(readFileSync(project.stateFile, "utf8")),
    audit: (): Payload[] =>
      readFileSync(project.auditFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    seed: (partial: Payload): void => {
      const { auto, ...rest } = partial;
      const now = project.state();
      writeFileSync(
        project.stateFile,
        JSON.stringify({ ...now, ...rest, ...(auto && { auto: { ...now.auto, ...auto } }) }),
      );
    },

    reset: (): void => {
      if (options.state !== undefined || options.manifest !== undefined) {
        const target = resolve(project.dir, ".verid");
        if (!roots.some((temp) => target.startsWith(resolve(temp) + sep)))
          throw new Error("reset outside temporary project");
        rmSync(target, { recursive: true, force: true });
      }
      session = options.session ?? FIXTURE_SESSION;
      sessionCount = 0;
      options.sessionChanged?.(session);
      if (options.state !== undefined) {
        mkdirSync(dirname(project.stateFile), { recursive: true });
        writeFileSync(
          project.stateFile,
          typeof options.state === "string" ? options.state : JSON.stringify(options.state),
        );
      }
      if (options.manifest !== undefined) {
        mkdirSync(dirname(project.manifestFile), { recursive: true });
        writeFileSync(
          project.manifestFile,
          typeof options.manifest === "function" ? options.manifest() : options.manifest,
        );
      }
    },
    fresh: (): void => {
      root = directories.create(prefix, options.canonical);
      roots.push(root);
      dir = options.subdir ? join(root, options.subdir) : root;
      if (dir !== root) mkdirSync(dir, { recursive: true });
      options.bind?.(project);
      project.reset();
      if (options.approved) {
        for (const folder of [".verid/.state", "src", "test"])
          mkdirSync(project.path(folder), { recursive: true });
        project.put(
          ".verid/.state/state.json",
          JSON.stringify({
            schemaVersion: 1,
            tdd: { state: "PLATED", last_run: "seed", passed_acs: ["AC-1"] },
          }),
        );
        project.writeManifest();
        project.put(".verid/design.md", "# Design\nPure addition\n");
        project.put(".verid/research.md", "# Research\n");
        project.put(".verid/spec.md", "- REQ-1: adds two numbers\n");
        project.putPlan(
          ".verid/plan.md",
          "## Module: calc\n- AC-1: adds two numbers\n\n## Module: product\n- AC-9 (e2e): works end to end\n",
        );
        project.put(
          "scenario.json",
          JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "passing evidence" }),
        );
      }
      options.setup?.(project);
    },
    newDir: (name = prefix): string => {
      const created = directories.create(name);
      roots.push(created);
      return created;
    },

    putPlan: (rel: string, text = options.defaultText ?? ""): void => {
      if (rel === ".verid/plan.md") {
        if (options.planSpec && !existsSync(project.path(".verid/spec.md")))
          project.put(".verid/spec.md", options.planSpec);
        text = readyModulePlan(project.dir, text);
      }
      project.put(rel, text);
    },
    putAt: (dir: string, rel: string, text = options.defaultText ?? ""): void => {
      const file = join(dir, ...rel.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    putFile: (file: string, text: string): void => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        options.readyPlan && file.endsWith(join(".verid", "plan.md"))
          ? readyModulePlan(project.dir, text)
          : text,
      );
    },
    readAt: (dir: string, rel: string): string =>
      readFileSync(join(dir, ...rel.split("/")), "utf8"),
    readFile: (file: string): string => readFileSync(file, "utf8"),
    manifestText: (): string => readFileSync(project.manifestFile, "utf8"),
    editManifest: (edit: (value: Payload) => void): void => {
      const value = parseYaml(project.manifestText());
      edit(value);
      project.put(".verid/manifest.yaml", stringify(value));
    },
    objectManifest: (extra: Payload = {}): Payload =>
      projectManifest(extra, options.manifestPreset),
    writeManifest: (extra: Payload = {}): void =>
      project.put(".verid/manifest.yaml", JSON.stringify(project.objectManifest(extra))),
    manifestForDrive: (drive = "human"): Payload => project.objectManifest({ drive }),
    loadState: (): ReturnType<typeof readState> => readState(statePaths(project.dir)),
    auditText: (): string => readFileSync(project.auditFile, "utf8"),
  } as TestProject;
  Object.assign(
    project,
    createRunners(project, options, async () => {
      if (Object.hasOwn(project.state().kanban.sessions, "claude-code:" + session))
        session = (options.session ?? FIXTURE_SESSION) + "-" + ++sessionCount;
      options.sessionChanged?.(session);
      await startTaskSession(project.dir, session);
    }),
  );
  beforeEach(project.fresh);
  afterEach(async () => {
    try {
      await options.teardown?.();
    } finally {
      roots.length = 0;
      directories.cleanup();
    }
  });
  return project;
}
