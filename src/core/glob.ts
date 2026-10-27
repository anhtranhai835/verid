// The architecture snapshot matches every file of a repo against the manifest's globs.
const compiled = new Map<string, RegExp>();

/**
 * Minimal glob for manifest patterns, matched against a repo-relative path with `/`
 * separators: `**` spans directories, `*` and `?` stay within one segment. No braces,
 * classes or negation. Case-insensitive, because the adapter lowercases paths on win32.
 */
export function matchesGlob(path: string, glob: string): boolean {
  let re = compiled.get(glob);
  if (re === undefined) compiled.set(glob, (re = toRegExp(glob)));
  return re.test(path);
}

/**
 * Whether some file under the repo-relative folder `dir` could match `glob`: each of the glob's
 * segments before a `**` must match the folder's segment at the same depth, and the glob must go
 * deeper than the folder. Conservative: a `**` anywhere in the way could match.
 */
export function mayMatchUnder(dir: string, glob: string): boolean {
  const g = glob.replaceAll("\\", "/").replace(/^\.\//, "").split("/");
  const d = dir.split("/");
  for (const [i, part] of d.entries()) {
    const seg = g[i];
    if (seg === undefined) return false;
    if (seg.includes("**")) return true;
    if (!matchesGlob(part, seg)) return false;
  }
  return g.length > d.length;
}

function toRegExp(glob: string): RegExp {
  const g = glob.replaceAll("\\", "/").replace(/^\.\//, "");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i] as string;
    if (c === "*" && g[i + 1] === "*") {
      i++;
      if (g[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}
