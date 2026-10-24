import { describe, expect, it } from "vitest";
import {
  bashWriteTargets,
  decide,
  mcpAccess,
  mcpPaths,
  type Action,
  type PolicyContext,
} from "../../src/core/policy.js";
import type { RuleCode } from "../../src/core/errors.js";

// Paths arrive already normalized by the adapter (absolute, lowercase on win32).
const ctx: PolicyContext = {
  stateDir: "c:\\proj\\.verid\\.state",
  manifestPath: "c:\\proj\\.verid\\manifest.yaml",
  transcriptsDir: "c:\\users\\u\\.claude\\projects",
  distDir: "c:\\tools\\verid\\dist",
  planPath: "c:\\proj\\.verid\\plan.md",
  researchMissing: false,
  designMissing: false,
};

const read = (path: string): Action => ({
  kind: "file",
  tool: "Read",
  access: "read",
  path,
  display: path,
});
const write = (path: string): Action => ({
  kind: "file",
  tool: "Write",
  access: "write",
  path,
  display: path,
});

const ALLOW = "allow";
const STATE = "VERID_BURNT_STATE_PROTECTED";
const SECRET = "VERID_BURNT_SECRET_PROTECTED";
const TRANSCRIPT = "VERID_BURNT_TRANSCRIPT_PROTECTED";
const HOOK = "VERID_BURNT_HOOK_PROTECTED";
const MANIFEST = "VERID_BURNT_MANIFEST_PROTECTED";
const NESTED = "VERID_BURNT_BASH_NESTED_CLAUDE";
const DEVELOPER = "VERID_BURNT_BASH_DEVELOPER_ONLY";

// Each behaviour holds its cases as a literal table; on a failure the diff names the case.
function expectFiles(rows: [string, Action, string][]): void {
  const verdict = (a: Action) => {
    const d = decide(a, ctx);
    return d.kind === "allow" ? ALLOW : d.code;
  };
  expect(Object.fromEntries(rows.map(([name, a]) => [name, verdict(a)]))).toEqual(
    Object.fromEntries(rows.map(([name, , want]) => [name, want])),
  );
}

function expectBash(rows: [string, string][]): void {
  const verdict = (command: string) => {
    const d = decide({ kind: "bash", command }, ctx);
    return d.kind === "allow" ? ALLOW : d.code;
  };
  expect(Object.fromEntries(rows.map(([c]) => [c, verdict(c)]))).toEqual(Object.fromEntries(rows));
}

