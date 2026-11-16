import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkSetupPath } from "./workspace.js";

export const moduleName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const htmlName = /^[a-z0-9][a-z0-9._-]*\.html$/i;
const directory = (module: string) => `.verid/artifacts/03-modules/${module}/ui/mockups`;

/** Reuse setup's link checks for every directory component and the leaf file. */
function mockupFile(project: string, module: string, file: string): string | null {
  if (!moduleName.test(module) || !htmlName.test(file)) return null;
  const relative = `${directory(module)}/${file}`;
  try {
    checkSetupPath(project, relative);
    const path = join(project, relative);
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

export function moduleMockups(project: string, module: string) {
  if (!moduleName.test(module)) throw new Error("Invalid module name");
  checkSetupPath(project, directory(module));
  checkSetupPath(project, `${directory(module)}/choice.json`);
  let entries: string[] = [];
  try {
    entries = readdirSync(join(project, directory(module)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const file of entries.filter((file) => htmlName.test(file)))
    checkSetupPath(project, `${directory(module)}/${file}`);
  const files = entries.filter((file) => mockupFile(project, module, file)).sort();
  let choice: { choice: string; note: string; at: string } | null = null;
  try {
    const relative = `${directory(module)}/choice.json`;
    checkSetupPath(project, relative);
    const value: unknown = JSON.parse(readFileSync(join(project, relative), "utf8"));
    if (
      value &&
      typeof value === "object" &&
      "choice" in value &&
      "note" in value &&
      "at" in value &&
      typeof value.choice === "string" &&
      typeof value.note === "string" &&
      typeof value.at === "string"
    )
      choice = { choice: value.choice, note: value.note, at: value.at };
  } catch {
    // A missing or malformed selection is displayed as unselected.
  }
  return { files, choice };
}

export function chooseMockup(
  project: string,
  module: string,
  choice: unknown,
  note: unknown,
): boolean {
  if (
    typeof choice !== "string" ||
    typeof note !== "string" ||
    note.length > 1000 ||
    /[\r\n\x00]/.test(note) ||
    !mockupFile(project, module, `${choice}.html`)
  )
    return false;
  const relative = `${directory(module)}/choice.json`;
  checkSetupPath(project, relative);
  writeFileSync(
    join(project, relative),
    JSON.stringify({ choice, note, at: new Date().toISOString() }, null, 2) + "\n",
  );
  return true;
}
