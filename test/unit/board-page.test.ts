import { describe, expect, it } from "vitest";
import { boardHtml } from "../../src/cli/board-page.js";

// Vietnamese letters with diacritics, as the language check of the board names them.
const VIETNAMESE = /[À-ỹ]/;

describe("board page language", () => {
  it("renders English with no Vietnamese text for an English project", () => {
    const html = boardHtml("en");
    expect(html).toContain('<html lang="en">');
    expect(html.match(new RegExp(`.{0,30}${VIETNAMESE.source}.{0,30}`, "g"))).toBeNull();
    expect(html).toContain("Waiting to order");
    expect(html).toContain("en-US");
  });

  it("keeps the Vietnamese labels for a Vietnamese project", () => {
    const html = boardHtml("vi");
    expect(html).toContain('<html lang="vi">');
    for (const label of [
      "Bảng gọi món",
      "Chờ gọi món",
      "Duyệt & lên món",
      "Tách task từ spec",
      "Gửi cho AI",
      "vi-VN",
    ])
      expect(html).toContain(label);
  });

  it("embeds the browser's messages so no message can end the script early", () => {
    const html = boardHtml("en");
    const script = html.slice(html.indexOf("<script>"), html.lastIndexOf("</script>"));
    expect(script).not.toContain("</");
  });
});

describe("no-brain kitchen", () => {
  const ROLES = ["head_chef", "sous_chef", "cook", "taster", "inspector", "waiter", "customer"];

  it("draws every role, the waiter's speech and the pass, only on the no-brain board", () => {
    const html = boardHtml("en", "auto");
    expect(html).toContain('id="kitchen"');
    for (const role of ROLES) expect(html).toContain(`data-role="${role}"`);
    for (const label of ["Head chef", "Sous chef", "Cook", "Taster", "Inspector", "Waiter"])
      expect(html).toContain(label);
    expect(html).toMatch(/id="waiter-say"[^>]*role="status"/);
    for (const station of ["order", "RAW", "COOKING", "PLATED", "served"])
      expect(html).toContain(`data-station="${station}"`);
    expect(html).toContain("prefers-reduced-motion");
    // Each crew member is a cut of the art for the eye; screen readers get the name and state.
    expect(html).toMatch(/class="crop" aria-hidden="true"/);
    // The room stays still under the crew layer, so only the crew's own pixels move.
    expect(html).toContain("--art:url(data:image/webp;base64,");
    expect(html).toContain("--crew:url(data:image/webp;base64,");
  });

  it("speaks Vietnamese in a Vietnamese project", () => {
    const html = boardHtml("vi", "auto");
    for (const label of ["Bếp trưởng", "Bếp phó", "Phụ bếp", "Người nếm", "Thanh tra", "Bồi bàn"])
      expect(html).toContain(label);
  });

  it("leaves the big-brain board plain", () => {
    for (const html of [boardHtml("en", "human"), boardHtml("en")]) {
      expect(html).not.toContain('id="kitchen"');
      expect(html).not.toContain("data-role=");
      expect(html).not.toContain('class="crop"');
    }
  });

  it("loads nothing from outside the page", () => {
    for (const html of [boardHtml("en", "auto"), boardHtml("vi", "human")]) {
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/(?:src|href)=["']?\/\//);
      expect(html).not.toMatch(/@import|url\(\s*["']?(?!data:)[^)]/);
    }
  });
});