describe("decide: file tools", () => {
  it("protects verid's state, even from reads (it holds the pending confirmation code)", () => {
    expectFiles([
      ["write state file", write("c:\\proj\\.verid\\.state\\state.json"), STATE],
      ["read state file", read("c:\\proj\\.verid\\.state\\state.json"), STATE],
      ["write the state dir itself", write("c:\\proj\\.verid\\.state"), STATE],
      ["sibling with same prefix", write("c:\\proj\\.verid\\.statefoo\\x"), ALLOW],
    ]);
  });

  it("lets the manifest be read but not written", () => {
    expectFiles([
      ["write manifest", write("c:\\proj\\.verid\\manifest.yaml"), MANIFEST],
      ["read manifest", read("c:\\proj\\.verid\\manifest.yaml"), ALLOW],
    ]);
  });

  it("blocks secret files, but not their templates or look-alikes", () => {
    expectFiles([
      ["read .env", read("c:\\proj\\.env"), SECRET],
      ["write .env", write("c:\\proj\\.env"), SECRET],
      ["read .env.local", read("c:\\proj\\.env.local"), SECRET],
      ["read pem", read("c:\\proj\\certs\\server.pem"), SECRET],
      ["read key", read("c:\\proj\\certs\\tls.key"), SECRET],
      ["read p12", read("c:\\proj\\cert.p12"), SECRET],
      ["read pfx", read("c:\\proj\\cert.pfx"), SECRET],
      ["read ssh config", read("c:\\users\\u\\.ssh\\config"), SECRET],
      ["grep the .ssh dir", read("c:\\users\\u\\.ssh"), SECRET],
      ["read id_rsa.pub", read("c:\\keys\\id_rsa.pub"), SECRET],
      ["read id_ed25519", read("c:\\keys\\id_ed25519"), SECRET],
      ["read aws credentials", read("c:\\users\\u\\.aws\\credentials"), SECRET],
      ["read .npmrc", read("c:\\users\\u\\.npmrc"), SECRET],
      ["read .pypirc", read("c:\\users\\u\\.pypirc"), SECRET],
      ["read .netrc", read("c:\\users\\u\\.netrc"), SECRET],
      ["read claude credentials", read("c:\\users\\u\\.claude\\.credentials.json"), SECRET],
      ["read *secret* file", read("c:\\proj\\config\\app-secrets.json"), SECRET],
      ["read .env.example", read("c:\\proj\\.env.example"), ALLOW],
      ["read .env.sample", read("c:\\proj\\.env.sample"), ALLOW],
      ["read .env.template", read("c:\\proj\\.env.template"), ALLOW],
      ["keyboard.ts is not a .key file", read("c:\\proj\\src\\keyboard.ts"), ALLOW],
    ]);
  });

  it("protects Claude Code transcripts", () => {
    expectFiles([
      ["read a transcript", read("c:\\users\\u\\.claude\\projects\\p\\s.jsonl"), TRANSCRIPT],
      ["grep the transcripts dir", read("c:\\users\\u\\.claude\\projects"), TRANSCRIPT],
    ]);
  });

  it("protects the files that register and run the hooks", () => {
    expectFiles([
      ["write project local settings", write("c:\\proj\\.claude\\settings.local.json"), HOOK],
      ["write project settings", write("c:\\proj\\.claude\\settings.json"), HOOK],
      [
        "write user settings (disableAllHooks)",
        write("c:\\users\\u\\.claude\\settings.json"),
        HOOK,
      ],
      ["write verid's hook bundle", write("c:\\tools\\verid\\dist\\hook.js"), HOOK],
      ["read claude settings", read("c:\\users\\u\\.claude\\settings.json"), ALLOW],
      ["write a settings.json outside .claude", write("c:\\proj\\settings.json"), ALLOW],
      ["read verid's hook bundle", read("c:\\tools\\verid\\dist\\hook.js"), ALLOW],
      ["write verid's own source (dogfooding)", write("c:\\tools\\verid\\src\\hook.ts"), ALLOW],
    ]);
  });

  // A command file can grant tools (allowed-tools) and run shell lines when the developer runs it.
  it("protects the /verid commands verid adds to Claude Code's menu", () => {
    expectFiles([
      ["write a /verid command", write("c:\\proj\\.claude\\commands\\verid\\tip.md"), HOOK],
      ["write a user-level one", write("c:\\users\\u\\.claude\\commands\\verid\\menu.md"), HOOK],
      ["write the folder itself", write("c:\\proj\\.claude\\commands\\verid"), HOOK],
      ["read a /verid command", read("c:\\proj\\.claude\\commands\\verid\\tip.md"), ALLOW],
      ["write another command", write("c:\\proj\\.claude\\commands\\deploy.md"), ALLOW],
      ["write a look-alike", write("c:\\proj\\.claude\\commands\\verid-notes.md"), ALLOW],
    ]);
    expectBash([
      ["echo x > .claude/commands/verid/tip.md", HOOK],
      ["rm -r .claude\\commands\\verid", HOOK],
      ["cat .claude/commands/deploy.md", ALLOW],
      ["cat .claude/commands/verid-notes.md", ALLOW],
    ]);
  });

  // Claude Code takes a subagent's agent_type from the name its own file declares.
  it("denies writing agent definitions and plugins anywhere, but lets them be read", () => {
    expectFiles([
      ["project agent", write("c:\\proj\\.claude\\agents\\x.md"), HOOK],
      ["user agent", write("c:\\users\\u\\.claude\\agents\\y.md"), HOOK],
      ["plugin cache", write("c:\\users\\u\\.claude\\plugins\\cache\\p\\1.0\\agents\\a.md"), HOOK],
      ["plugin list", write("c:\\users\\u\\.claude\\plugins\\installed_plugins.json"), HOOK],
      ["mixed case", write("c:\\proj\\.Claude\\Agents\\x.md"), HOOK],
      ["read agent", read("c:\\proj\\.claude\\agents\\x.md"), ALLOW],
      ["docs agents", write("c:\\proj\\docs\\agents\\x.md"), ALLOW],
      ["similar name", write("c:\\proj\\.claude\\agents-notes.md"), ALLOW],
    ]);
  });

  it("denies Bash naming agent definitions or plugins", () => {
    expectBash([
      ["echo x > .claude/agents/r.md", HOOK],
      ["cp a.md ~/.claude/plugins/cache/x/agents/a.md", HOOK],
      ["echo agents plugins", ALLOW],
      ["cat .claude/agents-notes.md", ALLOW],
    ]);
  });

  // The adapter sets researchMissing and designMissing in prep and recipe while
  // .verid/research.md or .verid/design.md is not there.
  it("locks the plan until research, then a design, exist", () => {
    const plan = "c:\\proj\\.verid\\plan.md";
    const verdict = (a: Action, researchMissing: boolean, designMissing: boolean) => {
      const d = decide(a, { ...ctx, researchMissing, designMissing });
      return d.kind === "allow" ? ALLOW : d.code;
    };
    expect({
      "write the plan, no research nor design": verdict(write(plan), true, true),
      "write the plan, no design": verdict(write(plan), false, true),
      "write the plan, both written": verdict(write(plan), false, false),
      "read the plan, no research": verdict(read(plan), true, true),
      "write the research": verdict(write("c:\\proj\\.verid\\research.md"), true, true),
      "write the design": verdict(write("c:\\proj\\.verid\\design.md"), false, true),
    }).toEqual({
      "write the plan, no research nor design": "VERID_BURNT_PLAN_NO_RESEARCH",
      "write the plan, no design": "VERID_BURNT_PLAN_NO_DESIGN",
      "write the plan, both written": ALLOW,
      "read the plan, no research": ALLOW,
      "write the research": ALLOW,
      "write the design": ALLOW,
    });
  });

  it("lets ordinary source files be read and written", () => {
    expectFiles([
      ["write source", write("c:\\proj\\src\\a.ts"), ALLOW],
      ["read source", read("c:\\proj\\src\\a.ts"), ALLOW],
    ]);
  });
});

