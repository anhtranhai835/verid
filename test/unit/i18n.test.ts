import { describe, expect, it } from "vitest";
import { veridCommand } from "../../src/adapters/i18n.js";

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
