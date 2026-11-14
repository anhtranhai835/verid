import { describe, expect, it } from "vitest";
import { systemLanguage, t, veridCommand } from "../../src/adapters/i18n.js";
import en from "../../i18n/en.json" with { type: "json" };
import vi from "../../i18n/vi.json" with { type: "json" };

describe("provider status messages", () => {
  it("describes current Codex enforcement without development plan labels", () => {
    const rows = [
      ["en", "/hooks"],
      ["vi", "/hooks"],
    ] as const;
    for (const [lang, notice] of rows) {
      for (const key of [
        "cook.codex_trust",
        "cook.codex_served",
        "doctor.codex.retrust",
      ] as const) {
        const message = t(lang, key, {});
        expect(message).toContain(notice);
        expect(message).not.toMatch(/(?:part|phase|phần)\s+\d+[a-z]?\b/i);
      }
    }
  });
});

describe("missing manifest message", () => {
  it("points to cook in both languages and does not name another command as the reason", () => {
    for (const lang of ["en", "vi"] as const) {
      const message = t(lang, "VERID_BURNT_MANIFEST_MISSING", { path: "p", verid: "verid" });
      expect(message).toContain("verid cook --mode <prep|recipe|remix>");
      expect(message).not.toContain("taste");
    }
  });
});

describe("hook protection messages", () => {
  it("names all command definitions rather than only verid commands in both languages", () => {
    const rows = [
      ["en", "command definitions"],
      ["vi", "định nghĩa lệnh"],
    ] as const;
    for (const [lang, notice] of rows)
      expect(t(lang, "VERID_BURNT_HOOK_PROTECTED", { target: "x" })).toContain(notice);
  });
});

describe("legacy role messages", () => {
  it("names the mapped tester and caller without repeating installation instructions", () => {
    const rows = [
      [
        "en",
        "src/foo.test.ts is a test: only tester (custom:tester) writes it; this call came from main.",
      ],
      ["vi", "src/foo.test.ts là test: chỉ tester (custom:tester) được ghi; lần gọi này từ main."],
    ] as const;
    expect(
      rows.map(([lang]) =>
        t(lang, "VERID_BURNT_ROLE_TESTER_ONLY", {
          target: "src/foo.test.ts",
          tester: "custom:tester",
          writer: "main",
          qa: "—",
        }),
      ),
    ).toEqual(rows.map(([, want]) => want));
  });

  it("keeps the original cook installation note for legacy roles in both languages", () => {
    const rows = [
      [
        "en",
        "Roles: the manifest maps verid's own agents (verid:tester, verid:coder, verid:reviewer), so the main conversation dispatches them to write tests and code, and `verid serve` asks for the reviewer's report. Install them once on this machine: `claude plugin marketplace add anhtranhai835/verid`, then `claude plugin install verid@verid`. Any other agent can fill a role: map it in `roles`.",
      ],
      [
        "vi",
        "Vai trò: manifest ánh xạ các agent của chính verid (verid:tester, verid:coder, verid:reviewer), nên luồng chính gọi chúng để viết test và code, và `verid serve` cần báo cáo của reviewer. Cài chúng một lần trên máy này: `claude plugin marketplace add anhtranhai835/verid`, rồi `claude plugin install verid@verid`. Agent nào khác cũng nhận được vai trò: ánh xạ nó trong `roles`.",
      ],
    ] as const;
    expect(rows.map(([lang]) => t(lang, "cook.roles", { verid: "verid" }))).toEqual(
      rows.map(([, want]) => want),
    );
  });

  it("describes qa write permissions only by e2e_globs in both languages", () => {
    const rows = [
      [
        "en",
        "src/foo.test.ts: qa (custom:qa) writes only end-to-end tests: paths matching e2e_globs. This call came from custom:qa. The TDD gate still applies.",
      ],
      [
        "vi",
        "src/foo.test.ts: qa (custom:qa) chỉ ghi test end-to-end: đường dẫn khớp e2e_globs. Lần gọi này đến từ custom:qa. Cổng TDD vẫn áp dụng.",
      ],
    ] as const;
    expect(
      rows.map(([lang]) =>
        t(lang, "VERID_BURNT_ROLE_QA_E2E_ONLY", {
          target: "src/foo.test.ts",
          qa: "custom:qa",
          writer: "custom:qa",
        }),
      ),
    ).toEqual(rows.map(([, want]) => want));
  });
});

