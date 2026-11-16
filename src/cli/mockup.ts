import { inAgentShell } from "../adapters/agent-environment.js";
import { chooseMockup, moduleMockups, moduleName } from "../adapters/mockups.js";
import { VeridError } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";

/** Developer review of local HTML previews; agents only read the resulting choice. */
export function mockupCommand(project: string, args: string[]): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_MOCKUP_IN_AGENT");
  const [module, option, flag, note = ""] = args;
  let options: string[] = [];
  const invalid = (detail: string): never => {
    throw new VeridError("VERID_BURNT_MOCKUP_INVALID", {
      detail,
      options: options.join(", ") || "(none)",
    });
  };
  if (!module || !moduleName.test(module)) invalid("Invalid module name");
  try {
    const mockups = moduleMockups(project, module!);
    options = mockups.files.map((file) => file.slice(0, -5));
    if (options.length === 0) invalid("No mockups");
    if (args.length > 4 || (flag !== undefined && (flag !== "--note" || args.length !== 4)))
      invalid("Expected mockup <module> [option] [--note <text>]");
    if (option === undefined)
      return {
        exit: 0,
        stdout: `Available options: ${options.join(", ")}\n${mockups.choice ? `Current: ${mockups.choice.choice}\n` : ""}`,
        stderr: "",
      };
    const requested = option.replace(/\.html$/i, "");
    const choice = options.find((name) => name.toLowerCase() === requested.toLowerCase());
    if (choice === undefined || !chooseMockup(project, module!, choice, note))
      invalid("Invalid mockup option or note");
    return { exit: 0, stdout: `Current: ${choice}\n`, stderr: "" };
  } catch (error) {
    if (error instanceof VeridError && error.code === "VERID_BURNT_MANIFEST_INVALID")
      invalid("Mockup paths must stay inside the project without links or aliases");
    throw error;
  }
}
