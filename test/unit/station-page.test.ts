import { expect, it } from "vitest";
import { boardHtml } from "../../src/cli/board-page.js";

it("shows per-station TDD and a named conversation selector in both languages", () => {
  for (const lang of ["en", "vi"] as const) {
    const html = boardHtml(lang, "auto");
    expect(html).toContain('id="chat-station"');
    expect(html).toContain('for="chat-station"');
    expect(html).toContain("task.station.tdd");
    expect(html).toContain("task.station.path");
    expect(html).toContain("encodeURIComponent(chatStation)");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    for (const script of scripts) expect(() => new Function(script[1]!)).not.toThrow();
  }
});
