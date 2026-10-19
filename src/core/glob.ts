/**
 * Minimal glob for manifest patterns, matched against a repo-relative path with `/`
 * separators: `**` spans directories, `*` and `?` stay within one segment. No braces,
 * classes or negation. Case-insensitive, because the adapter lowercases paths on win32.
 */
export function matchesGlob(path: string, glob: string): boolean {
  return toRegExp(glob).test(path);
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
