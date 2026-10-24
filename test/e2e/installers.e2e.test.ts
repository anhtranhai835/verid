import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
let dir: string;
let bin: string;
let calls: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "verid-installers-"));
  bin = join(dir, "bin");
  mkdirSync(bin);
  calls = join(dir, "calls.txt");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Real scripts and real child processes, with regular files for stdio and fake commands on PATH. */
function runFile(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const out = join(cwd, "stdout.txt");
  const err = join(cwd, "stderr.txt");
  const fds = [openSync(join(cwd, "stdin.txt"), "w+"), openSync(out, "w"), openSync(err, "w")];
  try {
    const r = spawnSync(command, args, { cwd, env, stdio: fds, windowsHide: true, timeout: 15000 });
    return {
      code: r.status,
      error: r.error?.message,
      out: readFileSync(out, "utf8"),
      err: readFileSync(err, "utf8"),
    };
  } finally {
    fds.forEach(closeSync);
  }
}
const posix = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
const powershell = join(
  process.env.SystemRoot ?? "C:/Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const findShell = (name: "bash" | "sh") => {
  const temp = mkdtempSync(join(tmpdir(), "verid-bash-check-"));
  try {
    for (const command of process.platform === "win32"
      ? [`C:/Program Files/Git/bin/${name}.exe`, `${name}.exe`]
      : [`/bin/${name}`, name]) {
      const r = runFile(command, ["-c", "printf shell-ready"], process.env, temp);
      if (r.code === 0 && r.out === "shell-ready") return command;
    }
    return null;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};
const bash = findShell("bash");
const sh = findShell("sh");

interface Installer {
  name: string;
  posix: boolean;
  available: boolean;
  stub: (name: string) => void;
  command: string;
  args: string[];
  path: () => string;
}
const shells: Installer[] = [
  {
    name: "install.ps1",
    posix: false,
    available: process.platform === "win32",
    command: powershell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Restricted",
      "-Command",
      `Get-Content -Raw -LiteralPath '${join(root, "install.ps1").replaceAll("'", "''")}' | iex`,
    ],
    path: () => `${bin}${delimiter}${process.env.SystemRoot}/System32`,
    stub: (name) => {
      if (name !== "node")
        writeFileSync(
          join(bin, `${name}.ps1`),
          "throw 'The installer must use the application shim.'\n",
        );
      writeFileSync(
        join(bin, `${name}.cmd`),
        [
          "@echo off",
          `echo ${name}^|%*>>"%VERID_TEST_CALLS%"`,
          ...(name === "verid" ? ['echo cwd^|%CD%>>"%VERID_TEST_CALLS%"'] : []),
          ...(name === "node" ? ["if %VERID_TEST_NODE_MAJOR% LSS 22 exit /b 1"] : []),
          name === "npm"
            ? "exit /b %VERID_TEST_NPM_EXIT%"
            : name === "claude"
              ? "exit /b %VERID_TEST_CLAUDE_EXIT%"
              : "exit /b 0",
          "",
        ].join("\r\n"),
      );
    },
  },
  {
    name: "install.sh (bash)",
    posix: true,
    available: bash !== null,
    command: bash ?? "bash",
    args: ["--noprofile", "--norc", posix(join(root, "install.sh"))],
    path: () => `${posix(bin)}:/usr/bin:/bin`,
    stub: (name) => {
      const file = join(bin, name);
      writeFileSync(
        file,
        [
          "#!/bin/sh",
          `printf '${name}' >> "$VERID_TEST_CALLS"`,
          'for arg do printf \'|%s\' "$arg" >> "$VERID_TEST_CALLS"; done',
          'printf "\\n" >> "$VERID_TEST_CALLS"',
          ...(name === "verid" ? ['printf \'cwd|%s\\n\' "$PWD" >> "$VERID_TEST_CALLS"'] : []),
          ...(name === "node" ? ['[ "$VERID_TEST_NODE_MAJOR" -ge 22 ] || exit 1'] : []),
          name === "npm"
            ? 'exit "$VERID_TEST_NPM_EXIT"'
            : name === "claude"
              ? 'exit "$VERID_TEST_CLAUDE_EXIT"'
              : "exit 0",
          "",
        ].join("\n"),
      );
      chmodSync(file, 0o755);
    },
  },
];
shells.push({
  ...shells[1]!,
  name: "install.sh (sh)",
  available: sh !== null,
  command: sh ?? "sh",
  args: [posix(join(root, "install.sh"))],
});
const run = (shell: Installer, extra: NodeJS.ProcessEnv = {}, args = shell.args) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !["PATH", "CI", "VERID_VERSION"].includes(k.toUpperCase()),
    ),
  );
  return runFile(
    shell.command,
    args,
    {
      ...env,
      PATH: shell.path(),
      CI: "true",
      VERID_TEST_CALLS: shell.posix ? posix(calls) : calls,
      VERID_TEST_NODE_MAJOR: "22",
      VERID_TEST_NPM_EXIT: "0",
      VERID_TEST_CLAUDE_EXIT: "0",
      ...extra,
    },
    dir,
  );
};
const log = () =>
  existsSync(calls)
    ? readFileSync(calls, "utf8")
        .replaceAll("\r", "")
        .replace(
          /^(node|npm|claude|verid)\|(.+)$/gm,
          (_, name: string, args: string) =>
            `${name}|${args.replaceAll('"', "").replaceAll(" ", "|")}`,
        )
        .replace(/^\uFEFF/, "")
    : "";

