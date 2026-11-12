import { describe, expect, it } from "vitest";
import { messages } from "../../src/adapters/i18n.js";
import { boardHtml } from "../../src/cli/board-page.js";

// What the browser builds for a legacy unit, by message key: a state in the card's chip, the
// dialog's block, and the one button the no-brain board adds.
const KEYS = [
  "migration_heading",
  "migration_family",
  "migration_parent",
  "migration_extract_yes",
  "migration_extract_no",
  "gate_none",
  "gate_pass",
  "gate_fail",
  "gate_stale",
  "parity_none",
  "parity_unsigned",
  "parity_signed",
  "parity_sign",
  "parity_sign_aria",
  "parity_sign_help",
  "parity_terminal",
  "toast_parity_signed",
  "err_parity_not_ready",
  "reason_reheat_gate",
  "waiter_gate",
  "waiter_gate_next",
  "waiter_parity",
  "waiter_parity_next",
] as const;

describe("a legacy unit on the board", () => {
  it.each(["en", "vi"] as const)("has every label in %s", (lang) => {
    const table = messages(lang, "board.");
    for (const key of KEYS) expect(table[key], key).toBeTruthy();
    // The page is built only from these keys: none can be missing at the moment of use.
    const html = boardHtml(lang, "auto");
    for (const key of KEYS.filter((key) => !/^(err_|reason_|waiter_)/.test(key)))
      expect(html, key).toContain(JSON.stringify(table[key]).slice(1, -1).replace(/</g, "\\u003c"));
  });

  it("draws the unit's state on the card and its block in the dialog, with a named button", () => {
    for (const drive of ["human", "auto"] as const) {
      const html = boardHtml("en", drive);
      expect(html).toContain('id="task-migration"');
      expect(html).toContain("function renderMigration(task)");
      expect(html).toContain('L["gate_" + task.migration.gate]');
      expect(html).toContain("task.migration.parityState");
      // The sign button is built only for the no-brain drive, names its unit and runs one action.
      expect(html).toContain('m.canSignParity && board.drive === "auto"');
      expect(html).toContain('fmt("parity_sign_aria", { id: task.id })');
      expect(html).toContain('act("parity", { task: task.id })');
    }
  });

  it("keeps the browser's messages from ending the script early", () => {
    for (const lang of ["en", "vi"] as const) {
      const html = boardHtml(lang, "auto");
      const script = html.slice(html.indexOf("<script>"), html.lastIndexOf("</script>"));
      expect(script).not.toContain("</");
    }
  });
});
