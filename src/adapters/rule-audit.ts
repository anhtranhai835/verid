import { existsSync, readFileSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { join } from "node:path";
import { closeHistory, isWorkBranch, isConventionalCommit } from "../core/git-convention.js";
import type { Manifest } from "../core/manifest.js";
import { dependencyProblems, parsePlan } from "../core/plan.js";
import { specTrace } from "../core/spec.js";
import type { State } from "../core/state.js";
import { declaredMains, runGit, readHistories, repoFacts, workRoots } from "./git.js";
import { readFileHash } from "./state-store.js";

/** Convention diagnostics never feed a gate. Failure to read them is itself a warning. */
export function auditWarnings(project: string, manifest: Manifest, state: State): string[] {
  const deadline = Date.now() + 4_000;
  const warnings: string[] = [];
  const warn = (code: string, detail: string) => warnings.push(`[${code}] ${detail}`);
  try {
    const roots = workRoots(project, manifest, deadline);
    const mains = declaredMains(project, manifest, deadline);
    if (!Array.isArray(roots)) warn("GIT_UNRESOLVED", roots.error);
    for (const { repo, top } of Array.isArray(roots) ? roots : []) {
      const facts = repoFacts(top, manifest.git?.default_branch, () => mains, deadline);
      if ("error" in facts) warn("GIT_UNRESOLVED", `${repo}: ${facts.error}`);
      else if (!facts.main.ok) warn("GIT_UNRESOLVED", `${repo}: ${facts.main.detail}`);
      else if (facts.branch === facts.main.main)
        warn("GIT_MAIN_COMMIT", `${repo}: on ${facts.branch}`);
      else if (facts.branch === null || !isWorkBranch(facts.branch))
        warn(
          "GIT_BRANCH_NAME",
          `${repo}: ${facts.branch ?? "detached HEAD"} (main ${facts.main.main})`,
        );
    }
    for (const { repo, top } of Array.isArray(roots) ? roots : []) {
      if (Date.now() >= deadline) {
        warn("GIT_UNRESOLVED", "audit time budget exhausted");
        break;
      }
      const status = runGit(
        top,
        [
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--",
          ".",
          ":(exclude).verid/.state",
          ":(exclude).state",
          ":(exclude).claude/settings.local.json",
          ":(exclude).codex/hooks.json",
        ],
        undefined,
        Math.max(1, deadline - Date.now()),
      );
      if (status.error || status.status !== 0)
        warn("GIT_UNRESOLVED", `${repo}: status unavailable`);
      else if (status.stdout.trim()) warn("GIT_DIRTY", `${repo}: uncommitted changes`);
    }
    const present = new Set((Array.isArray(roots) ? roots : []).map((root) => root.repo));
    for (const [repo, wasGit] of Object.entries(state.auto.signed?.git_repos ?? {}))
      if (wasGit && !present.has(repo))
        warn("GIT_UNRESOLVED", `${repo}: repository no longer in Git`);
    const open =
      state.auto.work ??
      Object.entries(state.modules)
        .filter(([, a]) => a.served_at === null)
        .map(([module, a]) => ({ module, roots: a.work ?? {} }))[0];
    if (open) {
      for (const root of readHistories(project, open.roots, undefined, deadline)) {
        const history = closeHistory([root]);
        if (history.problem && history.problem.code !== "VERID_BURNT_GIT_COMMIT_MESSAGE")
          warn(history.problem.code, Object.values(history.problem.params).join(" "));
        for (const commit of root.commits ?? [])
          if (!isConventionalCommit(commit.message))
            warn(
              "GIT_COMMIT_MESSAGE",
              `${root.repo}: ${commit.sha.slice(0, 12)} ${commit.message.split(/\r?\n/)[0]}`,
            );
      }
    }
    for (const repo of manifest.repos.filter((r) => r.architecture_check && r.role !== "legacy")) {
      const result = state.architecture[repo.path];
      if (!result || state.tdd.dirty || result.status !== "pass")
        warn(
          "ARCHITECTURE",
          `${repo.path}: ${result?.status ?? "not run"}${result?.log ? ` · ${result.log}` : ""}`,
        );
    }
    // Design signatures remain useful for detection, but never revoke a module approval.
    const hash = readFileHash(join(project, ".verid/design.md"));
    if (hash === null && manifest.mode !== "remix") warn("WORKFLOW", "design missing");
    else if (hash !== null) {
      const signed =
        manifest.drive === "auto"
          ? state.auto.signed?.design_sha256
          : Object.values(state.modules).find((a) => a.served_at === null)?.design_sha256;
      if (signed && signed !== hash)
        warn("DESIGN_CHANGED", ".verid/design.md changed since approval");
    }
    // Traceability between the spec and the plan's ACs only warns; ordering never waits on it.
    for (const [code, detail] of traceFindings(project, manifest)) warn(code, detail);
    const spec = join(project, ".verid/spec.md");
    const signedSpec = state.auto.signed?.spec_sha256;
    if (manifest.drive === "auto" && signedSpec && signedSpec !== readFileHash(spec))
      warn("SPEC_CHANGED", ".verid/spec.md changed since approval");
    const signedResearch = state.auto.signed?.research_sha256;
    const research = join(project, ".verid/research.md");
    if (manifest.drive === "auto" && signedResearch && signedResearch !== readFileHash(research))
      warn("RESEARCH_CHANGED", ".verid/research.md changed since approval");
  } catch (err) {
    warn("AUDIT_UNAVAILABLE", err instanceof Error ? err.message : String(err));
  }
  return [...new Set(warnings)];
}

/**
 * What the committed spec and plan alone show: dependency order and spec-to-AC traceability.
 * It needs no verid state, so `doctor --ci` can check it on a fresh clone.
 */
export function traceFindings(project: string, manifest: Manifest): [string, string][] {
  const found: [string, string][] = [];
  const spec = join(project, ".verid/spec.md");
  const plan = join(project, ".verid/plan.md");
  if (manifest.mode === "remix" || !existsSync(plan)) return found;
  const planText = readFileSync(plan, "utf8");
  const parsed = parsePlan(planText, manifest.iterations !== undefined);
  if (parsed.ok)
    for (const line of dependencyProblems(parsed.modules)) found.push(["DEPENDS", line]);
  if (existsSync(spec)) {
    const trace = specTrace(readFileSync(spec, "utf8"), planText);
    for (const id of trace.uncovered)
      found.push([
        "SPEC_UNCOVERED",
        `${id}: no AC or Review Focus line in .verid/plan.md cites it`,
      ]);
    for (const id of trace.unknown)
      found.push(["SPEC_UNKNOWN", `${id}: cited in .verid/plan.md but not in .verid/spec.md`]);
  }
  return found;
}

/** Current diagnostics plus bounded historical observations, including closed auto modules. */
export function auditLines(
  project: string,
  manifest: Manifest,
  state: State,
  details = true,
  current = auditWarnings(project, manifest, state),
): string[] {
  const warnings = [...current];
  const file = join(project, ".verid/.state/audit.jsonl");
  try {
    if (existsSync(file))
      for (const line of auditTail(file).trimEnd().split("\n").filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.event === "warning")
          warnings.push(`[${event.code}] ${event.target}: ${event.reason}`);
        if (event.event === "module_served" && Array.isArray(event.warnings))
          warnings.push(
            ...event.warnings.filter(
              (warning: unknown): warning is string => typeof warning === "string",
            ),
          );
      }
  } catch (err) {
    warnings.push(`[AUDIT_UNAVAILABLE] ${err instanceof Error ? err.message : String(err)}`);
  }
  const unique = [...new Set(warnings)];
  return unique.length
    ? [
        `verid: audit: ${unique.length} warning(s)`,
        ...(details ? unique.map((line) => `  ${line}`) : []),
      ]
    : [];
}

/** Recent bounded observations: skip a partial first record when the file exceeds 64 KiB. */
function auditTail(file: string): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 64 * 1024));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    const text = tail.toString("utf8");
    return tail.length < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}
