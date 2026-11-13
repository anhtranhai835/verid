import { expect, it } from "vitest";
import { boardHtml } from "../../src/cli/board-page.js";

it("shows per-station TDD and one named chat tab per station in both languages", () => {
  for (const lang of ["en", "vi"] as const) {
    const html = boardHtml(lang, "auto");
    expect(html).toMatch(/id="chat-tabs"[^>]*role="tablist"[^>]*aria-label="[^"]+"/);
    expect(html).toContain("board.tasks.filter((t) => t.station)");
    expect(html).toContain("task.station.tdd");
    expect(html).toContain("task.station.path");
    expect(html).toContain("encodeURIComponent(chatStation)");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    for (const script of scripts) expect(() => new Function(script[1]!)).not.toThrow();
  }
});
