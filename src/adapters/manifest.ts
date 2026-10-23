import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseManifest, type Manifest, type Roles } from "../core/manifest.js";
import type { Scalar, YAMLMap, YAMLSeq } from "yaml";
import type { TddLayout } from "../core/tdd.js";
import { normalizePath, writtenPath } from "./claude-code.js";
import { errno, VeridError } from "./state-store.js";

export const manifestFile = (project: string) => join(project, ".verid", "manifest.yaml");

/**
 * Reads .verid/manifest.yaml; null when there is none, which keeps the Phase 0 behaviour
 * (no TDD gate). Loading `yaml` adds ~15 ms to a process start on Linux and more on Windows,
 * and the hook reads the manifest on every file write, so the validated manifest is cached
 * in .verid/.state keyed by the file's sha256; `yaml` loads only when the file changed.
 */
export async function loadManifest(project: string): Promise<Manifest | null> {
  const file = manifestFile(project);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  const cacheFile = join(project, ".verid", ".state", "manifest.cache.json");
  const manifest = readCache(cacheFile, hash) ?? (await parseFile(file, raw, cacheFile, hash));
  // A misspelled path would leave every write "outside the repo", gate silently off.
  const repoDir = resolve(project, manifest.repos[0]?.path ?? ".");
  if (!isDirectory(repoDir))
    throw new VeridError("VERID_BURNT_MANIFEST_INVALID", {
      path: file,
      detail: `repos.0.path: ${repoDir} is not a directory`,
    });
  return manifest;
}

async function parseFile(
  file: string,
  raw: string,
  cacheFile: string,
  hash: string,
): Promise<Manifest> {
  // yaml is CommonJS on Node; from the lazily loaded chunk its exports arrive on `default`.
  const yaml = await import("yaml");
  const { parse } = (yaml as unknown as { default?: typeof yaml }).default ?? yaml;
  let doc: unknown;
  try {
    // logLevel "error": warnings would go to stderr, which Claude Code shows; errors still throw.
    doc = parse(raw, { logLevel: "error" });
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    throw new VeridError("VERID_BURNT_MANIFEST_INVALID", { path: file, detail });
  }
  const r = parseManifest(doc);
  if (!r.ok) throw new VeridError("VERID_BURNT_MANIFEST_INVALID", { path: file, detail: r.detail });
  writeCache(cacheFile, hash, r.manifest);
  return r.manifest;
}

/**
 * The single Phase 1 repo, twice: with its root realpath'd like hook action paths, and as
 * written. A junction or symlink inside the repo may point outside it, so the hook checks
 * both forms of a path and keeps the stricter decision.
 */
export function tddLayouts(
  project: string,
  manifest: Manifest,
): { real: TddLayout; written: TddLayout } {
  const [repo] = manifest.repos;
  if (!repo)
    throw new VeridError("VERID_BURNT_MANIFEST_INVALID", {
      path: manifestFile(project),
      detail: "no repo",
    });
  const root = resolve(project, repo.path);
  const globs = {
    sourceGlobs: repo.source_globs,
    testGlobs: repo.test_globs,
    ignoreGlobs: repo.ignore_globs ?? [],
    e2eGlobs: repo.e2e_globs ?? [],
  };
  return {
    real: { repoRoot: normalizePath(root), ...globs },
    written: { repoRoot: writtenPath(root), ...globs },
  };
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readCache(file: string, hash: string): Manifest | null {
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as { hash?: unknown; manifest?: unknown };
    if (c.hash !== hash) return null;
    const r = parseManifest(c.manifest);
    return r.ok ? r.manifest : null;
  } catch {
    return null; // missing, busy or broken: parse the manifest instead
  }
}

// Best effort: a failed write only costs the next process a yaml parse.
function writeCache(file: string, hash: string, manifest: Manifest): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ hash, manifest }));
    renameSync(tmp, file);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

/**
 * The manifest with manifestUpgrade() applied: the missing globs added at the end of their
 * lists and an old runner preset dropped. Edited as a YAML document, so the developer's
 * comments and entries stay.
 */
export async function upgradeManifestText(
  raw: string,
  up: {
    tests: string[];
    ignore: string[];
    e2e: string[];
    roles: Roles | null;
    dropTestCmd: boolean;
  },
): Promise<string> {
  const yaml = await import("yaml");
  const { parseDocument } = (yaml as unknown as { default?: typeof yaml }).default ?? yaml;
  const doc = parseDocument(raw);
  // Quoted like the globs verid cook writes.
  const quoted = (glob: string) => Object.assign(doc.createNode(glob), { type: "QUOTE_DOUBLE" });
  const add = (key: string, globs: string[]) => {
    if (globs.length === 0) return;
    const path = ["repos", 0, key];
    if (!(doc.getIn(path) as { add?: unknown } | undefined)?.add)
      doc.setIn(path, doc.createNode([], { flow: true }));
    const list = doc.getIn(path) as { add: (v: unknown) => void };
    for (const g of globs) list.add(quoted(g));
  };
  add("test_globs", up.tests);
  add("ignore_globs", up.ignore);
  add("e2e_globs", up.e2e);
  if (up.roles) {
    // A block map of flow lists, quoted, as `verid cook` writes it.
    const roles = doc.createNode(up.roles) as YAMLMap<unknown, YAMLSeq<Scalar>>;
    for (const { value } of roles.items) {
      if (!value) continue;
      value.flow = true;
      for (const agent of value.items) agent.type = "QUOTE_DOUBLE";
    }
    doc.set("roles", roles);
  }
  if (up.dropTestCmd) doc.deleteIn(["repos", 0, "test_cmd"]);
  const r = parseManifest(doc.toJS());
  if (!r.ok)
    throw new VeridError("VERID_BURNT_MANIFEST_INVALID", { path: "manifest", detail: r.detail });
  return doc.toString({ lineWidth: 0 });
}