describe("decide: bash", () => {
  it("applies the file rules to the paths a Bash command names", () => {
    expectBash([
      ["cat .verid/.state/state.json", STATE],
      ["cat .env", SECRET],
      ["type C:\\proj\\.env.local", SECRET],
      ["cat .env.example", ALLOW],
      ["cat ~/.ssh/id_rsa", SECRET],
      ["type C:\\Users\\u\\.claude\\projects\\p\\s.jsonl", TRANSCRIPT],
      ["cat ~/.claude/projects/p/s.jsonl", TRANSCRIPT],
      ["echo x > .verid/manifest.yaml", MANIFEST],
      ["echo {} > .claude/settings.local.json", HOOK],
      ["type C:\\proj\\.Claude\\Settings.json", HOOK],
    ]);
  });

  it("blocks a nested claude session however it is spelled", () => {
    expectBash([
      ["claude -p hi", NESTED],
      ["npx claude -p hi", NESTED],
      ["C:\\tools\\claude.exe -p hi", NESTED],
      ["CLAUDE -p hi", NESTED],
      ["echo ok && claude", NESTED],
    ]);
  });

  it("reads quotes and backslash escapes the way sh joins words", () => {
    expectBash([
      ['cat .e""nv', SECRET],
      ["cat '.e'nv", SECRET],
      ["cat .e\\nv", SECRET],
      ["cat .verid/.st''ate/state.json", STATE],
      ['cat ~/.claude/pro"jects"/p/s.jsonl', TRANSCRIPT],
      ['echo {} > .claude/sett"ings".json', HOOK],
      ['echo x > .verid/manifest.y"a"ml', MANIFEST],
      ['cl""aude -p hi', NESTED],
    ]);
  });

  // The developer's commands refuse only when CLAUDECODE=1, so the agent may not reach them,
  // nor through the shims `npm link` makes on Windows or the bare entry point (`node dist/cli`).
  it("keeps the developer's verid commands and CLAUDECODE out of the agent's Bash", () => {
    expectBash([
      ["CLAUDECODE=0 verid order", DEVELOPER],
      ["env -u CLAUDECODE verid stock", DEVELOPER],
      ['node "C:/x/verid/dist/cli.js" order', DEVELOPER],
      ["verid garnish", DEVELOPER],
      ["verid cook --mode prep", DEVELOPER],
      ["verid upgrade --yes", DEVELOPER],
      ["verid.cmd upgrade --dry-run", DEVELOPER],
      ['node "C:/x/verid/dist/cli.js" upgrade', DEVELOPER],
      ["node dist/cli upgrade", DEVELOPER],
      ['ver""id order', DEVELOPER],
      ["npx verid stock && npm test", DEVELOPER],
      ["echo $CLAUDECODE", DEVELOPER],
      ["verid.cmd order", DEVELOPER],
      ["verid serve auth", DEVELOPER],
      ["node dist/cli serve auth", DEVELOPER],
      ["verid.ps1 stock", DEVELOPER],
      ["node_modules/.bin/verid.cmd order", DEVELOPER],
      ["cmd /c verid.cmd order", DEVELOPER],
      ['cmd //c "@verid stock"', DEVELOPER],
      ['cmd //c ",verid stock"', DEVELOPER],
      ['cmd //c "=verid order"', DEVELOPER],
      ["cmd.exe /c @verid.cmd serve x", DEVELOPER],
      ["node dist/cli order", DEVELOPER],
      ['env -i PATH="$PATH" node dist/cli order', DEVELOPER],
      [
        'cd node_modules/@anhtranhai835/verid/dist && env -i PATH="$PATH" node cli.js stock',
        DEVELOPER,
      ],
      ["node cli.js stock", DEVELOPER],
      ["node ./cli.js order", DEVELOPER],
      ["node cli serve auth", DEVELOPER],
      ["node dist//cli.js order", DEVELOPER],
      ["node dist/./cli.js stock", DEVELOPER],
      ['env -i PATH="$PATH" node cli.js order', DEVELOPER],
      ["npx expo-cli upgrade", DEVELOPER],
      ["npx @vue/cli upgrade", DEVELOPER],
      ["npx @vue/cli.js upgrade", DEVELOPER],
      ["other-verid upgrade", DEVELOPER],
    ]);
  });

  // The agent's Bash inherits CLAUDE_CODE_SESSION_ATTENDED: a prompt piped into the hook by hand
  // would show it the confirmation code and let it grant itself an override.
  it("keeps verid's hook out of the agent's Bash", () => {
    expectBash([
      [`echo '{"prompt":"/verid:tip x"}' | node dist/hook.js`, DEVELOPER],
      ['node "C:/x/verid/dist/hook.js" < p.json', DEVELOPER],
      ["node C:\\x\\verid\\dist\\hook.js < p.json", DEVELOPER],
      ["node dist/hook < p.json", DEVELOPER],
      ["cd dist && node hook.js < p.json", DEVELOPER],
      ["ls .git/hooks", ALLOW],
      ["node dist/hooks/x.js", ALLOW],
    ]);
  });

  it("lets the agent run verid taste and peek, and ordinary commands", () => {
    expectBash([
      ["verid.cmd taste", ALLOW],
      ["node dist/cli taste", ALLOW],
      ["verid taste", ALLOW],
      ["verid peek", ALLOW],
      ['node "C:/x/verid/dist/cli.js" taste', ALLOW],
      ['node "C:/x/verid/dist/cli.js" peek', ALLOW],
      ["npx vitest run", ALLOW],
      ["echo order", ALLOW],
      ["verid testing cook", ALLOW],
      ['echo "a" "b"', ALLOW],
      ["cat CLAUDE.md", ALLOW],
      ["ls ~/.claude/", ALLOW],
      ["git status", ALLOW],
      ["npm test", ALLOW],
    ]);
  });

  it("lets an invariant found only once quotes are removed win over an overridable rule", () => {
    expectBash([['cat .verid/manifest.yaml .e""nv', SECRET]]);
  });

  it("leaves bare directory writes to the hook's path-aware Bash checks", () => {
    expectBash([["rm -r .verid", ALLOW]]);
    expect(bashWriteTargets("rm -r .verid")).toContain(".verid");
  });
});

