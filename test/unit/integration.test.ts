import { describe, expect, it } from "vitest";
import { netChange, squashOf } from "../../src/core/integration.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const Z = "0".repeat(40);
// `git diff --raw --no-renames --no-abbrev -z` output: a metadata record, then the path.
const raw = (...records: [string, string, string, string, string, string][]) =>
  records
    .map(([m1, m2, s1, s2, status, path]) => `:${m1} ${m2} ${s1} ${s2} ${status}\0${path}\0`)
    .join("");

describe("netChange: a module's change as tree entries, to match a squash commit", () => {
  it("keys the change by path, modes and object ids, in any order, and counts its files", () => {
    const edit = ["100644", "100644", A, B, "M", "src/a.ts"] as const;
    const add = ["000000", "100644", Z, A, "A", "src/new file.ts"] as const;
    const del = ["100644", "000000", A, Z, "D", "old.ts"] as const;
    const mode = ["100644", "100755", A, A, "M", "run.sh"] as const;
    const one = netChange(raw([...edit], [...add], [...del], [...mode]));
    const shuffled = netChange(raw([...mode], [...del], [...edit], [...add]));
    const otherBlob = netChange(
      raw(["100644", "100644", A, A, "M", "src/a.ts"], [...add], [...del], [...mode]),
    );
    const otherMode = netChange(
      raw([...edit], [...add], [...del], ["100644", "100644", A, A, "M", "run.sh"]),
    );
    expect({
      files: one?.files,
      "same in any order": one?.key === shuffled?.key,
      "other blob": one?.key === otherBlob?.key,
      "other mode": one?.key === otherMode?.key,
      empty: netChange(""),
      unreadable: netChange(":100644 100644 short\0x\0"),
    }).toEqual({
      files: 4,
      "same in any order": true,
      "other blob": false,
      "other mode": false,
      empty: { files: 0, key: "[]" },
      unreadable: null,
    });
  });
});

describe("squashOf: the commit on main that brought a module's change in", () => {
  it("takes a single-parent commit with exactly the recorded change and a Conventional message", () => {
    const squash = { sha: "s1", parents: 1, key: "K", message: "feat(calc): add sums (#12)\n" };
    const rows = {
      squash: [squash],
      "after unrelated commits": [
        { sha: "u1", parents: 1, key: "U", message: "fix: other" },
        squash,
      ],
      "merge commit": [{ ...squash, parents: 2 }],
      "other content": [{ ...squash, key: "K2" }],
      "bad message": [{ ...squash, message: "Add sums" }],
      "split in two": [
        { ...squash, key: "K-half" },
        { ...squash, sha: "s2", key: "K-other-half" },
      ],
      none: [],
    };
    expect(Object.fromEntries(Object.entries(rows).map(([k, c]) => [k, squashOf("K", c)]))).toEqual(
      {
        squash: "s1",
        "after unrelated commits": "s1",
        "merge commit": null,
        "other content": null,
        "bad message": null,
        "split in two": null,
        none: null,
      },
    );
  });
});
