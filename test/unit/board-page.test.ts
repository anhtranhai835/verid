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
