import { messages, t, type Lang } from "../adapters/i18n.js";
import { kitchenMarkup } from "./board-kitchen.js";
import page from "./board-ui/page.html?raw";
import boardCss from "./board-ui/board.css?raw";
import kitchenCss from "./board-ui/kitchen.css?raw";
import mockupsCss from "./board-ui/mockups.css?raw";
import themeCss from "./board-ui/theme.css?raw";
import boardJs from "./board-ui/board.client.js?raw";
import kitchenJs from "./board-ui/kitchen.client.js?raw";
import mockupsJs from "./board-ui/mockups.client.js?raw";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Last in the page's styles, so no rule above shows what the script has hidden.
const HIDDEN = "[hidden]{display:none!important}";

/**
 * Self-contained local UI; no CDN, framework runtime, or network services. The page, its styles
 * and its browser scripts are the files in board-ui/, embedded in the bundle as text. In
 * page.html `{{key}}` is the board.* message of that name; the scripts read the same messages
 * from the `board-data` element. The no-brain (auto) board adds the restaurant kitchen; the
 * big-brain board stays plain.
 */
export function boardHtml(lang: Lang, drive: "human" | "auto" = "human"): string {
  const s = (key: string, params: Record<string, string> = {}) =>
    escapeHtml(t(lang, `board.${key}`, params));
  const auto = drive === "auto";
  const filled: Record<string, string> = {
    lang,
    completion: s("completion", { done: "0", total: "0" }),
  };
  // < is escaped so no message can close the script element.
  const table = JSON.stringify(messages(lang, "board.")).replace(/</g, "\\u003c");
  const styles = [boardCss, auto ? kitchenCss : "", mockupsCss, themeCss, HIDDEN].join("");
  // The scripts share one scope and run in this order: the board's own, then what builds on it.
  const scripts = [boardJs, auto ? kitchenJs : "", mockupsJs].join("\n");
  // Messages are filled first, and only in the page: nothing below is searched for {{key}} again.
  return page
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => filled[key] ?? s(key))
    .replace("<!--styles-->", () => `<style>${styles}</style>`)
    .replace("<!--kitchen-->", () => (auto ? kitchenMarkup(s) : ""))
    .replace(
      "<!--scripts-->",
      () =>
        `<script type="application/json" id="board-data">${table}</script><script>${scripts}</script>`,
    );
}
