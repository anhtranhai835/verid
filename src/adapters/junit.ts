import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { TestCase } from "../core/tdd.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false, // keep failure text as text, never as a number
  isArray: (name) => name === "testsuites" || name === "testsuite" || name === "testcase",
});

/** Test cases from a JUnit XML report; null when the file is missing or not well-formed. */
export function readJUnit(file: string): TestCase[] | null {
  let xml: string;
  try {
    xml = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (XMLValidator.validate(xml) !== true) return null;
  const cases: TestCase[] = [];
  collect(parser.parse(xml), cases);
  return cases;
}

// Suites may nest (pytest, Gradle); vitest writes <testsuites><testsuite><testcase>.
function collect(node: unknown, out: TestCase[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  for (const c of list(n.testcase)) out.push(toCase(c));
  for (const child of [...list(n.testsuites), ...list(n.testsuite)]) collect(child, out);
}

function toCase(raw: unknown): TestCase {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = str(c.name);
  const cls = str(c.classname);
  const id = cls && cls !== name ? `${cls} > ${name}` : name || cls;
  const problem = c.failure ?? c.error;
  if (problem !== undefined) return { id, status: "failed", message: text(problem) };
  if (c.skipped !== undefined) return { id, status: "skipped", message: "" };
  return { id, status: "passed", message: "" };
}

/** Body of the first <failure>/<error>, falling back to its message attribute. */
function text(v: unknown): string {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === "string") return first.trim();
  if (!first || typeof first !== "object") return "";
  const o = first as Record<string, unknown>;
  return (str(o["#text"]) || str(o.message)).trim();
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
