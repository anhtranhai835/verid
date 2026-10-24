import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { acsInName } from "../core/plan.js";
import {
  classifyRuns,
  e2eCases,
  cycleHint,
  cycleLabel,
  failureKey,
  newFailures,
  shrinkBaseline,
  splitBaseline,
  transition,
  type Cycle,
  type InvalidRunCode,
  type RunVerdict,
  type TestCase,
} from "../core/tdd.js";
import { DEFAULT_TIMEOUT_SEC, type Repo } from "../core/manifest.js";
import { goneRunners, runnerKey, runnerLabel, type Runner } from "../core/runners.js";
import { appendAudit } from "../adapters/audit-log.js";
import { bilingual } from "../adapters/i18n.js";
import { emitPluginEvent } from "../adapters/plugins.js";
import { readJUnitFiles, xmlReports } from "../adapters/junit.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import {
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import {
  clearReports,
  findRunners,
  REPORT_NAME,
  reportFolders,
  runTestCommand,
  shellQuote,
} from "../adapters/test-runner.js";

export interface CliResult {
  exit: number;
  stdout: string;
  stderr: string;
}

// The agent reads every line we print on every later turn: show why tests failed, keep
// the full output in the run's log.
const MAX_FAILURES = 10;
const MAX_MESSAGE_LINES = 6;
const TAIL_LINES = 20;
// Runs are kept for the developer to look into; the evidence itself is in the audit log.
const RUN_DAYS = 30;

/**
 * `verid taste`: run the manifest's test command, judge the run by its exit code and JUnit
 * report, keep it under .verid/.state/runs/<id>/ and move the TDD cycle.
 * Exit 0 = tests pass and 1 = tests fail (both are evidence); 2 = not evidence.
 */
