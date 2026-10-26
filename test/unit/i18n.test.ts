import { describe, expect, it } from "vitest";
import { t, veridCommand } from "../../src/adapters/i18n.js";

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
  it("keeps tester-only messages unchanged without mentioning qa", () => {
    const rows = [
      [
        "en",
        "src/foo.test.ts is a test: only the tester (custom:tester) writes tests, and this call came from main. An agent in `roles` that Claude Code cannot find is not installed: verid's own install with `claude plugin marketplace add anhtranhai835/verid`, then `claude plugin install verid@verid`.",
      ],
      [
        "vi",
        "src/foo.test.ts là test: chỉ tester (custom:tester) được ghi test, mà lần gọi này đến từ main. Agent trong `roles` mà Claude Code không tìm thấy là agent chưa được cài: agent của verid cài bằng `claude plugin marketplace add anhtranhai835/verid`, rồi `claude plugin install verid@verid`.",
      ],
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

  it("keeps the original session instructions for legacy roles in both languages", () => {
    const rows = [
      [
        "en",
        "Dispatch the mapped agents, not general-purpose, for these roles (superpowers:subagent-driven-development): the tester writes the failing test, the coder makes it pass, the reviewer reviews a module once its ACs pass. The hook keeps each to its own files, and records the reviewer's final report as the review `verid serve` asks for.",
      ],
      [
        "vi",
        "Gọi đúng các agent đã ánh xạ cho các vai trò này, đừng gọi general-purpose (superpowers:subagent-driven-development): tester viết test fail, coder làm nó pass, reviewer review một module khi mọi AC của nó đã pass. Hook giữ mỗi agent trong phần file của nó, và ghi báo cáo cuối của reviewer làm bản review mà `verid serve` cần.",
      ],
    ] as const;
    expect(rows.map(([lang]) => t(lang, "session.roles", { verid: "verid" }))).toEqual(
      rows.map(([, want]) => want),
    );
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
