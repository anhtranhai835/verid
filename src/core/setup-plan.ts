export type Action = "created" | "kept" | "updated";

export interface PlannedFile {
  action: Action;
  rel: string;
}

const MARKS: Record<Action, string> = { created: "+", updated: "~", kept: "=" };

/** Environment values supplied by the caller; false and zero still permit questions. */
export function isCi(value: string | undefined): boolean {
  return !["", "false", "0"].includes((value ?? "").trim().toLowerCase());
}

/** The planned writes only; the caller supplies facts and prints the returned lines. */
export function setupPreview(
  files: readonly PlannedFile[],
  warnings: readonly string[] = [],
): string[] {
  interface Branch {
    children: Map<string, Branch>;
    action?: Action;
  }
  const root: Branch = { children: new Map() };
  for (const file of files) {
    let branch = root;
    for (const part of file.rel.split("/").filter(Boolean)) {
      let child = branch.children.get(part);
      if (!child) {
        child = { children: new Map() };
        branch.children.set(part, child);
      }
      branch = child;
    }
    branch.action = file.action;
  }
  const lines = ["."];
  const draw = (branch: Branch, prefix: string) => {
    const entries = [...branch.children];
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      const mark = child.action ? `${MARKS[child.action]} ` : "";
      lines.push(
        `${prefix}${last ? "└──" : "├──"} ${mark}${name}${child.children.size ? "/" : ""}`,
      );
      draw(child, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  draw(root, "");
  for (const warning of warnings)
    for (const line of warning.split(/\r?\n/)) lines.push(`! ${line}`);
  return lines;
}
