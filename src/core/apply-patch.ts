export type PatchTargets = { targets: string[] } | { invalid: string };

/** Read the patch grammar before any write; content lines retain their leading diff marker. */
export function parseApplyPatch(patch: string): PatchTargets {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const invalid = (): PatchTargets => ({ invalid: "malformed or unsupported apply_patch syntax" });
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return invalid();
  const targets: string[] = [];
  let index = 1;
  const path = (line: string, prefix: string): string | undefined => {
    if (!line.startsWith(prefix)) return undefined;
    const value = line.slice(prefix.length);
    return value !== "" &&
      value.trim() === value &&
      !/^[\p{White_Space}]|[\p{White_Space}]$/u.test(value) &&
      !/[\p{Cc}\u2028\u2029]/u.test(value)
      ? value
      : undefined;
  };
  while (index < lines.length - 1) {
    const line = lines[index++] ?? "";
    const operation = /^\*\*\* (Add|Update|Delete) File: /.exec(line)?.[1];
    if (!operation) return invalid();
    const target = path(line, `*** ${operation} File: `);
    if (target === undefined) return invalid();
    targets.push(target);
    if (operation === "Delete") continue;
    if (operation === "Add") {
      while (index < lines.length - 1 && lines[index]?.startsWith("+")) index++;
      continue;
    }
    if (lines[index]?.startsWith("*** Move to: ")) {
      const destination = path(lines[index++] ?? "", "*** Move to: ");
      if (destination === undefined) return invalid();
      targets.push(destination);
    }
    let hunkLines = 0;
    let hunkHeader = false;
    let ended = false;
    while (index < lines.length - 1) {
      const content = lines[index] ?? "";
      if (/^\*\*\* (?:Add|Update|Delete) File: /.test(content)) break;
      if (ended) return invalid();
      if (content === "@@" || content.startsWith("@@ ")) {
        if (hunkHeader && hunkLines === 0) return invalid();
        hunkHeader = true;
        hunkLines = 0;
      } else if (/^[ +\-]/.test(content)) {
        hunkLines++;
      } else if (content === "*** End of File" && hunkLines > 0) {
        ended = true;
      } else return invalid();
      index++;
    }
    if (hunkLines === 0) return invalid();
  }
  return targets.length > 0 ? { targets: [...new Set(targets)] } : invalid();
}
