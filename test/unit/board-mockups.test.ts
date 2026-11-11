import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tempProject, kanbanManifest, readyModulePlan } from "../support/project.js";
import { startBoard } from "../../src/cli/board.js";
import { boardHtml } from "../../src/cli/board-page.js";
import { MODULE_INPUTS, readPlan } from "../../src/adapters/plan-file.js";
import { parsePlan } from "../../src/core/plan.js";

let board: Awaited<ReturnType<typeof startBoard>>;
const base = ".verid/artifacts/03-modules/screen/ui/mockups";
const p = tempProject("verid-mockups-", {
  manifest: kanbanManifest,
  state: { schemaVersion: 1, language: "en" },
  setup: (p) => {
    p.put(".verid/research.md", "Agreed research");
    p.put(".verid/design.md", "Agreed design");
    p.put(".verid/spec.md", "- REQ-1: A screen\n");
    p.put(
      ".verid/plan.md",
      readyModulePlan(p.root, "## Module: screen\n- AC-1: A screen (REQ-1)\n"),
    );
    for (const name of ["a", "b", "c"]) p.put(`${base}/option-${name}.html`, `<h1>${name}</h1>`);
    p.put(`${base}/private.txt`, "private");
  },
});
beforeEach(async () => {
  board = await startBoard(p.root, async () => ({ exit: 0, stdout: "", stderr: "" }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  board.server.closeAllConnections();
  await new Promise<void>((resolve) => board.server.close(() => resolve()));
});
const snapshot = async () =>
  (
    await fetch(`${board.origin}/api/board`, {
      headers: { Authorization: `Bearer ${board.token}` },
    })
  ).json();
const action = async (extra: Record<string, unknown>) =>
  fetch(`${board.origin}/api/action`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${board.token}`,
      Origin: board.origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ revision: (await snapshot()).revision, module: "screen", ...extra }),
  });
const ticket = async (file = "option-a.html") => {
  const res = await action({ action: "mockup-token", file });
  expect(res.status).toBe(200);
  return (await res.json()).url as string;
};

it("requires a file-bound one-use ticket even with board credentials and expires it", async () => {
  const path = "/mockups/screen/option-a.html";
  for (const suffix of ["", "?token=wrong"])
    expect(
      (
        await fetch(board.origin + path + suffix, {
          headers: { Authorization: `Bearer ${board.token}` },
        })
      ).status,
    ).toBe(401);
  expect(
    (await fetch(board.origin + path, { headers: { Cookie: `verid_board=${board.token}` } }))
      .status,
  ).toBe(401);
  expect(
    (
      await fetch(`${board.origin}/api/board`, {
        headers: { Cookie: `verid_board=${board.token}`, Origin: "null" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${board.origin}/api/action`, {
        method: "POST",
        headers: { Origin: board.origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mockup-token", module: "screen", file: "option-a.html" }),
      })
    ).status,
  ).toBe(401);
  const url = await ticket();
  expect((await fetch(board.origin + url.replace("option-a.html", "option-b.html"))).status).toBe(
    401,
  );
  const fresh = await ticket();
  expect((await fetch(board.origin + fresh)).status).toBe(200);
  expect((await fetch(board.origin + fresh)).status).toBe(401);
  const expires = await ticket();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
  expect((await fetch(board.origin + expires)).status).toBe(401);
});

it("serves only confined HTML with sandbox and no-referrer headers", async () => {
  const res = await fetch(board.origin + (await ticket()));
  expect(await res.text()).toBe("<h1>a</h1>");
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("content-security-policy")).toContain("sandbox allow-scripts;");
  expect(res.headers.get("content-security-policy")).toContain("default-src 'unsafe-inline' data:");
  expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("cache-control")).toBe("no-store");
  for (const file of [
    "../private.html",
    "/private.html",
    "C:\\private.html",
    "private.txt",
    "missing.html",
    "..%2fprivate.html",
  ])
    expect((await action({ action: "mockup-token", file })).status).toBe(404);
  for (const file of [
    "..%2fprivate.html",
    "%2fprivate.html",
    "C%3A%5Cprivate.html",
    "private.txt",
    "missing.html",
  ])
    expect((await fetch(`${board.origin}/mockups/screen/${file}`)).status).toBe(404);
  expect(
    (await action({ action: "mockup-token", module: "../screen", file: "option-a.html" })).status,
  ).toBe(404);
});