export async function testCommand(project: string): Promise<CliResult> {
  const paths = statePaths(project);
  // remix: without a baseline every old failure would count as the agent's. Run nothing yet.
  const remix = (await loadManifest(project))?.mode === "remix";
  if (remix && readState(paths).baseline === null)
    throw new VeridError("VERID_BURNT_RUN_NO_BASELINE");
  const run = await runOnce(project);
  const { id, log, cases, classified, junitSha256 } = run;

  const { verdict, from, to, fresh, known, changed, left } = withLock(paths, () => {
    const state = readState(paths);
    const from: Cycle = { state: state.tdd.state, stub: state.tdd.stub };
    // A test written meanwhile (or another run finishing) bumped rev: this run may predate it.
    const judged: RunVerdict =
      state.tdd.rev === run.startRev
        ? classified
        : { kind: "invalid", code: "VERID_BURNT_RUN_STALE" };
    const before = state.baseline ?? []; // null only outside remix, where it is not used
    const { verdict, known, changed, kept } =
      remix && judged.kind !== "invalid"
        ? againstBaseline(judged, cases ?? [], before)
        : { verdict: judged, known: [], changed: [], kept: before };
    const left = before.length - kept.length;
    const to: Cycle =
      verdict.kind === "invalid"
        ? from
        : transition(from, verdict, state.tdd.failing, state.tdd.crashed);
    // How many tests this run newly fails: TDD takes one behaviour at a time.
    const fresh =
      verdict.kind === "fail"
        ? new Set(
            newFailures(verdict.failing, state.tdd.failing, state.tdd.crashed).map((c) => c.id),
          ).size
        : 0;
    const summary = {
      run: id,
      verdict: verdict.kind,
      ...(verdict.kind === "invalid" && { code: verdict.code }),
      from: from.state,
      to: to.state,
      stub: to.stub,
      junit_sha256: junitSha256,
      ...(remix && { baseline_known: known.length }),
    };
    writeRunJson(run, {
      ...summary,
      // What verid peek shows of a run that did not count.
      ...(verdict.kind === "invalid" && { params: refusalParams(run), hint: run.hint }),
      tests: cases && count(cases),
      failing: verdict.kind === "fail" ? verdict.failing.map((c) => c.id) : [],
    });
    // Audit first: if it fails, state is untouched and the run is not evidence.
    appendAudit(paths.audit, { event: "test_run", ...summary });
    const runners = remembered(state.runners, run);
    // A runner that ran, even in a run that is not evidence, may not be dropped later.
    if (verdict.kind === "invalid" && runners.length > state.runners.length)
      writeState(paths, { ...state, runners });
    if (verdict.kind !== "invalid") {
      const failing = verdict.kind === "fail" ? verdict.failing.map(failureKey) : [];
      writeState(paths, {
        ...state,
        tdd: {
          ...state.tdd,
          state: to.state,
          stub: to.stub,
          last_run: id,
          failing,
          crashed:
            verdict.kind === "fail"
              ? verdict.failing.filter((c) => c.assertion === false).map((c) => c.id)
              : [],
          rev: state.tdd.rev + 1,
          dirty: false,
          passed_acs: passedAcs(cases ?? []),
          passed_e2e_acs: passedAcs(run.e2eCases),
        },
        ...(remix && { baseline: kept }),
        runners,
      });
    }
    return { verdict, from, to, fresh, known, changed, left };
  });

  if (verdict.kind === "invalid") return notEvidence(run, verdict.code, "taste");

  const c = count(cases ?? []);
  const lines = [
    `verid: ${cycleLabel(from)} → ${cycleLabel(to)} · run ${id} · ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped`,
  ];
  if (verdict.kind === "fail") lines.push(...failures(verdict.failing));
  if (from.state === "RAW" && (to.state === "COOKING" || to.stub) && fresh > 1)
    lines.push(bilingual("tdd.one_behaviour", { count: String(fresh) }));
  if (known.length > 0)
    lines.push(bilingual("tdd.baseline_known", { count: String(known.length) }));
  for (const k of changed)
    lines.push(bilingual("tdd.baseline_changed", { test: k.id, line: firstLine(k) }));
  if (left > 0) lines.push(bilingual("tdd.baseline_left", { count: String(left) }));
  if (from.state === "RAW" && verdict.kind === "pass")
    lines.push(bilingual(from.stub ? "tdd.stub_passed" : "tdd.passed_in_red", {}));
  if (from.state === "RAW" && to.state === "RAW" && !to.stub && verdict.kind === "fail")
    lines.push(bilingual("tdd.no_new_failure", {}));
  if (from.state === "PLATED" && verdict.kind === "fail")
    lines.push(bilingual("tdd.refactor_broke", { failed: String(verdict.failing.length) }));
  lines.push(bilingual(cycleHint(to), {}), bilingual("taste.log", { log: shown(project, log) }));
  const warnings = await emitPluginEvent(project, "taste", {
    passed: verdict.kind === "pass",
    counts: c,
  });
  return {
    exit: verdict.kind === "pass" ? 0 : 1,
    stdout: `${lines.join("\n")}\n`,
    stderr: warnings.length ? `${warnings.join("\n")}\n` : "",
  };
}

/**
 * remix: the failures from before verid are not the cycle's, so the run is judged by its new
 * failures only (a run with just known ones passes). A baseline test that passes leaves the
 * baseline for good, and a run never adds to it.
 */
function againstBaseline(
  run: Exclude<RunVerdict, { kind: "invalid" }>,
  cases: readonly TestCase[],
  baseline: readonly string[],
): { verdict: RunVerdict; known: TestCase[]; changed: TestCase[]; kept: string[] } {
  const kept = shrinkBaseline(cases, baseline);
  if (run.kind === "pass") return { verdict: run, known: [], changed: [], kept };
  const { fresh, known, changed } = splitBaseline(run.failing, baseline);
  const verdict: RunVerdict =
    fresh.length > 0
      ? { ...run, failing: fresh }
      : { kind: "pass", passed: run.passed, skipped: run.skipped };
  return { verdict, known, changed, kept };
}

