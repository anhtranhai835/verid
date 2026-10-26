import { runCli as cli } from "../../src/cli/main.js";
import { run } from "../../src/hook.js";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `fn` with `env` as the whole CLAUDE_* / CODEX_* / GIT_* environment, so the test machine's
 * own session and git setup leak nothing; an undefined value unsets the variable. Both helpers
 * change process state, so calls must not overlap; vitest runs a file's tests one at a time.
 */
async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env))
    if (/^(CLAUDE|CODEX|GIT_)/i.test(key)) delete process.env[key];
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/**
 * What a process would print: anything written straight to stdout or stderr while `fn` runs,
 * then the result it returns, which main() writes last. Children with inherited stdio (git clone,
 * npm install) bypass this, so assert on their output only in a spawned test.
 */
async function captured(
  fn: () => Promise<{ exit: number; stdout?: string; stderr?: string }>,
): Promise<Run> {
  const streams = [process.stdout, process.stderr] as const;
  const texts = ["", ""];
  const writes = streams.map((stream) => stream.write);
  streams.forEach((stream, i) => {
    stream.write = ((chunk: string | Uint8Array) => {
      texts[i] += String(chunk);
      return true;
    }) as typeof stream.write;
  });
  try {
    const r = await fn();
    return {
      code: r.exit,
      stdout: texts[0] + (r.stdout ?? ""),
      stderr: texts[1] + (r.stderr ?? ""),
    };
  } finally {
    streams.forEach((stream, i) => (stream.write = writes[i]!));
  }
}

/** The hook as `dist/hook.js` runs it: `input` is its stdin and `args` its argv. */
export function runHook(input: string, env: NodeJS.ProcessEnv = {}, args: string[] = []) {
  return withEnv(env, () => captured(() => run(input, args)));
}

/** The CLI as `dist/cli.js` runs it, started in `cwd`. */
export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return withEnv(env, async () => {
    const dir = process.cwd();
    process.chdir(cwd);
    try {
      return await captured(() => cli(args));
    } finally {
      process.chdir(dir);
    }
  });
}
