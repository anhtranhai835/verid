import { describe, expect, it } from "vitest";
import { decide, type Action, type PolicyContext } from "../../src/core/policy.js";

// Paths arrive already normalized by the adapter (absolute, lowercase on win32).
const ctx: PolicyContext = {
  stateDir: "c:\\proj\\.verid\\.state",
  manifestPath: "c:\\proj\\.verid\\manifest.yaml",
  transcriptsDir: "c:\\users\\u\\.claude\\projects",
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
const bash = (command: string): Action => ({ kind: "bash", command });

const ALLOW = "allow";

describe("decide: file tools", () => {
  it.each([
    ["write state file", write("c:\\proj\\.verid\\.state\\state.json"), "VERID_E_STATE_PROTECTED"],
    [
      "read state file (holds the pending confirmation code)",
      read("c:\\proj\\.verid\\.state\\state.json"),
      "VERID_E_STATE_PROTECTED",
    ],
    ["write the state dir itself", write("c:\\proj\\.verid\\.state"), "VERID_E_STATE_PROTECTED"],
    ["sibling with same prefix", write("c:\\proj\\.verid\\.statefoo\\x"), ALLOW],
    ["write source", write("c:\\proj\\src\\a.ts"), ALLOW],
    ["read source", read("c:\\proj\\src\\a.ts"), ALLOW],
    ["write manifest", write("c:\\proj\\.verid\\manifest.yaml"), "VERID_E_MANIFEST_PROTECTED"],
    ["read manifest", read("c:\\proj\\.verid\\manifest.yaml"), ALLOW],
    ["read .env", read("c:\\proj\\.env"), "VERID_E_SECRET_PROTECTED"],
    ["write .env", write("c:\\proj\\.env"), "VERID_E_SECRET_PROTECTED"],
    ["read .env.local", read("c:\\proj\\.env.local"), "VERID_E_SECRET_PROTECTED"],
    ["read .env.example", read("c:\\proj\\.env.example"), ALLOW],
    ["read .env.sample", read("c:\\proj\\.env.sample"), ALLOW],
    ["read .env.template", read("c:\\proj\\.env.template"), ALLOW],
    ["read pem", read("c:\\proj\\certs\\server.pem"), "VERID_E_SECRET_PROTECTED"],
    ["read key", read("c:\\proj\\certs\\tls.key"), "VERID_E_SECRET_PROTECTED"],
    ["read p12", read("c:\\proj\\cert.p12"), "VERID_E_SECRET_PROTECTED"],
    ["read pfx", read("c:\\proj\\cert.pfx"), "VERID_E_SECRET_PROTECTED"],
    ["read ssh config", read("c:\\users\\u\\.ssh\\config"), "VERID_E_SECRET_PROTECTED"],
    ["grep the .ssh dir", read("c:\\users\\u\\.ssh"), "VERID_E_SECRET_PROTECTED"],
    ["read id_rsa.pub", read("c:\\keys\\id_rsa.pub"), "VERID_E_SECRET_PROTECTED"],
    ["read id_ed25519", read("c:\\keys\\id_ed25519"), "VERID_E_SECRET_PROTECTED"],
    ["read aws credentials", read("c:\\users\\u\\.aws\\credentials"), "VERID_E_SECRET_PROTECTED"],
    ["read .npmrc", read("c:\\users\\u\\.npmrc"), "VERID_E_SECRET_PROTECTED"],
    ["read .pypirc", read("c:\\users\\u\\.pypirc"), "VERID_E_SECRET_PROTECTED"],
    ["read .netrc", read("c:\\users\\u\\.netrc"), "VERID_E_SECRET_PROTECTED"],
    [
      "read claude credentials",
      read("c:\\users\\u\\.claude\\.credentials.json"),
      "VERID_E_SECRET_PROTECTED",
    ],
    ["read *secret* file", read("c:\\proj\\config\\app-secrets.json"), "VERID_E_SECRET_PROTECTED"],
    ["keyboard.ts is not a .key file", read("c:\\proj\\src\\keyboard.ts"), ALLOW],
    [
      "read a transcript",
      read("c:\\users\\u\\.claude\\projects\\p\\s.jsonl"),
      "VERID_E_TRANSCRIPT_PROTECTED",
    ],
    [
      "grep the transcripts dir",
      read("c:\\users\\u\\.claude\\projects"),
      "VERID_E_TRANSCRIPT_PROTECTED",
    ],
    ["read claude settings", read("c:\\users\\u\\.claude\\settings.json"), ALLOW],
  ])("%s", (_name, action, expected) => {
    const d = decide(action, ctx);
    expect(d.kind === "allow" ? ALLOW : d.code).toBe(expected);
  });
});

describe("decide: bash", () => {
  it.each([
    ["cat .verid/.state/state.json", "VERID_E_STATE_PROTECTED"],
    ["cat .env", "VERID_E_SECRET_PROTECTED"],
    ["type C:\\proj\\.env.local", "VERID_E_SECRET_PROTECTED"],
    ["cat .env.example", ALLOW],
    ["cat ~/.ssh/id_rsa", "VERID_E_SECRET_PROTECTED"],
    ["type C:\\Users\\u\\.claude\\projects\\p\\s.jsonl", "VERID_E_TRANSCRIPT_PROTECTED"],
    ["cat ~/.claude/projects/p/s.jsonl", "VERID_E_TRANSCRIPT_PROTECTED"],
    ["echo x > .verid/manifest.yaml", "VERID_E_MANIFEST_PROTECTED"],
    ["claude -p hi", "VERID_E_BASH_NESTED_CLAUDE"],
    ["npx claude -p hi", "VERID_E_BASH_NESTED_CLAUDE"],
    ["C:\\tools\\claude.exe -p hi", "VERID_E_BASH_NESTED_CLAUDE"],
    ["CLAUDE -p hi", "VERID_E_BASH_NESTED_CLAUDE"],
    ["echo ok && claude", "VERID_E_BASH_NESTED_CLAUDE"],
    ["cat CLAUDE.md", ALLOW],
    ["ls ~/.claude/", ALLOW],
    ["git status", ALLOW],
    ["npm test", ALLOW],
    // Known Phase 0 limit: deleting .verid is not blocked here; it removes state, so every action then fails closed.
    ["rm -r .verid", ALLOW],
  ])("%s", (command, expected) => {
    const d = decide(bash(command), ctx);
    expect(d.kind === "allow" ? ALLOW : d.code).toBe(expected);
  });
});

describe("decide: other tools", () => {
  it("allows tools outside the Phase 0 rule set", () => {
    expect(decide({ kind: "other", tool: "WebFetch" }, ctx).kind).toBe("allow");
  });
});