it("includes choice creation, replacement and removal in the module signature", () => {
  const hash = () => {
    const plan = readPlan(p.root, false, true);
    if (!plan?.ok) throw new Error("Fixture must have a ready module");
    return plan.hashes.screen;
  };
  const original = hash();
  const parsed = parsePlan(p.read(".verid/plan.md"));
  if (!parsed.ok) throw new Error("Fixture must parse");
  const previous = createHash("sha256").update(parsed.modules[0]!.text);
  for (const input of MODULE_INPUTS)
    previous
      .update("\0")
      .update(input)
      .update("\0")
      .update(p.read(`.verid/artifacts/03-modules/screen/${input}`));
  expect(original).toBe(previous.digest("hex"));
  p.put(`${base}/choice.json`, JSON.stringify({ choice: "option-a", note: "", at: "2026-01-01" }));
  const first = hash();
  expect(first).not.toBe(original);
  p.put(
    `${base}/choice.json`,
    JSON.stringify({ choice: "option-b", note: "spacing", at: "2026-01-02" }),
  );
  expect(hash()).not.toBe(first);
  rmSync(p.path(`${base}/choice.json`));
  expect(hash()).toBe(original);
});

it("rechecks confinement after ticket issuance and refuses linked directories", async () => {
  const url = await ticket();
  rmSync(p.path(base), { recursive: true });
  mkdirSync(p.path("outside"));
  p.put("outside/option-a.html", "outside");
  symlinkSync(p.path("outside"), p.path(base), process.platform === "win32" ? "junction" : "dir");
  expect((await fetch(board.origin + url)).status).toBe(404);
  expect((await action({ action: "mockup-token", file: "option-a.html" })).status).toBe(404);
});

it("lists three options and replaces a valid choice without accepting missing options or linked choices", async () => {
  const task = (await snapshot()).tasks[0];
  expect(task.mockups.files).toEqual(["option-a.html", "option-b.html", "option-c.html"]);
  expect(task.mockups.choice).toBeNull();
  expect((await action({ action: "mockup-choice", choice: "missing", note: "" })).status).toBe(400);
  for (const choice of ["option-a", "option-b"]) {
    const before = (await snapshot()).revision;
    expect((await action({ action: "mockup-choice", choice, note: "Prefer spacing" })).status).toBe(
      200,
    );
    expect(JSON.parse(p.read(`${base}/choice.json`))).toEqual({
      choice,
      note: "Prefer spacing",
      at: expect.stringMatching(/^\d{4}-/),
    });
    expect((await snapshot()).revision).not.toBe(before);
    expect((await snapshot()).tasks[0].mockups.choice.choice).toBe(choice);
  }
  rmSync(p.path(`${base}/choice.json`));
  symlinkSync(
    p.path("outside-choice"),
    p.path(`${base}/choice.json`),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect((await action({ action: "mockup-choice", choice: "option-a", note: "" })).status).toBe(
    400,
  );
});

it("provides a conditional Mockup tab with isolated frames and a note in both drives and languages", () => {
  for (const lang of ["en", "vi"] as const)
    for (const drive of ["human", "auto"] as const) {
      const html = boardHtml(lang, drive);
      expect(() => new Script(html.split("<script>")[1]!.split("</script>")[0]!)).not.toThrow();
      expect(html).toContain('id="mockup-tab"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab" aria-controls="mockup-panel"');
      expect(html).toContain('id="mockup-panel" role="tabpanel" aria-labelledby="mockup-tab"');
      for (const label of lang === "vi"
        ? ["Chi tiết", "Ghi chú (không bắt buộc)", "Phương án đã chọn", "Đang tải bản xem trước"]
        : ["Details", "Note (optional)", "Selected option", "Loading preview"])
        expect(html).toContain(label);
      expect(html).toContain("task.mockups.files.length");
      expect(html).toContain("setAttribute('sandbox','allow-scripts')");
      expect(html).not.toContain("allow-same-origin");
      expect(html).toContain("mockup-choice");
      expect(html).toContain("mockup-token");
    }
});
