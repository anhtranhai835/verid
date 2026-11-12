import type { ErrorCode } from "../core/errors.js";
import { existsSync } from "node:fs";
import { bilingual, setLanguage, t } from "../adapters/i18n.js";
import { manifestFile } from "../adapters/manifest.js";
import { languageOf, VeridError } from "../adapters/state-store.js";
import { interactiveCook } from "./cook-screen.js";
import { doctorCommand } from "./doctor.js";
import { initCommand, setupCodexCommand } from "./init.js";
import { moduleCommand } from "./module.js";
import { boardCommand } from "./board.js";
import { baselineCommand, testCommand, type CliResult } from "./test.js";
import { pluginCommand } from "./plugin.js";
import { resolveProject } from "../adapters/project.js";
import { stationCommand } from "./station.js";
import { reheatArgs, reheatCommand } from "./reheat.js";
import { contextArgs, contextCommand } from "./context.js";
import { initFlags } from "./cook-flags.js";
import { refactor } from "./garnish.js";
import { halt, resume } from "./halt.js";
import { misused, usage, helpNextStep } from "./help.js";
import { menu, commitFlags, commits } from "./menu.js";
import { approve } from "./order.js";
import { status } from "./peek.js";
import { serve, serveArgs } from "./serve.js";
import { hasTerminal, interactive, terminalIo, locale, systemLang } from "./shell.js";
import { usageCommand } from "./usage.js";

/** `dist/cli.js`: the command line in, its output and exit code out. */
export async function main(): Promise<void> {
  const r = await runCli(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}

/**
 * One verid command run in the current folder; tests call it in process. Exit 2 means verid
 * refused or failed, and nothing counted as evidence.
 */
export async function runCli(args: readonly string[]): Promise<CliResult> {
  let project = process.cwd();
  const [cmd, ...rest] = args;
  setLanguage(languageOf(project));
  let r: CliResult;
  try {
    project = resolveProject(process.cwd(), process.env.CLAUDE_PROJECT_DIR);
    setLanguage(languageOf(project));
    const flags = cmd === "cook" || cmd === "upgrade" ? initFlags(rest, cmd) : null;
    if (flags?.lang === "vi" || flags?.lang === "en") setLanguage(flags.lang);
    // cook sets up the folder it runs in, like `git init`; the others look upwards for .verid.
    // In the developer's own terminal, with no flags, it asks instead of reading flags.
    if (cmd === "cook" && rest.length === 0 && interactive())
      r = await interactiveCook(process.cwd(), terminalIo(), locale());
    else if (flags)
      r = await initCommand(
        cmd === "upgrade" ? project : process.cwd(),
        flags,
        hasTerminal() ? terminalIo() : undefined,
        cmd === "upgrade" ? "upgrade" : "cook",
      );
    else if (cmd === "setup-codex" && rest.length === 0) r = setupCodexCommand();
    else if (cmd === "plugin")
      r = await pluginCommand(project, rest, hasTerminal() ? terminalIo() : undefined);
    else if (cmd === "station") r = await stationCommand(project, rest);
    else if (cmd === "reheat" && reheatArgs(rest)) r = await reheatCommand(project, rest);
    else if (cmd === "taste" && rest.length === 0) r = await testCommand(project);
    else if (cmd === "doctor" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--ci")))
      r = await doctorCommand(project, rest[0] === "--ci");
    else if (cmd === "module" && rest.length === 1) r = await moduleCommand(project, rest[0]!);
    else if (cmd === "module" && rest.length === 2 && ["--quick", "--fix"].includes(rest[1]!))
      r = await moduleCommand(project, rest[0]!, rest[1] === "--quick" ? "quick" : "fix");
    else if (cmd === "board")
      r = await boardCommand(project, rest, (action, task, paritySigned) =>
        action === "order"
          ? approve(project, task)
          : serve(project, task ?? "", { paritySigned: paritySigned === true }),
      );
    else if (cmd === "peek" && rest.length === 0) r = await status(project);
    else if (cmd === "usage") r = usageCommand(project, rest);
    else if (cmd === "context" && contextArgs(rest)) r = await contextCommand(project, rest);
    else if (cmd === "menu" && rest.length === 0) r = await menu(project);
    else if (cmd === "menu" && rest[0] === "--commits" && commitFlags(rest.slice(1)))
      r = await commits(project, rest.includes("--file"), rest.includes("--compact"));
    else if (cmd === "garnish" && rest.length === 0) r = refactor(project);
    else if (cmd === "halt") r = halt(project, rest);
    else if (cmd === "resume" && rest.length === 0) r = resume(project);
    else if (cmd === "stock" && rest.length === 0) r = await baselineCommand(project);
    else if (cmd === "order" && rest.length <= 1) r = await approve(project, rest[0]);
    else if (cmd === "serve" && serveArgs(rest)) {
      const names = rest.filter((arg) => arg !== "--parity-signed");
      r = await serve(project, names[0] as string, {
        paritySigned: names.length < rest.length,
        ...(hasTerminal() && { io: terminalIo() }),
      });
    } else if (cmd === undefined) r = usage(project, null, await helpNextStep(project));
    else if (["help", "--help", "-h"].includes(cmd)) r = usage(project, null);
    else r = usage(project, misused(cmd, rest));
  } catch (err) {
    const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_BURNT_INTERNAL";
    const params =
      err instanceof VeridError
        ? err.params
        : { detail: err instanceof Error ? err.message : String(err) };
    // Before cook there is no language to follow: say it once, in the system's.
    const before = languageOf(project) === null && !existsSync(manifestFile(project));
    const text = before ? t(systemLang(), code, params) : bilingual(code, params);
    r = { exit: 2, stdout: "", stderr: `verid [${code}]\n${text}\n` };
  }
  return r;
}