function replaceRequired(script: string, target: string | RegExp, replacement: string): string {
  const changed = script.replaceAll(target, replacement);
  if (changed === script) throw new Error(`Installer test replacement target missing: ${target}`);
  return changed;
}

it("refuses terminal rewrites when installer text no longer matches", () => {
  const rows = [
    { target: "[Console]::IsInputRedirected" },
    { target: /\[Console\]::IsOutputRedirected/g },
    { target: "</dev/tty" },
    { target: ">/dev/tty" },
    { target: "if ! [ -t 3 ] || ! [ -t 4 ];" },
  ];
  for (const { target } of rows)
    expect(() => replaceRequired("changed installer", target, "mock terminal")).toThrow(
      "Installer test replacement target missing:",
    );
});

/** Mock only the terminal boundary; execute the actual installer and its folder handling. */
const runInteractive = (shell: Installer, folder: string, home = posix(dir)) => {
  if (!shell.posix) {
    let script = readFileSync(join(root, "install.ps1"), "utf8");
    script = replaceRequired(script, "[Console]::IsInputRedirected", "$false");
    script = replaceRequired(script, "[Console]::IsOutputRedirected", "$false");
    const file = join(dir, "interactive.ps1");
    writeFileSync(file, script);
    return run(shell, { CI: "false", VERID_TEST_FOLDER: folder }, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Restricted",
      "-Command",
      `function Read-Host { $env:VERID_TEST_FOLDER }; Set-Location -LiteralPath $HOME; Get-Content -Raw -LiteralPath '${file.replaceAll("'", "''")}' | iex`,
    ]);
  }
  const input = join(dir, "answers.txt");
  const terminal = join(dir, "terminal.txt");
  writeFileSync(input, `${folder}\n`);
  let script = readFileSync(join(root, "install.sh"), "utf8");
  script = replaceRequired(script, "</dev/tty", '<"$VERID_TEST_TTY_IN"');
  script = replaceRequired(script, ">/dev/tty", '>"$VERID_TEST_TTY_OUT"');
  script = replaceRequired(script, "if ! [ -t 3 ] || ! [ -t 4 ];", "if false;");
  const file = join(dir, "interactive.sh");
  writeFileSync(file, script);
  const r = run(
    shell,
    {
      CI: "false",
      HOME: home,
      VERID_TEST_TTY_IN: posix(input),
      VERID_TEST_TTY_OUT: posix(terminal),
    },
    [posix(file)],
  );
  const transcript = existsSync(terminal) ? readFileSync(terminal, "utf8") : "";
  expect(transcript, r.error ?? r.err + r.out).toContain(
    "Project folder (leave empty to finish): ",
  );
  return { ...r, out: r.out + transcript };
};

