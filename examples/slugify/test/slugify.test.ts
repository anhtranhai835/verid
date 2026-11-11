import { describe, expect, it } from "vitest";
import { slugify } from "../src/slugify.js";

// verid's tester agent adds a failing test here for each acceptance criterion.
describe("slugify", () => {
  it("is exported", () => {
    expect(typeof slugify).toBe("function");
  });
});
