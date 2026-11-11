import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Manifest } from "../core/manifest.js";
import type { State } from "../core/state.js";
import { FRESH_AUTO, parseState } from "../core/state.js";
import { autoPhase } from "../core/auto.js";
import { ownEntry, stationProblem } from "../core/station.js";
import { integrationProblem } from "../core/integration.js";
import { runGit, gitView } from "./git.js";
import { canonicalFolder, sameFolder, stationContext } from "./project.js";
import {
  autoFactsOf,
  planFile,
  readPlan,
  servedSections,
  specFile,
  designFile,
  orderedModules,
  planViews,
  MODULE_INPUTS,
} from "./plan-file.js";
import {
  readFileHash,
  readState,
  statePaths,
  withLock,
  writeState,
  VeridError,
} from "./state-store.js";
import { wireProjectHooks } from "./hook-wiring.js";
import { appendAudit, readAudit } from "./audit-log.js";
import type { CliResult } from "../cli/test.js";
import { checkSetupPath } from "./workspace.js";
import { createHash } from "node:crypto";
import { resourceTree } from "./repo-resources.js";
import { runtimeDirectory } from "./codex-settings.js";
import { uncoveredAcs } from "../core/plan.js";

export type Station = State["stations"][string];
const invalid = (detail: string) => new VeridError("VERID_BURNT_STATION_INVALID", { detail });

export function stationGit(project: string, args: string[]): string {
  const result = runGit(project, args);
  if (result.status !== 0 || result.error)
    throw invalid(result.stderr || result.error?.message || args.join(" "));
  return result.stdout.trim();
}