for (const shell of shells)
  describe.skipIf(!shell.available)(shell.name, () => {
    // Each table starts several powershell.exe processes; startup slows under full-suite load.
    const tableTimeout = shell.posix ? 20_000 : 60_000;
    beforeEach(() => {
      for (const name of ["node", "npm", "claude", "verid"]) shell.stub(name);
    });

    it(
      "installs latest or the pinned package and all three Claude plugins without prompting",
      () => {
        const rows = [
          { version: undefined, package: "@anhtranhai835/verid@latest" },
          { version: "1.1.0", package: "@anhtranhai835/verid@1.1.0" },
          { version: "2.0.0-beta.1+build-2", package: "@anhtranhai835/verid@2.0.0-beta.1+build-2" },
        ];
        for (const row of rows) {
          writeFileSync(calls, "");
          const r = run(shell, row.version ? { VERID_VERSION: row.version } : {});
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(log()).toContain(`npm|install|-g|${row.package}\n`);
          for (const command of [
            "claude|plugin|marketplace|add|obra/superpowers-marketplace",
            "claude|plugin|install|superpowers@superpowers-marketplace",
            "claude|plugin|marketplace|add|forrestchang/andrej-karpathy-skills",
            "claude|plugin|install|andrej-karpathy-skills@karpathy-skills",
            "claude|plugin|marketplace|add|anhtranhai835/verid",
            "claude|plugin|install|verid@verid",
          ])
            expect(log()).toContain(`${command}\n`);
          expect(log()).toContain("node|-e|");
          expect(log()).toContain("process.versions.node");
          expect(log()).not.toContain("verid|cook");
          expect(r.out).toContain("verid cook");
        }
      },
      tableTimeout,
    );

    it(
      "refuses unsafe version pins before npm or Claude runs",
      () => {
        const rows = [
          { version: "1.0.0&echo injected" },
          { version: "latest;echo injected" },
          { version: "$(echo injected)" },
          { version: "-latest" },
          { version: " latest " },
          { version: "1.0.0\n" },
          { version: "\u212A" },
          { version: "\u0130" },
        ];
        for (const { version } of rows) {
          writeFileSync(calls, "");
          const r = run(shell, { VERID_VERSION: version });
          expect(r.code, r.error ?? r.err + r.out).toBe(1);
          expect(r.out + r.err).toContain("VERID_VERSION must be a version or tag");
          expect(log()).not.toContain("npm|");
          expect(log()).not.toContain("claude|");
        }
      },
      tableTimeout,
    );

    it(
      "refuses every spelling of the home folder without running cook",
      () => {
        const home = shell.posix ? posix(dir) : process.env.USERPROFILE!;
        const rows = [
          { folder: "~" },
          { folder: "." },
          { folder: home },
          { folder: "~/" },
          { folder: "~/." },
          { folder: `${home}/` },
          { folder: '"~"' },
          { folder: `"${home}"` },
        ];
        for (const { folder } of rows) {
          writeFileSync(calls, "");
          const r = runInteractive(shell, folder);
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(r.out + r.err).toContain("Choose a project folder other than your home folder.");
          expect(log()).not.toContain("verid|cook");
        }
      },
      tableTimeout,
    );

    it.skipIf(!shell.posix)(
      "compares physical home paths with a trailing HOME slash and symlink traversal",
      () => {
        mkdirSync(join(dir, "child"));
        mkdirSync(join(dir, "elsewhere"));
        symlinkSync(join(dir, "child"), join(dir, "elsewhere", "link"), "junction");
        const rows = [
          { folder: "~" },
          { folder: "~/" },
          { folder: "~/child/.." },
          { folder: "elsewhere/link/.." },
          { folder: "'~/'" },
        ];
        for (const { folder } of rows) {
          writeFileSync(calls, "");
          const r = runInteractive(shell, folder, `${posix(dir)}/`);
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(r.out + r.err).toContain("Choose a project folder other than your home folder.");
          expect(log()).not.toContain("verid|cook");
        }
      },
    );

    it("explains a missing project folder without a raw path error", () => {
      const r = runInteractive(
        shell,
        shell.posix ? posix(join(dir, "missing")) : join(dir, "missing"),
      );
      expect(r.code, r.error ?? r.err + r.out).toBe(1);
      expect(r.out + r.err).toContain("Choose an existing project folder.");
      expect(r.out + r.err).not.toContain("Cannot find path");
      expect(log()).not.toContain("verid|cook");
    });

    it.skipIf(!shell.posix)("finishes clearly when HOME is missing without a raw cd error", () => {
      const project = join(dir, "project");
      mkdirSync(project);
      const rows = [{ home: posix(join(dir, "missing-home")) }, { home: "" }];
      for (const { home } of rows) {
        writeFileSync(calls, "");
        const r = runInteractive(shell, posix(project), home);
        expect(r.code, r.error ?? r.err + r.out).toBe(0);
        expect(r.out).toContain("Home folder is unavailable");
        expect(r.out).toContain("verid cook");
        expect(r.err).toBe("");
        expect(log()).not.toContain("verid|cook");
      }
    });

    it.skipIf(shell.posix)(
      "uses a cmd-only Claude install and gives manual commands for ps1-only",
      () => {
        const rows = [
          { cmd: false, ps1: true, runsPlugins: false },
          { cmd: true, ps1: false, runsPlugins: true },
        ];
        for (const row of rows) {
          shell.stub("claude");
          if (!row.cmd) rmSync(join(bin, "claude.cmd"));
          if (!row.ps1) rmSync(join(bin, "claude.ps1"));
          writeFileSync(calls, "");
          const r = run(shell);
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(r.out + r.err).not.toContain("After installing Claude Code");
          for (const args of [
            "plugin marketplace add obra/superpowers-marketplace",
            "plugin install superpowers@superpowers-marketplace",
            "plugin marketplace add forrestchang/andrej-karpathy-skills",
            "plugin install andrej-karpathy-skills@karpathy-skills",
            "plugin marketplace add anhtranhai835/verid",
            "plugin install verid@verid",
          ]) {
            if (row.runsPlugins) expect(log()).toContain(`claude|${args.replaceAll(" ", "|")}\n`);
            else expect(r.out).toContain(`run manually: claude ${args}`);
          }
          if (!row.runsPlugins) expect(log()).not.toContain("claude|");
        }
      },
    );

    it("runs cook in an explicitly chosen project folder with spaces", () => {
      const project = join(dir, "my project");
      mkdirSync(project);
      const r = runInteractive(shell, shell.posix ? posix(project) : project);
      expect(r.code, r.error ?? r.err + r.out).toBe(0);
      expect(log()).toContain("verid|cook");
      expect(log().replaceAll("\\", "/")).toContain(
        `cwd|${shell.posix ? posix(project) : project.replaceAll("\\", "/")}`,
      );
    });

    it("refuses missing or old Node with installation instructions before installing anything", () => {
      const rows = [
        { missing: false, major: "21" },
        { missing: true, major: "22" },
      ];
      for (const row of rows) {
        writeFileSync(calls, "");
        if (row.missing) {
          rmSync(join(bin, shell.posix ? "node" : "node.cmd"));
        }
        const r = run(shell, { VERID_TEST_NODE_MAJOR: row.major });
        expect(r.code, r.error ?? r.err + r.out).toBe(1);
        expect(r.out + r.err).toContain("https://nodejs.org");
        expect(r.out + r.err).toContain("22");
        expect(log()).not.toContain("npm|");
        expect(log()).not.toContain("claude|");
      }
    });

    it("stops on npm failure and never attempts plugin installation", () => {
      const r = run(shell, { VERID_TEST_NPM_EXIT: "7" });
      expect(r.code, r.error ?? r.err + r.out).toBe(1);
      expect(r.out + r.err).toContain("npm install");
      expect(log()).not.toContain("claude|");
    });

    it(
      "continues on plugin failure or a repeated install and prints the manual commands",
      () => {
        const rows = [{ exit: "1" }, { exit: "0" }, { exit: "1" }];
        for (const row of rows) {
          const r = run(shell, { VERID_TEST_CLAUDE_EXIT: row.exit });
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(r.out).toContain("verid cook");
          if (row.exit === "1") {
            expect(r.out + r.err).toContain(
              "claude plugin marketplace add obra/superpowers-marketplace",
            );
            expect(r.out + r.err).toContain(
              "claude plugin marketplace add forrestchang/andrej-karpathy-skills",
            );
            expect(r.out + r.err).toContain(
              "claude plugin install andrej-karpathy-skills@karpathy-skills",
            );
            expect(r.out + r.err).toContain("claude plugin install verid@verid");
          }
        }
        expect(log().split("npm|install|-g|")).toHaveLength(4);
        expect(
          log().split("claude|plugin|install|andrej-karpathy-skills@karpathy-skills\n"),
        ).toHaveLength(4);
      },
      tableTimeout,
    );

    it(
      "skips plugin commands when Claude is absent and skips cook for every redirected CI value",
      () => {
        rmSync(join(bin, shell.posix ? "claude" : "claude.cmd"));
        if (!shell.posix) rmSync(join(bin, "claude.ps1"));
        const rows = [{ ci: "" }, { ci: "false" }, { ci: "FALSE" }, { ci: "0" }, { ci: "true" }];
        for (const { ci } of rows) {
          writeFileSync(calls, "");
          const r = run(shell, { CI: ci });
          expect(r.code, r.error ?? r.err + r.out).toBe(0);
          expect(log()).not.toContain("claude|");
          expect(log()).not.toContain("verid|");
          expect(r.out).toContain("verid cook");
          expect(r.out).toContain(
            "claude plugin marketplace add forrestchang/andrej-karpathy-skills",
          );
          expect(r.out).toContain("claude plugin install andrej-karpathy-skills@karpathy-skills");
        }
      },
      tableTimeout,
    );
  });