/** The AC codes named by passing tests: what this run shows, not what earlier runs showed. */
const passedAcs = (cases: readonly TestCase[]): string[] =>
  [...new Set(cases.filter((c) => c.status === "passed").flatMap((c) => acsInName(c.id)))].sort();

/** The first line of a failure's message, as failureKey() compares it. */
const firstLine = (c: TestCase): string => (c.message.split("\n")[0] ?? "").trim().slice(0, 200);

/**
 * `verid stock` (remix, developer only): run the tests once and record the ones already
 * failing as known failures, so the TDD cycle only has to deal with the agent's own. The
 * cycle itself is not touched, and a run that is not evidence records nothing.
 */
export async function baselineCommand(project: string): Promise<CliResult> {
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_BASELINE_IN_AGENT");
  const manifest = await loadManifest(project);
  // No manifest: runOnce says so.
  if (manifest && manifest.mode !== "remix")
    throw new VeridError("VERID_BURNT_MODE_MISMATCH", { command: "stock", mode: manifest.mode });

  const paths = statePaths(project);
  const run = await runOnce(project);
  const { id, log, cases, classified, junitSha256 } = run;
  if (classified.kind === "invalid") return notEvidence(run, classified.code, "stock");

  const failing = classified.kind === "fail" ? classified.failing : [];
  const c = count(cases ?? []);
  withLock(paths, () => {
    writeRunJson(run, {
      purpose: "baseline",
      verdict: classified.kind,
      junit_sha256: junitSha256,
      tests: c,
      failing: failing.map((f) => f.id),
    });
    // Audit first: if it fails, state is untouched and nothing was recorded.
    appendAudit(paths.audit, {
      event: "baseline_recorded",
      run: id,
      failing: failing.length,
      junit_sha256: junitSha256,
    });
    const state = readState(paths);
    writeState(paths, {
      ...state,
      baseline: failing.map(failureKey),
      runners: remembered(state.runners, run),
    });
  });

  const lines = [
    `verid: baseline · run ${id} · ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped`,
    bilingual("baseline.done", { count: String(failing.length) }),
    ...failing.slice(0, MAX_FAILURES).map((f) => `  ${f.id}`),
  ];
  if (failing.length > MAX_FAILURES) lines.push(`  … ${failing.length - MAX_FAILURES} more`);
  lines.push(bilingual("taste.log", { log: shown(project, log) }));
  return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

interface RunOnce {
  project: string;
  id: string;
  dir: string;
  junit: string;
  log: string;
  startedAt: Date;
  /** tdd.rev when the run started: a later one means a file was written during the run. */
  startRev: number;
  exitCode: number | null;
  cases: TestCase[] | null;
  /** What the exit codes and the reports say; `verid taste` may still find the run stale. */
  classified: RunVerdict;
  /** The tests of `cases` that are end-to-end. */
  e2eCases: TestCase[];
  junitSha256: string | null;
  command: string;
  timeoutSec: number;
  /** The runners verid found and ran (runnerKey()); null when the manifest names test_cmd. */
  runners: string[] | null;
  /** What to tell the agent when a runner verid found left no report. */
  hint: { key: "taste.setup" | "taste.not_compiled"; params: Record<string, string> } | null;
}

/** One command of a run: the manifest's test_cmd, or a runner verid found. */
interface Job {
  command: string;
  cwd: string;
  junit: string;
  env: Record<string, string>;
  /** Where the reports are read from after the run. */
  reports: () => string[];
  runner?: Runner;
  repo: Repo;
}

/**
 * Runs the manifest's test command once, or each runner verid finds when it names none, and
 * keeps the run under .verid/.state/runs/<id>/.
 */
async function runOnce(project: string): Promise<RunOnce> {
  const paths = statePaths(project);
  const state = readState(paths); // no usable state → no run
  const startRev = state.tdd.rev;
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const scopedRunners = manifest.layout === "workspace" || manifest.repos.length > 1;
  const repos = manifest.repos.map((repo) => {
    const root = resolve(project, ...repo.path.split(/[/\\]/));
    const prefix = repo.path.replaceAll("\\", "/").toLowerCase();
    const seen = state.runners.filter((key) => {
      const dir = key.slice(key.indexOf("@") + 1).toLowerCase();
      return !scopedRunners || dir === prefix || dir.startsWith(`${prefix}/`);
    });
    return {
      repo,
      root,
      runners: repo.test_cmd === undefined ? foundRunners(root, repo, seen, scopedRunners) : null,
    };
  });
  const runners = repos.some((repo) => repo.runners !== null)
    ? repos.flatMap(({ repo, runners }) =>
        (runners ?? []).map((r) => runnerKey(r, scopedRunners ? repo.path : ".")),
      )
    : null;
  const gone = runners && goneRunners(state.runners, runners);
  if (gone && gone.length > 0)
    throw new VeridError("VERID_BURNT_RUN_RUNNER_GONE", {
      runners: gone.map(runnerLabel).join(", "),
    });

  const startedAt = new Date();
  const id = runId(startedAt);
  const dir = join(paths.dir, "runs", id);
  mkdirSync(dir, { recursive: true });
  pruneRuns(join(paths.dir, "runs"), startedAt);
  const log = join(dir, "output.log");
  // A replacer function: a string replacement would expand `$$` or `$&` in the project path.
  const fill = (text: string, junit: string, quote: boolean) =>
    text.replaceAll("{junit}", () => (quote ? shellQuote(junit) : junit));
  const jobs: Job[] = repos.flatMap(({ repo, root, runners }, repoIndex): Job[] =>
    runners === null
      ? [
          {
            command: fill(
              repo.test_cmd ?? "",
              join(dir, repos.length === 1 ? "junit.xml" : `junit-${repoIndex}.xml`),
              true,
            ),
            cwd: root,
            junit: join(dir, repos.length === 1 ? "junit.xml" : `junit-${repoIndex}.xml`),
            env: {},
            reports: () => [join(dir, repos.length === 1 ? "junit.xml" : `junit-${repoIndex}.xml`)],
            repo,
          },
        ]
      : runners.map((r, i) => {
          const own = join(dir, "junit", `${repoIndex}-${i + 1}-${r.name}`);
          mkdirSync(own, { recursive: true });
          const junit = r.junitIsFolder ? own : join(own, "junit.xml");
          clearReports(reportFolders(root, r));
          return {
            command: fill(r.command, junit, true),
            cwd: join(root, r.dir),
            junit,
            env: Object.fromEntries(
              Object.entries(r.env).map(([k, v]) => [k, fill(v, junit, false)]),
            ),
            reports: () => [
              ...xmlReports(own),
              ...reportFolders(root, r).flatMap((f) => xmlReports(f, REPORT_NAME)),
            ],
            runner: r,
            repo,
          };
        }),
  );

  const timeoutSec = repos.reduce(
    (seconds, { repo }) => seconds + (repo.timeout_sec ?? DEFAULT_TIMEOUT_SEC),
    0,
  );
  const deadlines = new Map<Repo, number>();
  const results: { exit: number | null; cases: TestCase[] | null; timedOut: boolean }[] = [];
  const files: string[] = [];
  for (const job of jobs) {
    if (!deadlines.has(job.repo))
      deadlines.set(job.repo, Date.now() + (job.repo.timeout_sec ?? DEFAULT_TIMEOUT_SEC) * 1000);
    if (job.runner)
      appendFileSync(log, `verid: ${job.runner.name} in ${job.runner.dir}: ${job.command}\n`);
    const run = await runTestCommand(
      job.command,
      job.cwd,
      log,
      job.junit,
      Math.max(deadlines.get(job.repo)! - Date.now(), 1),
      job.env,
    );
    const reports = job.reports();
    results.push({ exit: run.exit, cases: readJUnitFiles(reports), timedOut: run.timedOut });
    files.push(...reports);
    if (run.timedOut) break;
  }
  const named = (cases: readonly TestCase[], repo: Repo): TestCase[] =>
    cases.map((test) => ({
      ...test,
      id:
        manifest.layout === "workspace" || repos.length > 1 ? `[${repo.path}] ${test.id}` : test.id,
    }));
  const scoped = results.map((result, i) => ({
    ...result,
    cases: result.cases === null ? null : named(result.cases, jobs[i]!.repo),
  }));
  const { verdict: classified, at } = classifyRuns(scoped);
  const cases = scoped.every((r) => r.cases !== null) ? scoped.flatMap((r) => r.cases ?? []) : null;
  const failed = at === null ? undefined : jobs[at]?.runner;
  const nonZero = results.find((r) => r.exit !== 0);
  return {
    project,
    id,
    dir,
    junit: jobs[at ?? 0]?.junit ?? join(dir, "junit.xml"),
    log,
    startedAt,
    startRev,
    exitCode: nonZero ? nonZero.exit : 0,
    cases,
    classified,
    e2eCases: results.flatMap((r, i) => {
      const job = jobs[i]!;
      return named(
        e2eCases(
          [{ runner: job.runner?.name ?? null, cases: r.cases ?? [] }],
          job.repo.e2e_globs ?? [],
        ),
        job.repo,
      );
    }),
    junitSha256: cases === null ? null : sha256(Buffer.concat(files.map((f) => readFileSync(f)))),
    command: jobs.map((j) => j.command).join("\n"),
    timeoutSec,
    runners,
    hint:
      failed && classified.kind === "invalid" && classified.code === "VERID_BURNT_RUN_NO_JUNIT"
        ? noReportHint(failed)
        : null,
  };
}

/**
 * Why a runner verid found may have left no report: a tool to install, or for Maven and Gradle a
 * test that does not compile. Only the report shows a stub step, never the build's log.
 */
function noReportHint(r: Runner): RunOnce["hint"] {
  const params = { runner: r.name, dir: r.dir };
  if (r.name === "maven" || r.name === "gradle") return { key: "taste.not_compiled", params };
  return r.setup ? { key: "taste.setup", params: { ...params, setup: r.setup } } : null;
}

/**
 * The runners to run when the manifest names no test_cmd. A runner run before whose build
 * file is gone stops the run: its tests, failing ones included, would quietly leave it.
 */
function foundRunners(
  root: string,
  repo: Repo,
  seen: readonly string[],
  scoped: boolean,
): Runner[] {
  const { runners, unsupported } = findRunners(root, {
    sourceGlobs: repo.source_globs,
    testGlobs: repo.test_globs,
    ignoreGlobs: repo.ignore_globs ?? [],
  });
  const gone = goneRunners(
    seen,
    runners.map((runner) => runnerKey(runner, scoped ? repo.path : ".")),
  );
  if (gone.length > 0)
    throw new VeridError("VERID_BURNT_RUN_RUNNER_GONE", {
      runners: gone.map(runnerLabel).join(", "),
    });
  if (runners.length === 0)
    throw new VeridError(
      "VERID_BURNT_RUN_NO_RUNNER",
      unsupported.length > 0
        ? { detail_key: "taste.unsupported", unsupported: unsupported.join(", ") }
        : { detail: "" },
    );
  return runners;
}

/** The runners seen so far, with this run's. */
const remembered = (seen: readonly string[], run: RunOnce): string[] =>
  run.runners ? [...new Set([...seen, ...run.runners])] : [...seen];

function writeRunJson(run: RunOnce, fields: Record<string, unknown>): void {
  writeFileSync(
    join(run.dir, "run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: run.id,
        started_at: run.startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        command: run.command,
        exit_code: run.exitCode,
        ...fields,
      },
      null,
      2,
    )}\n`,
  );
}

/** What the message of a run that is not evidence needs. */
const refusalParams = (run: RunOnce) => ({
  path: shown(run.project, run.junit),
  exit: String(run.exitCode ?? "none"),
  failed: String(run.cases?.filter((c) => c.status === "failed").length ?? 0),
  seconds: String(run.timeoutSec),
});

/** A path under the project as the agent reads it: relative, the project's own path aside. */
const shown = (project: string, path: string) => relative(project, path) || path;

/** The result for a run that is not evidence: why, and the tail of its output. */
function notEvidence(run: RunOnce, code: InvalidRunCode, command: "taste" | "stock"): CliResult {
  const params = refusalParams(run);
  return {
    exit: 2,
    stdout: "",
    stderr: [
      `verid [${code}]`,
      bilingual(code, params),
      ...(run.hint ? [bilingual(run.hint.key, { ...run.hint.params, command })] : []),
      // Code with no test yet: nothing to record, and taste waits for a baseline.
      ...(command === "stock" && code === "VERID_BURNT_RUN_NO_TESTS"
        ? [bilingual("baseline.no_tests", {})]
        : []),
      tail(run.log, shown(run.project, run.log)),
    ].join("\n"),
  };
}

/** Sortable and unique enough for one developer: 20261019T114429Z-3f9a. */
function runId(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

/** Removes runs, named by runId(), that started more than RUN_DAYS before `now`. */
function pruneRuns(runs: string, now: Date): void {
  for (const name of readdirSync(runs)) {
    const iso = name
      .slice(0, 16)
      .replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z");
    const at = Date.parse(iso);
    if (name[16] === "-" && now.getTime() - at > RUN_DAYS * 86_400_000)
      rmSync(join(runs, name), { recursive: true, force: true });
  }
}

function count(cases: TestCase[]) {
  const by = (s: TestCase["status"]) => cases.filter((c) => c.status === s).length;
  return { passed: by("passed"), failed: by("failed"), skipped: by("skipped") };
}

function failures(failing: TestCase[]): string[] {
  const out = failing.slice(0, MAX_FAILURES).flatMap((f) => [
    `  FAIL ${f.id}`,
    ...f.message
      .split("\n")
      .filter((l) => l.trim() !== "")
      .slice(0, MAX_MESSAGE_LINES)
      .map((l) => `       ${l.trim().slice(0, 200)}`),
  ]);
  if (failing.length > MAX_FAILURES) out.push(`  … ${failing.length - MAX_FAILURES} more`);
  return out;
}

function tail(log: string, name: string): string {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {}
  const lines = text.trimEnd().split("\n").slice(-TAIL_LINES);
  return `--- ${name} (last ${lines.length} lines) ---\n${lines.join("\n")}\n`;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * The latest `verid taste` when it did not count, for `verid peek`: the developer sees why the
 * agent is stuck without reading the run's files. Null once a later run counted.
 */
export function lastRefusal(
  project: string,
  lastRun: string | null,
): { run: string; code: string; params: Record<string, string>; hint: RunOnce["hint"] } | null {
  const runs = join(statePaths(project).dir, "runs");
  let names: string[];
  try {
    names = readdirSync(runs);
  } catch {
    return null;
  }
  type Judged = {
    name: string;
    started_at: string;
    verdict?: unknown;
    code?: unknown;
    params?: unknown;
    hint?: unknown;
  };
  const judged = names.flatMap((name): Judged[] => {
    try {
      return [{ name, ...JSON.parse(readFileSync(join(runs, name, "run.json"), "utf8")) }];
    } catch {
      return []; // still running, or cut short: not a run verid judged
    }
  });
  // By start time to the millisecond: two runs in the same second have ids in any order.
  const latest = judged.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  if (!latest || latest.name === lastRun) return null;
  if (latest.verdict !== "invalid" || typeof latest.code !== "string") return null;
  return {
    run: latest.name,
    code: latest.code,
    params: (latest.params ?? {}) as Record<string, string>,
    hint: (latest.hint ?? null) as RunOnce["hint"],
  };
}
