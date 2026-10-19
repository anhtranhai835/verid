import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classify, transition, type TddState, type TestCase } from "../core/tdd.js";
import { appendAudit } from "../adapters/audit-log.js";
import { bilingual } from "../adapters/i18n.js";
import { readJUnit } from "../adapters/junit.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import {
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import { runTestCommand, shellQuote } from "../adapters/test-runner.js";

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

/**
 * `verid test`: run the manifest's test command, judge the run by its exit code and JUnit
 * report, keep it under .verid/.state/runs/<id>/ and move the TDD cycle.
 * Exit 0 = tests pass and 1 = tests fail (both are evidence); 2 = not evidence.
 */
export async function testCommand(project: string): Promise<CliResult> {
  const paths = statePaths(project);
  readState(paths); // no usable state → no run
  const manifest = await loadManifest(project);
  const repo = manifest?.repos[0];
  if (!repo) throw new VeridError("VERID_E_MANIFEST_MISSING", { path: manifestFile(project) });

  const startedAt = new Date();
  const id = runId(startedAt);
  const dir = join(paths.dir, "runs", id);
  mkdirSync(dir, { recursive: true });
  const junit = join(dir, "junit.xml");
  const log = join(dir, "output.log");
  const command = repo.test_cmd.replaceAll("{junit}", shellQuote(junit));
  const exitCode = await runTestCommand(command, resolve(project, repo.path), log);
  const cases = readJUnit(junit);
  const verdict = classify(exitCode, cases);
  const junitSha256 = cases === null ? null : sha256(readFileSync(junit));

  const { from, to } = withLock(paths, () => {
    const state = readState(paths);
    const from = state.tdd.state;
    const to: TddState = verdict.kind === "invalid" ? from : transition(from, verdict.kind);
    const summary = {
      run: id,
      verdict: verdict.kind,
      ...(verdict.kind === "invalid" && { code: verdict.code }),
      from,
      to,
      junit_sha256: junitSha256,
    };
    writeFileSync(
      join(dir, "run.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id,
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
          command,
          exit_code: exitCode,
          ...summary,
          tests: cases && count(cases),
          failing: verdict.kind === "fail" ? verdict.failing.map((c) => c.id) : [],
        },
        null,
        2,
      )}\n`,
    );
    // Audit first: if it fails, state is untouched and the run is not evidence.
    appendAudit(paths.audit, { event: "test_run", ...summary });
    if (verdict.kind !== "invalid")
      writeState(paths, { ...state, tdd: { state: to, last_run: id } });
    return { from, to };
  });

  if (verdict.kind === "invalid") {
    const failed = String(cases?.filter((c) => c.status === "failed").length ?? 0);
    const params = { path: junit, exit: String(exitCode ?? "none"), failed };
    return {
      exit: 2,
      stdout: "",
      stderr: `verid [${verdict.code}]\n${bilingual(verdict.code, params)}\n${tail(log)}`,
    };
  }

  const c = count(cases ?? []);
  const lines = [
    `verid: ${from} → ${to} · run ${id} · ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped`,
  ];
  if (verdict.kind === "fail") lines.push(...failures(verdict.failing));
  if (from === "RED" && verdict.kind === "pass") lines.push(bilingual("tdd.passed_in_red", {}));
  if (from === "REFACTOR" && verdict.kind === "fail")
    lines.push(bilingual("tdd.refactor_broke", { failed: String(c.failed) }));
  lines.push(bilingual(`status.${to.toLowerCase()}`, {}), `Full log, for the developer: ${log}`);
  return { exit: verdict.kind === "pass" ? 0 : 1, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

/** Sortable and unique enough for one developer: 20261019T114429Z-3f9a. */
function runId(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
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

function tail(log: string): string {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {}
  const lines = text.trimEnd().split("\n").slice(-TAIL_LINES);
  return `--- ${log} (last ${lines.length} lines) ---\n${lines.join("\n")}\n`;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