describe("decide: other tools", () => {
  it("allows tools outside the rule set", () => {
    expect(decide({ kind: "other", tool: "WebFetch" }, ctx).kind).toBe("allow");
  });

  it("denies the shells verid cannot read, naming the tool", () => {
    for (const tool of ["PowerShell", "mcp__terminal__run_in_terminal"])
      expect(decide({ kind: "shell", tool }, ctx)).toMatchObject({
        kind: "deny",
        code: "VERID_BURNT_SHELL_UNSUPPORTED",
        target: tool,
      });
  });
});

describe("decide: rules the developer allowed", () => {
  it("lets each allowed rule give way to the next one", () => {
    const claude: Action = { kind: "bash", command: "cat .verid/manifest.yaml | claude -p fix" };
    const rows: [string, Action, RuleCode[], string][] = [
      ["manifest allowed, claude next", claude, [MANIFEST], NESTED],
      ["manifest and claude allowed", claude, [MANIFEST, NESTED], ALLOW],
      ["manifest write allowed", write(ctx.manifestPath), [MANIFEST], ALLOW],
      [
        "research allowed, design next",
        write(ctx.planPath),
        ["VERID_BURNT_PLAN_NO_RESEARCH"],
        "VERID_BURNT_PLAN_NO_DESIGN",
      ],
      [
        "shell allowed",
        { kind: "shell", tool: "PowerShell" },
        ["VERID_BURNT_SHELL_UNSUPPORTED"],
        ALLOW,
      ],
    ];
    const missing = { ...ctx, researchMissing: true, designMissing: true };
    const verdict = (a: Action, lifted: RuleCode[]) => {
      const d = decide(a, missing, new Set(lifted));
      return d.kind === "allow" ? ALLOW : d.code;
    };
    expect(Object.fromEntries(rows.map(([n, a, lifted]) => [n, verdict(a, lifted)]))).toEqual(
      Object.fromEntries(rows.map(([n, , , want]) => [n, want])),
    );
  });
});