function primary(project: string, manifest: Manifest): string {
  const root = canonicalFolder(project);
  if (
    manifest.layout !== "monorepo" ||
    manifest.mode === "remix" ||
    manifest.repos.some((repo) => repo.path !== ".")
  )
    throw invalid("stations require a prep or recipe repository with repos.path: .");
  if (!sameFolder(stationGit(root, ["rev-parse", "--show-toplevel"]), root))
    throw invalid("the harness must be at the Git root");
  const common = canonicalFolder(
    stationGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  if (!sameFolder(dirname(common), root)) throw invalid("run station from the primary worktree");
  return root;
}

function approvedPlan(project: string, manifest: Manifest, state: State) {
  const plan = readPlan(project, manifest.iterations !== undefined, true, servedSections(state));
  if (!plan?.ok) throw invalid(plan?.detail ?? planFile(project));
  return plan;
}

/** Reserve first, then create; a failed setup remains visible to doctor if Git cleanup fails. */
export function openStation(project: string, name: string, manifest: Manifest): Station {
  const root = primary(project, manifest);
  const paths = statePaths(root);
  const clean = gitView(root);
  if (!clean?.clean || !clean.head)
    throw invalid("commit project changes before opening a station");
  if (manifest.resources === "repo") {
    for (const file of resourceTree(runtimeDirectory(), ".verid/hooks")) {
      if (
        file.rel.endsWith(".js") &&
        readFileHash(join(root, file.rel)) !==
          createHash("sha256").update(file.content).digest("hex")
      )
        throw invalid(
          "refresh and commit the pinned runtime from this installed bundle before opening stations",
        );
    }
  }
  const branch = stationGit(root, ["symbolic-ref", "--short", "HEAD"]);
  const common = canonicalFolder(
    stationGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const path = join(dirname(root), `${basename(root)}.stations`, name);
  const record = withLock(paths, () => {
    const state = readState(paths);
    const plan = approvedPlan(root, manifest, state);
    const module = plan.modules.find((module) => module.name === name);
    if (!module) throw invalid(`unknown module: ${name}`);
    const approval = state.modules[name];
    const code = stationProblem({
      module,
      approved:
        approval?.sha256 === plan.hashes[name] &&
        approval?.served_at === null &&
        approval.design_sha256 === readFileHash(designFile(root)),
      served: new Set(
        planViews(root, plan, state)
          .filter((view) => view.phase === "done")
          .map((view) => view.name),
      ),
      active: Object.values(state.stations),
      limit: manifest.drive === "auto" ? (manifest.stations ?? 1) : 3,
    });
    if (code) throw new VeridError(code, { detail: name });
    if (
      state.tdd.dirty ||
      state.writers.length ||
      (state.kanban.active?.module === name && state.kanban.active.session !== null)
    )
      throw invalid("open a station before starting its task session or writing code");
    checkSetupPath(dirname(root), `${basename(root)}.stations/${name}`);
    if (existsSync(path)) throw invalid(`path already exists: ${path}`);
    if (!readFileHash(specFile(root))) throw invalid("spec is missing");
    const record: Station = {
      module: name,
      path,
      branch: `feat/${name}`,
      main: branch,
      base: clean.head!,
      common,
      boundary: module.boundary!,
      sha256: plan.hashes[name]!,
      design_sha256: readFileHash(designFile(root))!,
      spec_sha256: readFileHash(specFile(root))!,
      at: new Date().toISOString(),
      stage: "opening",
    };
    writeState(paths, { ...state, stations: { ...state.stations, [name]: record } });
    return record;
  });
  let created = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    stationGit(root, ["worktree", "add", "-b", record.branch, path, record.base]);
    created = true;
    if (manifest.resources === "repo" && !existsSync(join(path, ".verid/hooks/hook.js")))
      throw invalid("commit pinned runtime resources before opening a station");
    const parent = readState(paths);
    // Git's checkout filters may change line endings; approval signatures cover the original bytes.
    const inputs = approvedPlan(root, manifest, parent);
    const copies = [
      ".verid/manifest.yaml",
      ".verid/plan.md",
      ".verid/spec.md",
      ".verid/design.md",
      ".verid/research.md",
      ...inputs.modules.flatMap((module) => [
        ...MODULE_INPUTS.map((input) => `.verid/artifacts/03-modules/${module.name}/${input}`),
        `.verid/artifacts/03-modules/${module.name}/ui/mockups/choice.json`,
      ]),
      ...(manifest.resources === "repo"
        ? resourceTree(runtimeDirectory(), ".verid/hooks")
            .filter((file) => file.rel.endsWith(".js"))
            .map((file) => file.rel)
        : []),
    ];
    for (const file of copies) {
      checkSetupPath(root, file);
      checkSetupPath(path, file);
      if (!existsSync(join(root, file))) continue;
      mkdirSync(dirname(join(path, file)), { recursive: true });
      copyFileSync(join(root, file), join(path, file));
    }
    // The copies match the committed blobs once normalized, but keep the checkout's stat data;
    // refreshing tracked entries stops Git from reporting the station dirty. Untracked files stay so.
    stationGit(path, ["add", "-u", "--", ".verid"]);
    const plan = approvedPlan(path, manifest, parent);
    if (
      plan.hashes[name] !== record.sha256 ||
      readFileHash(designFile(path)) !== record.design_sha256 ||
      readFileHash(specFile(path)) !== record.spec_sha256
    )
      throw invalid("approval inputs differ in the worktree; commit them before opening");
    wireProjectHooks(path, manifest);
    const stationPaths = statePaths(path);
    checkSetupPath(path, ".verid/.state/state.json");
    mkdirSync(stationPaths.dir, { recursive: true });
    const fresh = readFresh(parent);
    const facts = autoFactsOf(path, parent, manifest.iterations !== undefined, true);
    const approval = {
      ...parent.modules[name]!,
      work: { ".": { main: record.main, base: record.base } },
    };
    writeState(stationPaths, {
      ...fresh,
      station: { project: root, module: name },
      modules: { [name]: approval },
      kanban: {
        ...fresh.kanban,
        active: { module: name, session: null, spec_sha256: record.spec_sha256 },
      },
      ...(manifest.drive === "auto"
        ? {
            auto: {
              ...FRESH_AUTO,
              signed: parent.auto.signed,
              plan_sha256: facts.planHash,
              work: {
                module: name,
                roots: approval.work,
                branch: record.branch,
                stage: "open" as const,
              },
            },
          }
        : {}),
    });
    return withLock(paths, () => {
      const state = readState(paths);
      const opened: Station = { ...record, stage: "open" };
      appendAudit(paths.audit, { event: "station_opened", module: name, path });
      writeState(paths, {
        ...state,
        stations: { ...state.stations, [name]: opened },
        kanban: {
          ...state.kanban,
          active: state.kanban.active?.module === name ? null : state.kanban.active,
        },
        auto: { ...state.auto, work: state.auto.work?.module === name ? null : state.auto.work },
      });
      return opened;
    });
  } catch (error) {
    let removed = !created;
    if (created) removed = runGit(root, ["worktree", "remove", "--force", path]).status === 0;
    if (removed) {
      if (created) runGit(root, ["branch", "-D", record.branch]);
      withLock(paths, () => {
        const state = readState(paths);
        const { [name]: _, ...stations } = state.stations;
        writeState(paths, { ...state, stations });
      });
    }
    throw error;
  }
}

function readFresh(parent: State): State {
  // Parse through the same defaults as cook; no counters, sessions or evidence are copied.
  const result = parseState('{"schemaVersion":1}');
  if (!result.ok) throw invalid("state defaults");
  return { ...result.state, language: parent.language };
}

/** Only an unchanged developer signature and independently reviewed plan authorize auto stations. */
export function scheduleStations(project: string, manifest: Manifest): void {
  if (
    manifest.drive !== "auto" ||
    manifest.stations === 1 ||
    readState(statePaths(project)).station
  )
    return;
  const paths = statePaths(project);
  const state = readState(paths);
  const facts = autoFactsOf(
    project,
    state,
    manifest.iterations !== undefined,
    true,
    manifest.stations,
  );
  if (state.halted || autoPhase(facts).kind !== "stations" || !facts.plan?.ok) return;
  const signed = state.auto.signed;
  if (
    !signed ||
    signed.research_sha256 !== facts.researchHash ||
    signed.spec_sha256 !== facts.specHash ||
    signed.design_sha256 !== facts.designHash
  )
    throw invalid("research, spec or design changed; sign again before opening stations");
  for (const module of orderedModules(facts.plan.modules, state)) {
    const current = readState(paths);
    if (Object.keys(current.stations).length >= (manifest.stations ?? 1)) break;
    if (
      module.name === "product" ||
      ownEntry(current.stations, module.name) ||
      current.modules[module.name]?.served_at
    )
      continue;
    const code = stationProblem({
      module,
      approved: true,
      served: new Set(
        planViews(project, facts.plan, current)
          .filter((view) => view.phase === "done")
          .map((view) => view.name),
      ),
      active: Object.values(current.stations),
      limit: manifest.stations ?? 1,
    });
    if (code === "VERID_BURNT_STATION_DEPENDENCY" || code === "VERID_BURNT_STATION_OVERLAP")
      continue;
    if (code) throw new VeridError(code, { detail: module.name });
    withLock(paths, () => {
      const fresh = readState(paths);
      writeState(paths, {
        ...fresh,
        modules: {
          ...fresh.modules,
          [module.name]: {
            sha256: facts.plan!.ok ? facts.plan!.hashes[module.name]! : "",
            acs: module.acs,
            at: new Date().toISOString(),
            served_at: null,
            design_sha256: facts.designHash,
          },
        },
      });
    });
    openStation(project, module.name, manifest);
  }
}

/** Every mismatch is read-only and stays visible until the developer repairs it. */
export function stationDiagnostics(project: string): string[] {
  if (!existsSync(join(project, ".git"))) return [];
  let local: State;
  try {
    local = readState(statePaths(project));
  } catch {
    return [];
  }
  if (
    !local.station &&
    !Object.keys(local.stations).length &&
    !existsSync(join(dirname(project), `${basename(project)}.stations`))
  )
    return [];
  const context = stationContext(project);
  const root = context?.project ?? project;
  const state = readState(statePaths(root));
  const problems: string[] = [];
  const worktrees = stationGit(root, ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9));
  const registered = new Set(Object.values(state.stations).map((item) => item.path));
  for (const path of worktrees) {
    const stationParent =
      join(dirname(root), `${basename(root)}.stations`)
        .replaceAll("\\", "/")
        .toLowerCase() + "/";
    if (
      path.replaceAll("\\", "/").toLowerCase().startsWith(stationParent) &&
      ![...registered].some((folder) => existsSync(folder) && sameFolder(folder, path))
    )
      problems.push(`orphan worktree: ${path}`);
  }
  for (const item of Object.values(state.stations)) {
    if (
      !existsSync(item.path) ||
      !worktrees.some((path) => existsSync(path) && sameFolder(path, item.path))
    )
      problems.push(`${item.module}: missing worktree ${item.path}`);
    if (runGit(root, ["show-ref", "--verify", `refs/heads/${item.branch}`]).status !== 0)
      problems.push(`${item.module}: missing branch ${item.branch}`);
    for (const folder of [root, ...(existsSync(item.path) ? [item.path] : [])]) {
      try {
        const plan = readPlan(folder, true, true, servedSections(state));
        if (
          !plan?.ok ||
          plan.hashes[item.module] !== item.sha256 ||
          readState(statePaths(folder)).modules[item.module]?.sha256 !== item.sha256 ||
          readFileHash(designFile(folder)) !== item.design_sha256 ||
          readFileHash(specFile(folder)) !== item.spec_sha256
        )
          problems.push(`${item.module}: approval differs from plan, spec or design in ${folder}`);
      } catch {
        problems.push(`${item.module}: unreadable approval in ${folder}`);
      }
    }
    if (item.stage !== "open")
      problems.push(`${item.module}: ${item.stage}; inspect station before retrying`);
  }
  return problems;
}

