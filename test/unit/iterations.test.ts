import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseManifest, renderManifest } from "../../src/core/manifest.js";
import { durationDays, iterationDates } from "../../src/core/iterations.js";
import { moduleProblem, parsePlan } from "../../src/core/plan.js";
import { parseState } from "../../src/core/state.js";
import { menuLines, readPlan } from "../../src/adapters/plan-file.js";
import { setLanguage } from "../../src/adapters/i18n.js";

const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
const schedule = { duration: "2 weeks", start_date: "2026-10-12", demo_day: "Friday" };
const dirs: string[] = [];
afterEach(() => {
  setLanguage(null);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("iterations manifest", () => {
  it("accepts optional iterations only in prep and recipe and renders them unchanged", () => {
    const rows = [
      { mode: "prep", iterations: schedule, ok: true },
      { mode: "recipe", iterations: schedule, ok: true },
      { mode: "remix", iterations: schedule, ok: false },
      { mode: "remix", iterations: undefined, ok: true },
      { mode: "prep", iterations: undefined, ok: true },
    ];
    for (const row of rows) {
      const checked = parseManifest({
        schemaVersion: 1,
        mode: row.mode,
        repos: [repo],
        ...(row.iterations && { iterations: row.iterations }),
      });
      expect(checked.ok, row.mode).toBe(row.ok);
      if (checked.ok) {
        const manifest = checked.manifest;
        const text = renderManifest(
          manifest.mode,
          repo,
          undefined,
          undefined,
          "monorepo",
          manifest.iterations,
        );
        if (row.iterations)
          expect(parse(text).iterations).toEqual({
            duration: "2 weeks",
            start_date: "2026-10-12",
            demo_day: "Friday",
          });
        else expect(parse(text).iterations).toBeUndefined();
        expect(parseManifest(parse(text)).ok).toBe(true);
      } else expect(checked.detail).toBe("iterations: needs mode prep or recipe");
    }
  });

  it("validates iteration settings, including leap days, with the affected field", () => {
    const rows: [unknown, { ok: boolean; detail?: string }][] = [
      [
        { ...schedule, duration: "0 days" },
        {
          ok: false,
          detail: "iterations.duration: must be a positive integer followed by days or weeks",
        },
      ],
      [
        { ...schedule, duration: "-1 weeks" },
        {
          ok: false,
          detail: "iterations.duration: must be a positive integer followed by days or weeks",
        },
      ],
      [
        { ...schedule, duration: "1.5 weeks" },
        {
          ok: false,
          detail: "iterations.duration: must be a positive integer followed by days or weeks",
        },
      ],
      [
        { ...schedule, duration: "2 months" },
        {
          ok: false,
          detail: "iterations.duration: must be a positive integer followed by days or weeks",
        },
      ],
      [
        { ...schedule, duration: "9007199254740992 weeks" },
        {
          ok: false,
          detail: "iterations.duration: must be a positive integer followed by days or weeks",
        },
      ],
      [
        { ...schedule, duration: "999999999999 days" },
        { ok: false, detail: "iterations.duration: exceeds the supported date range" },
      ],
      [
        { ...schedule, start_date: "2026-02-29" },
        { ok: false, detail: "iterations.start_date: must be a real date in YYYY-MM-DD format" },
      ],
      [
        { ...schedule, start_date: "2026-10-32" },
        { ok: false, detail: "iterations.start_date: must be a real date in YYYY-MM-DD format" },
      ],
      [
        { ...schedule, start_date: "2026-1-12" },
        { ok: false, detail: "iterations.start_date: must be a real date in YYYY-MM-DD format" },
      ],
      [
        { ...schedule, demo_day: "friday" },
        { ok: false, detail: "iterations.demo_day: must be Monday through Sunday" },
      ],
      [
        { ...schedule, demo_day: "Funday" },
        { ok: false, detail: "iterations.demo_day: must be Monday through Sunday" },
      ],
      [
        { duration: "2 weeks", start_date: "2026-10-12" },
        { ok: false, detail: "iterations.demo_day: must be Monday through Sunday" },
      ],
      [
        { ...schedule, enabled: true },
        { ok: false, detail: "iterations: unknown key enabled" },
      ],
      [null, { ok: false, detail: "iterations: expected object" }],
      [{ ...schedule, duration: "1 day", start_date: "2024-02-29" }, { ok: true }],
      [{ ...schedule, duration: "1 week" }, { ok: true }],
      [{ ...schedule, start_date: "2000-02-29" }, { ok: true }],
      [
        { ...schedule, start_date: "2100-02-29" },
        { ok: false, detail: "iterations.start_date: must be a real date in YYYY-MM-DD format" },
      ],
    ];
    for (const [iterations, expected] of rows) {
      expect(
        parseManifest({ schemaVersion: 1, mode: "prep", repos: [repo], iterations }),
      ).toMatchObject(expected);
    }
  });
});

describe("iteration date math", () => {
  it("accepts singular and plural calendar units", () => {
    const rows = [
      { duration: "1 day", expected: 1 },
      { duration: "1 week", expected: 7 },
      { duration: "1 days", expected: 1 },
      { duration: "1 weeks", expected: 7 },
      { duration: "2 days", expected: 2 },
      { duration: "2 weeks", expected: 14 },
      { duration: "0 day", expected: null },
      { duration: "1 month", expected: null },
    ];
    for (const row of rows) expect(durationDays(row.duration), row.duration).toBe(row.expected);
  });

  it("uses literal calendar dates across boundaries, leap days, DST and a future start", () => {
    const rows = [
      {
        start: "2026-10-12",
        duration: "2 weeks",
        today: "2026-10-12",
        demo: "Friday",
        expected: { number: 1, start: "2026-10-12", end: "2026-10-25", daysToDemo: 11 },
      },
      {
        start: "2026-10-12",
        duration: "2 weeks",
        today: "2026-10-14",
        demo: "Friday",
        expected: { number: 1, start: "2026-10-12", end: "2026-10-25", daysToDemo: 9 },
      },
      {
        start: "2026-10-12",
        duration: "2 weeks",
        today: "2026-10-24",
        demo: "Friday",
        expected: { number: 1, start: "2026-10-12", end: "2026-10-25", daysToDemo: -1 },
      },
      {
        start: "2026-10-12",
        duration: "14 days",
        today: "2026-10-25",
        demo: "Friday",
        expected: { number: 1, start: "2026-10-12", end: "2026-10-25", daysToDemo: -2 },
      },
      {
        start: "2026-10-12",
        duration: "2 weeks",
        today: "2026-10-26",
        demo: "Friday",
        expected: { number: 2, start: "2026-10-26", end: "2026-11-08", daysToDemo: 11 },
      },
      {
        start: "2026-10-12",
        duration: "3 days",
        today: "2026-10-15",
        demo: "Friday",
        expected: { number: 2, start: "2026-10-15", end: "2026-10-17", daysToDemo: 1 },
      },
      {
        start: "2024-02-28",
        duration: "2 days",
        today: "2024-03-01",
        demo: "Friday",
        expected: { number: 2, start: "2024-03-01", end: "2024-03-02", daysToDemo: 0 },
      },
      {
        start: "2026-12-28",
        duration: "1 weeks",
        today: "2027-01-04",
        demo: "Sunday",
        expected: { number: 2, start: "2027-01-04", end: "2027-01-10", daysToDemo: 6 },
      },
      {
        start: "2026-11-02",
        duration: "1 weeks",
        today: "2026-10-24",
        demo: "Saturday",
        expected: { number: 1, start: "2026-11-02", end: "2026-11-08", daysToDemo: 14 },
      },
      {
        start: "2026-11-02",
        duration: "2 weeks",
        today: "2026-10-24",
        demo: "Friday",
        expected: { number: 1, start: "2026-11-02", end: "2026-11-15", daysToDemo: 20 },
      },
      {
        start: "2026-10-12",
        duration: "3 days",
        today: "2026-10-12",
        demo: "Friday",
        expected: { number: 1, start: "2026-10-12", end: "2026-10-14", daysToDemo: 2 },
      },
      {
        start: "2026-03-02",
        duration: "1 weeks",
        today: "2026-03-09",
        demo: "Monday",
        expected: { number: 2, start: "2026-03-09", end: "2026-03-15", daysToDemo: 0 },
      },
      {
        start: "9999-12-31",
        duration: "2 days",
        today: "9999-12-31",
        demo: "Friday",
        expected: { number: 1, start: "9999-12-31", end: "+010000-01-01", daysToDemo: 0 },
      },
    ] as const;
    for (const row of rows)
      expect(
        iterationDates(
          { duration: row.duration, start_date: row.start, demo_day: row.demo },
          row.today,
        ),
      ).toEqual(row.expected);
  });
});

describe("Iteration plan lines", () => {
  it("reads optional positive iteration numbers, including product, without changing section bytes", () => {
    const rows = [
      { line: "Iteration: 2\r\n", iteration: 2 },
      { line: "  Iteration: 12 \r\n", iteration: 12 },
      { line: "\r\n \t\r\nIteration: 4\r\n", iteration: 4 },
      { line: "", iteration: undefined },
    ];
    for (const row of rows) {
      const text = `## Module: auth\r\n${row.line}- AC-1: signs in\r\n## Module: product\r\nIteration: 3\r\n- AC-9 (e2e): uses the product\r\n`;
      const result = parsePlan(text, true);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.modules.map((m) => m.iteration)).toEqual([row.iteration, 3]);
      expect(result.modules.map(moduleProblem)).toEqual([null, null]);
      expect(result.modules[0]?.text).toBe(`## Module: auth\r\n${row.line}- AC-1: signs in\r\n`);
    }
  });

  it("makes only a module with invalid first-line Iteration metadata unorderable", () => {
    const rows = [
      { line: "Iteration: 0", problem: "line 2: Iteration must be a positive integer" },
      { line: "Iteration: -1", problem: "line 2: Iteration must be a positive integer" },
      { line: "Iteration: 1.5", problem: "line 2: Iteration must be a positive integer" },
      { line: "Iteration: soon", problem: "line 2: Iteration must be a positive integer" },
      { line: "Iteration:", problem: "line 2: Iteration must be a positive integer" },
      {
        line: "Iteration: 9007199254740992",
        problem: "line 2: Iteration must be a positive integer",
      },
      {
        line: "Iteration: 1 Iteration: 1",
        problem: "line 2: Iteration must be a positive integer",
      },
    ];
    for (const row of rows) {
      const result = parsePlan(
        `## Module: auth\n${row.line}\n- AC-1: signs in\n## Module: ui\n- AC-2: shows the page\n`,
        true,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.modules.map(moduleProblem)).toEqual([row.problem, null]);
    }
  });

  it("only reads enabled metadata at the first nonempty line under a module heading", () => {
    const rows = [
      { enabled: false, body: "Iteration: TBD\n- AC-1: signs in\n", iteration: undefined },
      { enabled: false, body: "Iteration: 2\n- AC-1: signs in\n", iteration: undefined },
      {
        enabled: false,
        body: "A description\nIteration: TBD\n- AC-1: signs in\n",
        iteration: undefined,
      },
      {
        enabled: true,
        body: "A description\nIteration: TBD\n- AC-1: signs in\n",
        iteration: undefined,
      },
      { enabled: true, body: "- AC-1: signs in\nIteration: TBD\n", iteration: undefined },
      { enabled: true, body: "Iteration: 2\nIteration: TBD\n- AC-1: signs in\n", iteration: 2 },
      { enabled: true, body: "Iteration: 2\n\nIteration: 3\n- AC-1: signs in\n", iteration: 2 },
      { enabled: true, body: "Iteration: 2\n- AC-1: signs in\nIteration: TBD\n", iteration: 2 },
      { enabled: true, body: "iteration: 2\n- AC-1: signs in\n", iteration: undefined },
    ];
    for (const row of rows) {
      const result = parsePlan(`Iteration: TBD\n## Module: auth\n${row.body}`, row.enabled);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.modules[0]?.iteration).toBe(row.iteration);
      expect(moduleProblem(result.modules[0]!)).toBeNull();
    }
    const implicitRows = [false, true];
    for (const enabled of implicitRows) {
      const implicit = parsePlan("Iteration: TBD\n- AC-1: signs in\n", enabled);
      expect(implicit.ok).toBe(true);
      if (!implicit.ok) continue;
      expect(implicit.modules[0]?.iteration).toBeUndefined();
      expect(moduleProblem(implicit.modules[0]!)).toBeNull();
    }
  });
});