describe("bashWriteTargets: files a Bash command plainly writes", () => {
  const targets = (rows: [string, string[]][]) =>
    expect(
      Object.fromEntries(rows.map(([c]) => [c, [...new Set(bashWriteTargets(c))].sort()])),
    ).toEqual(Object.fromEntries(rows.map(([c, want]) => [c, [...want].sort()])));

  it("finds the targets of redirects and of the commands that write files", () => {
    targets([
      ["echo x > src/a.ts", ["src/a.ts"]],
      ["echo x >> src/a.ts", ["src/a.ts"]],
      ["npm test 2>&1 | tee -a out.log", ["out.log"]],
      ["ls > /dev/null 2>&1", ["/dev/null"]],
      ["sed -i 's/a/b/' src/a.ts", ["s/a/b/", "src/a.ts"]],
      ["perl -pi -e 's/a/b/' src/a.ts", ["s/a/b/", "src/a.ts"]],
      ["cp -r tmp/a.ts src", ["src", "src/a.ts"]],
      ["mv src/a.ts tmp", ["src/a.ts", "tmp", "tmp/a.ts"]],
      ["rm -f src/a.ts", ["src/a.ts"]],
      ["/usr/bin/touch src/new.ts", ["src/new.ts"]],
      ["git add . && touch src/b.ts; echo done", ["src/b.ts"]],
    ]);
  });

  it("reads quotes, and treats heredoc bodies as data", () => {
    targets([
      ['echo x > src/a""b.ts', ["src/ab.ts"]],
      // A heredoc body is data: its `=>` is not a redirect.
      ["cat > src/a.ts <<'EOF'\nexport const f = (a) => a;\nEOF", ["src/a.ts"]],
      ["cat <<EOF > src/a.ts\nx\nEOF", ["src/a.ts"]],
    ]);
  });

  // An operator or a blank inside quotes is part of the word, so it cannot end the command early.
  it("keeps what is quoted in one word, operators and blanks included", () => {
    targets([
      [
        "sed -i 's/toBe(2)/toBe(undefined)/' test/sub.test.js",
        ["s/toBe(2)/toBe(undefined)/", "test/sub.test.js"],
      ],
      ["sed -i 's/a|b/c/' test/a.test.js", ["s/a|b/c/", "test/a.test.js"]],
      ["sed -i 's/;//' test/a.test.js", ["s/;//", "test/a.test.js"]],
      ["sed -i 's/&/x/' test/a.test.js", ["s/&/x/", "test/a.test.js"]],
      ["perl -pi -e 's/(2)/3/' test/a.test.js", ["s/(2)/3/", "test/a.test.js"]],
      ["cp 'x(1).js' test/a.test.js", ["test/a.test.js", "test/a.test.js/x(1).js"]],
      ['echo x > "src/my file.ts"', ["src/my file.ts"]],
      ['git commit -m "a > src/b.ts"', []],
    ]);
  });

  it("finds nothing in commands that only read", () => {
    targets([
      ["sed 's/a/b/' src/a.ts", []],
      ["cat src/a.ts", []],
      ["grep -rn add src < /dev/null", []],
      ['git commit -m "refactor src/a.ts"', []],
    ]);
  });

  it("finds files written by inline node or python code, and through variables", () => {
    const rows: [string, string][] = [
      [`node -e "require('fs').writeFileSync('src/a.ts', 'x')"`, "src/a.ts"],
      [`python3 -c "open('src/a.py', 'w').write('x')"`, "src/a.py"],
      [`python -c "import pathlib; pathlib.Path('src/a.py').write_text('x')"`, "src/a.py"],
      [`node -e "require('fs').rmSync('src/a.ts')"`, "src/a.ts"],
      ['f=src/a.ts; echo x > "$f"', "src/a.ts"],
      ["export F=src/a.ts && cat > ${F} <<'X'\nx\nX", "src/a.ts"],
    ];
    for (const [command, path] of rows) expect(bashWriteTargets(command), command).toContain(path);
  });

  it("finds no source writes in inline code or variables that only read", () => {
    for (const command of [
      `node -e "console.log(require('./src/a.ts'))"`,
      `python -c "print(open('src/a.py').read())"`,
      'f=src/a.ts; cat "$f"',
    ])
      expect(
        bashWriteTargets(command).filter((t) => t.startsWith("src")),
        command,
      ).toEqual([]);
  });
});

