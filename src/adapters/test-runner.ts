import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRunners, type FolderFacts, type Runner } from "../core/runners.js";
import { fileRole, type TddLayout } from "../core/tdd.js";
import { xmlReports } from "./junit.js";
import { isDirectory } from "./manifest.js";

/** `exit` is null when the command could not start, was killed by a signal or timed out. */
export interface TestRun {
  exit: number | null;
  timedOut: boolean;
}

/** Runs the manifest's test command as runCommand does, with VERID_JUNIT set to the report path. */
export function runTestCommand(
  command: string,
  cwd: string,
  logFile: string,
  junit: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<TestRun> {
  return runCommand(command, cwd, logFile, timeoutMs, { ...env, VERID_JUNIT: junit });
}

/**
 * Runs a command through the platform shell (cmd.exe on Windows, /bin/sh elsewhere) and keeps its
 * whole output in `logFile`. After `timeoutMs` the command is killed together with its children.
 */
export function runCommand(
  command: string,
  cwd: string,
  logFile: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<TestRun> {
  return new Promise((done) => {
    // Appended: the runners verid finds share one log.
    const log = createWriteStream(logFile, { flags: "a" });
    // cmd.exe refuses a UNC working directory and silently runs in C:\Windows instead;
    // pushd maps a temporary drive letter for it.
    const unc = process.platform === "win32" && cwd.startsWith("\\\\");
    const child = spawn(unc ? `pushd "${cwd}" && ${command}` : command, {
      cwd: unc ? tmpdir() : cwd,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Its own process group on POSIX, so a timeout reaches the runner the shell started.
      detached: process.platform !== "win32",
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let settled = false;
    const finish = (exit: number | null, timedOut: boolean, note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (note) log.write(note);
      log.end(() => done({ exit, timedOut }));
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      // A process that escaped the tree may still hold the pipes open: stop reading them.
      child.stdout.destroy();
      child.stderr.destroy();
      finish(null, true, `\nverid: stopped after ${timeoutMs / 1000} s\n`);
    }, timeoutMs);
    child.on("error", (e) => finish(null, false, `\nverid: ${e.message}\n`));
    child.on("close", (code) => finish(code, false));
  });
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Quotes a path for the shell the command runs in. */
export function shellQuote(path: string): string {
  return process.platform === "win32" ? `"${path}"` : `'${path.replaceAll("'", `'\\''`)}'`;
}

/** Config files a runner may be named in (core/runners.ts). */
const NAMED_IN = ["pyproject.toml", "setup.cfg", "Gemfile", "composer.json"];

/**
 * The test runners of the repo: from the build files at its root and in its top-level folders
 * that hold code or tests. Hidden folders and the ignored ones (node_modules, target…) are
 * not looked into.
 */
// ponytail: one level deep; a build file deeper down (packages/a/b/pom.xml) needs test_cmd.
export function findRunners(
  root: string,
  layout: Omit<TddLayout, "repoRoot">,
): { runners: Runner[]; unsupported: string[] } {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((d) => fileRole(`${d}/x`, layout) !== "free")
    .sort();
  const folders = [".", ...dirs].map((dir) => folderFacts(join(root, dir), dir));
  return detectRunners(folders, process.platform === "win32");
}

function folderFacts(path: string, dir: string): FolderFacts {
  const files = readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const text = (name: string) => {
    try {
      return files.includes(name) ? readFileSync(join(path, name), "utf8") : null;
    } catch {
      return null;
    }
  };
  const texts = Object.fromEntries(
    NAMED_IN.flatMap((n) => {
      const t = text(n);
      return t === null ? [] : [[n, t]];
    }),
  );
  let deps: string[] = [];
  try {
    const pkg = JSON.parse(text("package.json") ?? "{}") as {
      dependencies?: object;
      devDependencies?: object;
    };
    deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    // A package.json that does not parse names no runner.
  }
  return { dir, files, deps, texts };
}

/** The report folders of a Maven or Gradle runner that exist now, its modules' included. */
export function reportFolders(root: string, runner: Runner): string[] {
  const base = join(root, runner.dir);
  const modules = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  return runner.reportDirs
    .flatMap((d) =>
      d.startsWith("*/") ? modules.map((m) => join(base, m, d.slice(2))) : [join(base, d)],
    )
    .filter(isDirectory);
}

/** The name Maven's and Gradle's JUnit reports have. */
export const REPORT_NAME = /^TEST-.*\.xml$/;

/**
 * Removes the TEST-*.xml a tool wrote in an earlier run, so a run counts only its own reports
 * and an old one, or one left there by hand, is not taken for this run's.
 */
export function clearReports(folders: readonly string[]): void {
  for (const folder of folders)
    for (const file of xmlReports(folder, REPORT_NAME)) rmSync(file, { force: true });
}