/** Tests on the merged index must finish before the parent records completion. */
export async function closeStation(
  project: string,
  name: string,
  manifest: Manifest,
  taste: (project: string) => Promise<CliResult>,
): Promise<CliResult> {
  const root = primary(project, manifest);
  const paths = statePaths(root);
  const record = ownEntry(readState(paths).stations, name);
  if (!record) throw invalid(`no station: ${name}`);
  if (record.stage === "cleanup") return cleanup(root, record);
  if (record.stage !== "open") throw invalid(`station ${record.stage}; inspect before retrying`);
  const context = stationContext(record.path);
  if (!context?.station || context.station.module !== name)
    throw invalid("station registration changed");
  if (
    !gitView(root)?.clean ||
    stationGit(root, ["symbolic-ref", "--short", "HEAD"]) !== record.main
  )
    throw invalid("close requires the clean original branch");
  const local = readState(statePaths(record.path));
  const plan = approvedPlan(root, manifest, readState(paths));
  const stationPlan = approvedPlan(record.path, manifest, local);
  const approval = local.modules[name];
  if (
    !approval?.served_at ||
    approval.sha256 !== record.sha256 ||
    readState(paths).modules[name]?.sha256 !== record.sha256 ||
    plan.hashes[name] !== record.sha256 ||
    stationPlan.hashes[name] !== record.sha256 ||
    local.tdd.dirty ||
    local.tdd.failing.length ||
    !local.tdd.last_run ||
    !gitView(record.path)?.clean ||
    [root, record.path].some(
      (folder) =>
        readFileHash(designFile(folder)) !== record.design_sha256 ||
        readFileHash(specFile(folder)) !== record.spec_sha256,
    )
  )
    throw invalid("serve the unchanged station with passing evidence and commit its work first");
  const closed = stationGit(record.path, ["rev-parse", "HEAD"]);
  if (
    stationGit(root, ["rev-parse", record.branch]) !== closed ||
    runGit(root, ["merge-base", "--is-ancestor", record.base, closed]).status !== 0
  )
    throw invalid("station branch or base changed");
  const files = stationGit(root, ["diff", "--no-renames", "--name-only", "-z", record.base, closed])
    .split("\0")
    .filter(Boolean);
  const delta = createHash("sha256")
    .update(stationGit(root, ["diff", "--raw", "--no-renames", "-z", record.base, closed]))
    .digest("hex");
  const outside = integrationProblem(files, name, record.boundary);
  if (outside) throw invalid(`station committed a file outside Boundary: ${outside}`);
  const previous = stationGit(root, ["rev-parse", "HEAD"]);
  withLock(paths, () => {
    const state = readState(paths);
    if (
      ownEntry(state.stations, name)?.stage !== "open" ||
      Object.values(state.stations).some((item) => item.stage === "integrating")
    )
      throw invalid("another integration is running");
    writeState(paths, {
      ...state,
      stations: { ...state.stations, [name]: { ...record, stage: "integrating", closed } },
    });
  });
  let committed = false;
  let mergedTree: string | null = null;
  try {
    const merge = runGit(root, ["merge", "--squash", "--no-commit", closed]);
    if (merge.status !== 0) {
      const conflicts = stationGit(root, ["diff", "--name-only", "--diff-filter=U"]);
      throw new VeridError("VERID_BURNT_STATION_INTEGRATION", {
        detail: conflicts || merge.stderr,
      });
    }
    const tree = stationGit(root, ["write-tree"]);
    mergedTree = tree;
    const result = await taste(root);
    const tested = readState(paths).tdd;
    const module = plan.modules.find((module) => module.name === name)!;
    const uncovered = uncoveredAcs(module.acs, module.e2e, {
      passedAcs: tested.passed_acs,
      passedE2eAcs: tested.passed_e2e_acs,
    });
    if (
      result.exit !== 0 ||
      tested.dirty ||
      tested.failing.length ||
      !tested.last_run ||
      uncovered.length
    )
      throw new VeridError("VERID_BURNT_STATION_INTEGRATION", {
        detail: result.stderr || result.stdout,
      });
    if (
      stationGit(root, ["rev-parse", "HEAD"]) !== previous ||
      stationGit(root, ["write-tree"]) !== tree ||
      runGit(root, ["diff", "--quiet"]).status !== 0 ||
      stationGit(root, ["ls-files", "--others", "--exclude-standard"])
    )
      throw invalid("merged files changed during taste; inspect the index");
    // An empty delta still needs a tested integration commit before it counts as complete.
    stationGit(root, ["commit", "--allow-empty", "-m", `feat(${name}): integrate station`]);
    committed = true;
    const integrated = stationGit(root, ["rev-parse", "HEAD"]);
    const archive = join(paths.dir, "stations", name, integrated);
    cpSync(statePaths(record.path).dir, archive, {
      recursive: true,
      dereference: false,
      filter: (source) => !source.endsWith("state.lock") && !source.endsWith(".tmp"),
    });
    const events = readAudit(statePaths(record.path).audit);
    withLock(paths, () => {
      const state = readState(paths);
      const next = { ...record, stage: "cleanup" as const, closed, integrated };
      for (const event of events) {
        if (
          ![
            "session_start",
            "test_run",
            "test_context",
            "denied",
            "stop_blocked",
            "subagent_stop_blocked",
            "usage_recorded",
          ].includes(String(event.event))
        )
          continue;
        const { hash: _, prev_hash: __, ts: ___, ...fields } = event;
        appendAudit(paths.audit, {
          ...fields,
          event: String(event.event),
          module: name,
          station: record.path,
        });
      }
      appendAudit(paths.audit, { event: "station_integrated", module: name, integrated });
      writeState(paths, {
        ...state,
        modules: {
          ...state.modules,
          [name]: {
            ...approval,
            work: {
              ".": {
                main: record.main,
                base: record.base,
                closed,
                delta: { files: files.length, key: delta },
                integrated,
              },
            },
          },
        },
        stations: { ...state.stations, [name]: next },
        review: null,
        security: null,
      });
    });
    return cleanup(root, ownEntry(readState(paths).stations, name)!);
  } catch (error) {
    if (!committed) {
      // Only an initially clean merge is rolled back; a concurrent edit requires developer repair.
      const unchangedHead = stationGit(root, ["rev-parse", "HEAD"]) === previous;
      const unchangedIndex =
        mergedTree === null ||
        (stationGit(root, ["write-tree"]) === mergedTree &&
          runGit(root, ["diff", "--quiet"]).status === 0);
      const reset =
        unchangedHead && unchangedIndex ? runGit(root, ["reset", "--merge", previous]) : null;
      withLock(paths, () => {
        const state = readState(paths);
        writeState(paths, {
          ...state,
          stations: {
            ...state.stations,
            [name]: { ...record, stage: reset?.status === 0 ? "open" : "integrating" },
          },
          tdd: {
            ...state.tdd,
            state: "RAW",
            last_run: null,
            passed_acs: [],
            passed_e2e_acs: [],
            dirty: true,
            rev: state.tdd.rev + 1,
          },
        });
      });
    }
    throw error;
  }
}

function cleanup(root: string, record: Station): CliResult {
  if (existsSync(record.path)) stationGit(root, ["worktree", "remove", record.path]);
  const paths = statePaths(root);
  withLock(paths, () => {
    const state = readState(paths);
    const { [record.module]: _, ...stations } = state.stations;
    writeState(paths, { ...state, stations });
  });
  return {
    exit: 0,
    stdout: `verid: station ${record.module} integrated ${record.integrated}\n`,
    stderr: "",
  };
}