describe("veridCommand: how messages name the CLI", () => {
  it("says verid when the verid on PATH is this install, else the command that runs as is", () => {
    // npm's global shims: next to node_modules on Windows, in ../bin on Linux and macOS.
    const shims = new Set(["C:/Users/u/AppData/Roaming/npm/verid.cmd", "/usr/local/bin/verid"]);
    const name = (cli: string) => veridCommand(cli, (path) => shims.has(path));
    expect({
      "npm global, Windows": name(
        "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@anhtranhai835\\verid\\dist\\cli.js",
      ),
      "npm global, Linux": name("/usr/local/lib/node_modules/@anhtranhai835/verid/dist/cli.js"),
      "a project's own install": name("C:/proj/node_modules/@anhtranhai835/verid/dist/cli.js"),
      "a clone": name("C:\\src\\verid\\dist\\cli.js"),
    }).toEqual({
      "npm global, Windows": "verid",
      "npm global, Linux": "verid",
      "a project's own install": 'node "C:/proj/node_modules/@anhtranhai835/verid/dist/cli.js"',
      "a clone": 'node "C:/src/verid/dist/cli.js"',
    });
  });
});

describe("systemLanguage: the language a new machine's messages use", () => {
  it("reads LC_ALL, LC_MESSAGES and LANG before the runtime locale, Vietnamese or else English", () => {
    const rows = [
      { env: { LC_ALL: "vi_VN.UTF-8" }, intl: "en-US", want: "vi" },
      { env: { LC_MESSAGES: "vi_VN" }, intl: "en-US", want: "vi" },
      { env: { LANG: "vi" }, intl: "en-US", want: "vi" },
      { env: { LC_ALL: "en_US.UTF-8", LANG: "vi_VN" }, intl: "vi-VN", want: "en" },
      { env: { LC_ALL: "", LANG: "fr_FR.UTF-8" }, intl: "vi-VN", want: "en" },
      { env: {}, intl: "vi-VN", want: "vi" },
      { env: {}, intl: "en-GB", want: "en" },
    ];
    expect(rows.map(({ env, intl }) => systemLanguage(env, intl))).toEqual(
      rows.map(({ want }) => want),
    );
  });
});

describe("agent-facing message length", () => {
  // Denials, stop holds, session context and next steps reach the agent on every turn they fire.
  const AGENT_FACING = /^(VERID_BURNT_|stop\.|session\.|taste\.|auto\.|status\.)/;
  const CAP = 320;

  it("keeps every agent-facing template within 320 characters in both languages", () => {
    const over = Object.entries({ en, vi }).flatMap(([lang, catalog]) =>
      Object.entries(catalog as Record<string, string>)
        .filter(([key, text]) => AGENT_FACING.test(key) && [...text].length > CAP)
        .map(([key, text]) => `${lang} ${key} ${[...text].length}`),
    );
    expect(over).toEqual([]);
  });

  it("still names the next command or action in the messages that were shortened", () => {
    const shortened = [
      "VERID_BURNT_AUTO_WAITING_MERGE",
      "VERID_BURNT_PLAN_NOT_APPROVED",
      "VERID_BURNT_AUTO_BRANCH",
      "VERID_BURNT_RUN_NO_RUNNER",
      "VERID_BURNT_GIT_UNRESOLVED",
      "VERID_BURNT_GIT_WORK_BASE",
      "VERID_BURNT_HOOK_PROTECTED",
      "VERID_BURNT_TDD_NO_FAILING_TEST",
      "VERID_BURNT_AUTO_NO_MODULE",
      "VERID_BURNT_GIT_MAIN_COMMIT",
      "VERID_BURNT_RUN_RUNNER_GONE",
      "VERID_BURNT_PLAN_MISSING",
      "VERID_BURNT_PLAN_INVALID",
      "auto.plan",
      "auto.commit",
      "auto.security",
      "auto.waiting_merge",
      "auto.done",
      "auto.stuck.no_progress",
      "taste.not_compiled",
      "status.stub",
    ];
    // A next step is a code span naming a command or file, or an instruction to stop or leave it.
    const next = /^(Next|Tiếp theo): |`[^`]+`|stop here|dừng ở đây|developer/i;
    const missing = Object.entries({ en, vi }).flatMap(([lang, catalog]) =>
      shortened
        .filter((key) => !next.test((catalog as Record<string, string>)[key] ?? ""))
        .map((key) => `${lang} ${key}`),
    );
    expect(missing).toEqual([]);
  });
});
