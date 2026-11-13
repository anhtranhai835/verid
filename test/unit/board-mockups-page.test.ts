import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { messages } from "../../src/adapters/i18n.js";
import MOCKUP_JS from "../../src/cli/board-ui/mockups.client.js?raw";

// A small DOM double lets these tests execute the shipped browser code and its async handlers.
function mockupUi(lang: "en" | "vi" = "en") {
  const document = { activeElement: null as Element | null };
  class Element {
    children: Element[] = [];
    parent: Element | null = null;
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    hidden = false;
    disabled = false;
    tabIndex = 0;
    value = "";
    onclick?: () => Promise<void> | void;
    onload?: () => void;
    onkeydown?: (event: { key: string; preventDefault: () => void }) => void;
    constructor(
      public tag: string,
      public className = "",
      public textContent = "",
    ) {}
    get isConnected(): boolean {
      return this.parent?.isConnected ?? this.tag === "root";
    }
    set src(url: string) {
      this.setAttribute("src", url);
    }
    setAttribute(key: string, value: string) {
      this.attributes[key] = value;
    }
    getAttribute(key: string) {
      return this.attributes[key];
    }
    append(...children: Element[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    }
    replaceChildren() {
      for (const child of this.children) child.parent = null;
      this.children = [];
    }
    contains(element: Element | null): boolean {
      return this === element || this.children.some((child) => child.contains(element));
    }
    focus() {
      document.activeElement = this;
    }
    querySelectorAll(selector: string): Element[] {
      const [head, ...tail] = selector.split(" ");
      return this.children.flatMap((child) => {
        const match = head!.startsWith(".")
          ? child.className.split(" ").includes(head!.slice(1))
          : child.tag === head;
        return [
          ...(match ? (tail.length ? child.querySelectorAll(tail.join(" ")) : [child]) : []),
          ...child.querySelectorAll(selector),
        ];
      });
    }
    querySelector(selector: string): Element {
      const found = this.querySelectorAll(selector)[0];
      if (!found) throw new Error(`Missing element: ${selector}`);
      return found;
    }
  }
  const elements = Object.fromEntries(
    ["details-tab", "mockup-tab", "task-details", "mockup-panel"].map((id) => [
      id,
      new Element("root"),
    ]),
  );
  const task = {
    id: "screen",
    mockups: {
      files: ["option-a.html", "option-b.html"],
      choice: null as { choice: string; note: string } | null,
    },
  };
  const L = messages(lang, "board.");
  const request = vi.fn().mockResolvedValue({ url: "/mockups/screen/option-a.html?token=one-use" });
  const act = vi.fn(
    async (_action: string, input: { choice: string; note: string }): Promise<object | null> => {
      task.mockups.choice = { ...input };
      return {};
    },
  );
  const context = {
    document,
    $: (id: string) => elements[id],
    L,
    fmt: (key: string, params: Record<string, string>) =>
      L[key]!.replace(/\{(\w+)\}/g, (_, name: string) => params[name]!),
    node: (tag: string, cls: string, text?: string) => new Element(tag, cls, text),
    board: { tasks: [task], revision: "revision" },
    busy: false,
    request,
    act,
    toast: vi.fn(),
    renderTask: () => render(),
  };
  const { renderMockups: render, showMockups: show } = runInNewContext(
    MOCKUP_JS + ";({renderMockups:()=>renderMockups(board.tasks[0]),showMockups})",
    context,
  ) as { renderMockups: () => void; showMockups: (show: boolean) => void };
  const panel = elements["mockup-panel"]!;
  return { elements, panel, task, L, request, act, context, document, render, show };
}

describe.each(["en", "vi"] as const)("Mockup interactions (%s)", (lang) => {
  it("uses arrow, Home and End keys with one selected tab and a reachable empty state", () => {
    const ui = mockupUi(lang);
    const details = ui.elements["details-tab"]!,
      mockup = ui.elements["mockup-tab"]!;
    const key = (tab: typeof details, value: string) =>
      tab.onkeydown!({ key: value, preventDefault: vi.fn() });
    ui.render();
    expect(details.getAttribute("aria-selected")).toBe("true");
    expect(mockup.tabIndex).toBe(-1);
    key(details, "ArrowRight");
    expect(ui.document.activeElement).toBe(mockup);
    expect(mockup.getAttribute("aria-selected")).toBe("true");
    expect(ui.panel.hidden).toBe(false);
    key(mockup, "Home");
    expect(ui.elements["task-details"]!.hidden).toBe(false);
    key(details, "End");
    const note = ui.panel.querySelector("input");
    note.focus();
    ui.task.mockups.files = [];
    ui.render();
    expect(ui.document.activeElement).toBe(mockup);
    expect(ui.panel.querySelector(".mockup-empty").textContent).toBe(ui.L.mockup_empty);
    expect(mockup.hidden).toBe(false);
    key(mockup, "ArrowLeft");
    expect(mockup.hidden).toBe(true);
    expect(ui.document.activeElement).toBe(details);
    ui.task.mockups.files = ["option-a.html"];
    ui.show(true);
    expect(ui.panel.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("shows loading, recovers a failed preview and preserves frame isolation", async () => {
    const ui = mockupUi(lang);
    ui.request.mockRejectedValueOnce(new Error("request failed"));
    ui.show(true);
    const row = ui.panel.querySelector(".mockup-option"),
      frame = row.querySelector("iframe");
    expect(row.querySelector(".mockup-load-status").textContent).toBe(ui.L.mockup_loading);
    expect(frame.hidden).toBe(true);
    await vi.waitFor(() =>
      expect(row.querySelector(".mockup-load-status").dataset.error).toBe("true"),
    );
    expect(row.querySelector(".mockup-load-status").textContent).toBe(ui.L.mockup_load_error);
    const retry = row.querySelector(".mockup-placeholder button");
    expect(retry.hidden).toBe(false);
    retry.onclick!();
    await vi.waitFor(() => expect(frame.getAttribute("src")).toContain("token=one-use"));
    frame.onload!();
    expect(frame.hidden).toBe(false);
    expect(row.querySelector(".mockup-placeholder").hidden).toBe(true);
    expect(ui.document.activeElement).toBe(frame);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(ui.request).toHaveBeenLastCalledWith("/api/action", {
      action: "mockup-token",
      module: "screen",
      file: "option-a.html",
      revision: "revision",
    });
    ui.show(false);
    ui.show(true);
    expect(ui.request).toHaveBeenCalledTimes(3);
  });

  it("keeps drafts through refresh and failed saves, then updates selection and saves notes", async () => {
    const ui = mockupUi(lang);
    ui.show(true);
    const rows = ui.panel.querySelectorAll(".mockup-option"),
      row = rows[0]!;
    const note = row.querySelector("input"),
      choose = row.querySelector(".mockup-choose");
    note.value = "Keep this spacing";
    ui.render();
    expect(note.value).toBe("Keep this spacing");
    ui.act.mockResolvedValueOnce(null);
    await choose.onclick!();
    expect(row.querySelector(".mockup-save-status").textContent).toBe(ui.L.mockup_save_error);
    expect(note.value).toBe("Keep this spacing");
    ui.context.busy = true;
    ui.render();
    expect(choose.disabled).toBe(true);
    expect(note.disabled).toBe(true);
    ui.context.busy = false;
    await choose.onclick!();
    expect(row.dataset.selected).toBe("true");
    expect(row.querySelector(".mockup-selected").textContent).toBe(ui.L.mockup_selected);
    expect(choose.textContent).toBe(ui.L.mockup_save_note);
    expect(row.querySelector(".mockup-save-status").textContent).toBe(ui.L.mockup_saved);
    note.value = "Updated note";
    await choose.onclick!();
    expect(ui.act).toHaveBeenLastCalledWith("mockup-choice", {
      module: "screen",
      choice: "option-a",
      note: "Updated note",
    });
    ui.task.mockups.choice = { choice: "option-b", note: "Changed elsewhere" };
    ui.render();
    expect(row.dataset.selected).toBe("false");
    expect(note.value).toBe("");
    expect(rows[1]!.querySelector("input").value).toBe("Changed elsewhere");
  });

  it("keeps a draft when new options arrive, without carrying it into another task", () => {
    const ui = mockupUi(lang);
    ui.show(true);
    ui.panel.querySelector("input").value = "Unsaved note";
    ui.task.mockups.files.push("option-c.html");
    ui.render();
    expect(ui.panel.querySelector("input").value).toBe("Unsaved note");
    ui.task.id = "another-screen";
    ui.render();
    expect(ui.panel.querySelector("input").value).toBe("");
  });
});