describe("iterations menu", () => {
  it("shows current dates, demo countdown, served totals and late modules in both drives", () => {
    const project = mkdtempSync(join(tmpdir(), "verid-iterations-menu-"));
    dirs.push(project);
    mkdirSync(join(project, ".verid"));
    writeFileSync(join(project, ".verid", "research.md"), "research");
    writeFileSync(join(project, ".verid", "design.md"), "design");
    writeFileSync(
      join(project, ".verid", "plan.md"),
      [
        "## Module: archived",
        "Iteration: 1",
        "- AC-0: archived",
        "## Module: served",
        "Iteration: 2",
        "- AC-2: served",
        "## Module: late",
        "Iteration: 1",
        "- AC-1: late",
        "## Module: current",
        "Iteration: 2",
        "- AC-3: current",
        "## Module: unassigned",
        "- AC-4: unassigned",
        "## Module: product",
        "Iteration: 3",
        "- AC-9 (e2e): product",
        "",
      ].join("\n"),
    );
    const plan = readPlan(project, true);
    expect(plan?.ok).toBe(true);
    if (!plan?.ok) return;
    const state = parseState(
      JSON.stringify({
        schemaVersion: 1,
        modules: {
          archived: {
            sha256: plan.hashes.archived,
            acs: ["AC-0"],
            at: "2026-10-12",
            served_at: "2026-10-13",
            design_sha256: null,
          },
          served: {
            sha256: plan.hashes.served,
            acs: ["AC-2"],
            at: "2026-10-19",
            served_at: "2026-10-20",
            design_sha256: null,
          },
        },
      }),
    );
    if (!state.ok) throw new Error(state.code);
    const rows = [
      {
        drive: "human",
        lang: "en",
        expected: [
          "  iteration 2 · 2026-10-19 – 2026-10-25 · demo passed · 1/2 modules served",
          "  late · iteration 1 · late",
        ],
      },
      {
        drive: "auto",
        lang: "en",
        expected: [
          "  iteration 2 · 2026-10-19 – 2026-10-25 · demo passed · 1/2 modules served",
          "  late · iteration 1 · late",
        ],
      },
      {
        drive: "human",
        lang: "vi",
        expected: [
          "  iteration 2 · 2026-10-19 – 2026-10-25 · demo đã qua · đã đóng 1/2 module",
          "  late · iteration 1 · trễ",
        ],
      },
    ] as const;
    for (const row of rows) {
      setLanguage(row.lang);
      const manifest = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        repos: [repo],
        iterations: { ...schedule, duration: "1 weeks" },
      });
      if (!manifest.ok) throw new Error(manifest.detail);
      const lines = menuLines(
        project,
        "prep",
        state.state,
        undefined,
        row.drive,
        manifest.manifest,
        "2026-10-24",
      );
      for (const expected of row.expected) expect(lines.join("\n"), row.drive).toContain(expected);
      expect(
        lines.filter((line) => line.endsWith(" · late") || line.endsWith(" · trễ")),
      ).toHaveLength(1);
    }
  });

  it("shows a zero module iteration before a plan exists and nothing when iterations are off", () => {
    const project = mkdtempSync(join(tmpdir(), "verid-iterations-empty-"));
    dirs.push(project);
    const state = parseState('{"schemaVersion":1}');
    if (!state.ok) throw new Error(state.code);
    setLanguage("en");
    const rows = [
      {
        iterations: schedule,
        expected: ["  iteration 1 · 2026-10-12 – 2026-10-25 · demo passed · 0/0 modules served"],
      },
      { iterations: undefined, expected: [] },
    ];
    for (const row of rows) {
      const manifest = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        repos: [repo],
        iterations: row.iterations,
      });
      if (!manifest.ok) throw new Error(manifest.detail);
      expect(
        menuLines(
          project,
          "prep",
          state.state,
          undefined,
          "human",
          manifest.manifest,
          "2026-10-24",
        ).filter((line) => line.startsWith("  iteration ")),
      ).toEqual(row.expected);
    }
  });

  it("renders a passed demo, today, one day and multiple days in both languages", () => {
    const project = mkdtempSync(join(tmpdir(), "verid-iterations-wording-"));
    dirs.push(project);
    const state = parseState('{"schemaVersion":1}');
    const manifest = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [repo],
      iterations: schedule,
    });
    if (!state.ok || !manifest.ok) throw new Error("invalid fixture");
    const rows = [
      { lang: "en", today: "2026-10-14", expected: "demo Friday in 9 days" },
      { lang: "en", today: "2026-10-22", expected: "demo Friday in 1 day" },
      { lang: "en", today: "2026-10-23", expected: "demo Friday today" },
      { lang: "en", today: "2026-10-24", expected: "demo passed" },
      { lang: "vi", today: "2026-10-14", expected: "demo Friday sau 9 ngày" },
      { lang: "vi", today: "2026-10-22", expected: "demo Friday sau 1 ngày" },
      { lang: "vi", today: "2026-10-23", expected: "demo Friday hôm nay" },
      { lang: "vi", today: "2026-10-24", expected: "demo đã qua" },
    ] as const;
    for (const row of rows) {
      setLanguage(row.lang);
      const lines = menuLines(
        project,
        "prep",
        state.state,
        undefined,
        "human",
        manifest.manifest,
        row.today,
      );
      expect(lines.join("\n")).toContain(` · ${row.expected} · `);
    }
  });
});
