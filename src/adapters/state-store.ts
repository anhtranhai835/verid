import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ErrorCode } from "../core/errors.js";
import { parseState, type State } from "../core/state.js";

/** An expected failure carrying a stable code; the hook turns it into a decision. */
export class VeridError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string> = {},
  ) {
    super(code);
  }
}

export interface StatePaths {
  dir: string;
  file: string;
  lock: string;
  audit: string;
}

export function statePaths(projectDir: string): StatePaths {
  const dir = join(projectDir, ".verid", ".state");
  return {
    dir,
    file: join(dir, "state.json"),
    lock: join(dir, "state.lock"),
    audit: join(dir, "audit.jsonl"),
  };
}

export function readState(paths: StatePaths): State {
  let raw: string;
  try {
    raw = retryBusy(() => readFileSync(paths.file, "utf8"));
  } catch (e) {
    if (errno(e) === "ENOENT") throw new VeridError("VERID_E_STATE_MISSING", { path: paths.file });
    throw e;
  }
  const parsed = parseState(raw);
  if (!parsed.ok) throw new VeridError(parsed.code, { path: paths.file });
  return parsed.state;
}

/** Write to a temp file, then rename over state.json, so readers never see half a file. */
export function writeState(paths: StatePaths, state: State): void {
  const tmp = `${paths.file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  try {
    retryBusy(() => renameSync(tmp, paths.file));
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

const LOCK_WAIT_MS = 3_000;
const LOCK_STALE_MS = 10_000;
// A normal hold lasts milliseconds. Below this age a dead PID usually means the holder
// released the lock and exited a moment ago, and the file may already be someone else's.
const DEAD_HOLDER_MIN_AGE_MS = 1_000;

/** Runs `fn` while holding an exclusive lockfile (`open` with `wx`; there is no flock on Windows). */
export function withLock<T>(paths: StatePaths, fn: () => T): T {
  const mine = acquire(paths.lock);
  try {
    return fn();
  } finally {
    // Never delete a lock that was taken over from us.
    if (readLock(paths.lock) === mine)
      try {
        unlinkSync(paths.lock);
      } catch {}
  }
}

function acquire(lock: string): string {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const mine = JSON.stringify({ pid: process.pid, at: Date.now() });
    try {
      writeFileSync(lock, mine, { flag: "wx" });
      return mine;
    } catch (e) {
      // Windows answers EPERM/EACCES while the previous lock file is still being deleted.
      if (!["EEXIST", "EPERM", "EACCES"].includes(errno(e) ?? "")) throw e;
    }
    const seen = readLock(lock);
    if (seen === undefined) continue; // released meanwhile
    if (isStale(seen, lock)) {
      // ponytail: re-reading narrows, but does not close, the window between judging and
      // unlinking; it only matters after a holder died or hung. Rename-based takeover if seen.
      if (readLock(lock) === seen)
        try {
          unlinkSync(lock);
        } catch {}
      continue;
    }
    if (Date.now() > deadline)
      throw new VeridError("VERID_E_LOCK_TIMEOUT", { path: lock, ms: String(LOCK_WAIT_MS) });
    sleep(15);
  }
}

function readLock(lock: string): string | undefined {
  try {
    return readFileSync(lock, "utf8");
  } catch (e) {
    if (errno(e) === "ENOENT") return undefined;
    return ""; // busy or being deleted: treat as an unreadable lock
  }
}

/** Stale when too old (also covers PID reuse) or when an old-enough lock's holder is gone. */
function isStale(content: string, lock: string): boolean {
  try {
    const { pid, at } = JSON.parse(content) as { pid: number; at: number };
    const age = Date.now() - at;
    return age > LOCK_STALE_MS || (age > DEAD_HOLDER_MIN_AGE_MS && !isAlive(pid));
  } catch {
    // Unreadable or still being written: judge by file age only.
    try {
      return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
    } catch {
      return false;
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errno(e) === "EPERM";
  }
}

const BUSY_RETRY_MS = 2_000;

/**
 * On Windows a file another process has open (a concurrent hook reading state, antivirus,
 * OneDrive) cannot be replaced or briefly cannot be read: retry for a bounded time.
 */
function retryBusy<T>(op: () => T): T {
  const deadline = Date.now() + BUSY_RETRY_MS;
  for (;;) {
    try {
      return op();
    } catch (e) {
      const code = errno(e);
      if (Date.now() > deadline || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES"))
        throw e;
      sleep(10);
    }
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errno(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}
