import { createHash } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseManifest, type Manifest } from "../core/manifest.js";
import type { TddLayout } from "../core/tdd.js";
import { normalizePath } from "./claude-code.js";
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
  const cached = readCache(cacheFile, hash);
  if (cached) return cached;

  // yaml is CommonJS on Node; from the lazily loaded chunk its exports arrive on `default`.
  const yaml = await import("yaml");
  const { parse } = (yaml as unknown as { default?: typeof yaml }).default ?? yaml;
  let doc: unknown;
  try {
    // logLevel "error": warnings would go to stderr, which Claude Code shows; errors still throw.
    doc = parse(raw, { logLevel: "error" });
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    throw new VeridError("VERID_E_MANIFEST_INVALID", { path: file, detail });
  }
  const r = parseManifest(doc);
  if (!r.ok) throw new VeridError("VERID_E_MANIFEST_INVALID", { path: file, detail: r.detail });
  writeCache(cacheFile, hash, r.manifest);
  return r.manifest;
}

/** The single Phase 1 repo, with its root normalized like the paths in hook actions. */
export function tddLayout(project: string, manifest: Manifest): TddLayout {
  const [repo] = manifest.repos;
  if (!repo)
    throw new VeridError("VERID_E_MANIFEST_INVALID", {
      path: manifestFile(project),
      detail: "no repo",
    });
  return {
    repoRoot: normalizePath(resolve(project, repo.path)),
    sourceGlobs: repo.source_globs,
    testGlobs: repo.test_globs,
  };
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