describe("mcpPaths and mcpAccess: what an MCP tool touches", () => {
  it("reads paths from path-like keys only", () => {
    const rows: [string, unknown, string[]][] = [
      ["path", { path: "/p/.env" }, ["/p/.env"]],
      ["a list of paths", { paths: ["a.ts", "b.ts"] }, ["a.ts", "b.ts"]],
      ["source and destination", { source: "a", destination: "b" }, ["a", "b"]],
      ["camelCase keys", { filePath: "x", targetPath: "y" }, ["x", "y"]],
      ["a URI", { uri: "file:///p/.env" }, ["file:///p/.env"]],
      [
        "nested edits, whose texts are not paths",
        { path: "src/a.ts", edits: [{ oldText: "secret", newText: "x" }] },
        ["src/a.ts"],
      ],
      ["file contents", { content: "my secret", file_text: "x", path: "" }, []],
      ["a multi-line value", { path: "a\nb" }, []],
    ];
    expect(Object.fromEntries(rows.map(([name, input]) => [name, mcpPaths(input)]))).toEqual(
      Object.fromEntries(rows.map(([name, , want]) => [name, want])),
    );
  });

  it("counts a tool as a write when its name says so", () => {
    expect({
      mcp__filesystem__read_file: mcpAccess("mcp__filesystem__read_file"),
      mcp__filesystem__list_directory: mcpAccess("mcp__filesystem__list_directory"),
      mcp__filesystem__write_file: mcpAccess("mcp__filesystem__write_file"),
      mcp__filesystem__edit_file: mcpAccess("mcp__filesystem__edit_file"),
      mcp__filesystem__move_file: mcpAccess("mcp__filesystem__move_file"),
      mcp__filesystem__create_directory: mcpAccess("mcp__filesystem__create_directory"),
      mcp__github__search_code: mcpAccess("mcp__github__search_code"),
    }).toEqual({
      mcp__filesystem__read_file: "read",
      mcp__filesystem__list_directory: "read",
      mcp__filesystem__write_file: "write",
      mcp__filesystem__edit_file: "write",
      mcp__filesystem__move_file: "write",
      mcp__filesystem__create_directory: "write",
      mcp__github__search_code: "read",
    });
  });
});
