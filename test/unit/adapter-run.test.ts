import { expect, it } from "vitest";
import { adapterTimeoutMs, runAdapter } from "../../src/adapters/adapter-run.js";

const context = {
  legacyRoot: "a path with spaces",
  unit: "screen",
  unitDir: "unit",
  specPath: "spec",
};

it("substitutes placeholders after splitting arguments and never evaluates shell syntax", async () => {
  const result = await runAdapter(
    `node -e 'console.log(JSON.stringify({units:[{id:"screen",title:process.argv[1]}]}))' "{legacyRoot}"`,
    process.cwd(),
    "inventory",
    context,
  );
  expect(result).toEqual({ units: [{ id: "screen", title: context.legacyRoot }] });
});

it.each([
  ['node -e "process.exit(7)"', undefined],
  ['node -e "console.log(123)"', undefined],
  ['node -e "setInterval(()=>{},1000)"', 20],
] as const)("reports process, payload and timeout errors for %s", async (command, timeout) => {
  await expect(
    runAdapter(command, process.cwd(), "inventory", context, {}, timeout),
  ).rejects.toMatchObject({ code: "VERID_BURNT_ADAPTER" });
});

it("keeps a value with quotes, spaces and shell syntax as one argument", async () => {
  const awkward = `it's "quoted" $(echo no) ; & | > a b`;
  const echoed = await runAdapter(
    `node -e 'console.log(JSON.stringify({units:[{id:"screen",title:process.argv[1]}]}))' "{legacyRoot}"`,
    process.cwd(),
    "inventory",
    { ...context, legacyRoot: awkward },
  );
  expect(echoed).toEqual({ units: [{ id: "screen", title: awkward }] });
});

it("passes the step and the plugin environment to the command", async () => {
  const result = await runAdapter(
    `node -e 'console.log(JSON.stringify({units:[{id:"screen",title:process.env.VERID_ADAPTER_STEP+process.env.KEPT}]}))'`,
    process.cwd(),
    "inventory",
    context,
    { KEPT: "-env" },
  );
  expect(result).toEqual({ units: [{ id: "screen", title: "inventory-env" }] });
});

it("reads the time limit from VERID_ADAPTER_TIMEOUT_MS and falls back to 300 seconds", () => {
  expect(adapterTimeoutMs({})).toBe(300_000);
  expect(adapterTimeoutMs({ VERID_ADAPTER_TIMEOUT_MS: "1500" })).toBe(1500);
  for (const bad of ["0", "-5", "abc", "1.5", ""])
    expect(adapterTimeoutMs({ VERID_ADAPTER_TIMEOUT_MS: bad }), bad).toBe(300_000);
});

it("rejects files that leave the unit's legacy folder and gate findings of an unknown severity", async () => {
  for (const files of [["../escape.json"], ["/abs.json"], ["a\\\\b.json"], ["con.json"], [""]]) {
    await expect(
      runAdapter(
        `node -e 'console.log(${JSON.stringify(JSON.stringify({ unit: "screen", files }))})'`,
        process.cwd(),
        "extract",
        context,
      ),
    ).rejects.toMatchObject({ code: "VERID_BURNT_ADAPTER" });
  }
  const gate = {
    unit: "screen",
    pass: true,
    findings: [{ severity: "fatal", rule: "r", message: "m" }],
  };
  await expect(
    runAdapter(
      `node -e 'console.log(${JSON.stringify(JSON.stringify(gate))})'`,
      process.cwd(),
      "gate",
      context,
    ),
  ).rejects.toMatchObject({ code: "VERID_BURNT_ADAPTER" });
  const fine = {
    unit: "screen",
    pass: false,
    findings: [{ severity: "error", rule: "r", message: "m" }],
  };
  await expect(
    runAdapter(
      `node -e 'console.log(${JSON.stringify(JSON.stringify(fine))})'`,
      process.cwd(),
      "gate",
      context,
    ),
  ).resolves.toMatchObject({ pass: false });
});

it("rejects duplicate or unsafe unit IDs and mismatched units", async () => {
  for (const units of [
    [{ id: "../escape", title: "bad" }],
    [
      { id: "screen", title: "one" },
      { id: "screen", title: "two" },
    ],
  ]) {
    await expect(
      runAdapter(
        `node -e 'console.log(${JSON.stringify(JSON.stringify({ units }))})'`,
        process.cwd(),
        "inventory",
        context,
      ),
    ).rejects.toMatchObject({ code: "VERID_BURNT_ADAPTER" });
  }
  await expect(
    runAdapter(
      `node -e 'console.log(JSON.stringify({unit:"other",pass:true,findings:[]}))'`,
      process.cwd(),
      "gate",
      context,
    ),
  ).rejects.toMatchObject({ code: "VERID_BURNT_ADAPTER" });
});
