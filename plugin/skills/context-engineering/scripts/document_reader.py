#!/usr/bin/env python3
"""Read bounded, source-addressable document excerpts without modifying any files."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

VERSION = 1
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def word_text(element):
    parts = []
    for node in element.iter():
        if node.tag == W + "t":
            parts.append(node.text or "")
        elif node.tag == W + "tab":
            parts.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            parts.append("\n")
    return "".join(parts)


def docx_blocks(raw):
    blocks, warnings = [], []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if sum(info.file_size for info in archive.infolist()) > 100 * 1024 * 1024:
            raise ValueError("DOCX expanded size exceeds 100 MiB; use a dedicated extractor")
        document = ET.fromstring(archive.read("word/document.xml"))
        body = document.find(W + "body")
        if body is None:
            raise ValueError("DOCX has no document body")
        styles = {}
        if "word/styles.xml" in archive.namelist():
            for style in ET.fromstring(archive.read("word/styles.xml")).findall(W + "style"):
                name = style.find(W + "name")
                styles[style.get(W + "styleId")] = name.get(W + "val", "") if name is not None else ""
        paragraph, table = 0, 0
        for child in body:
            if child.tag == W + "p":
                paragraph += 1
                text = word_text(child)
                style = child.find("./" + W + "pPr/" + W + "pStyle")
                style_id = style.get(W + "val", "") if style is not None else ""
                heading = bool(re.match(r"heading\s*\d|title$", styles.get(style_id, style_id), re.I))
                if text.strip():
                    blocks.append({"kind": "heading" if heading else "paragraph",
                                   "locator": "paragraph " + str(paragraph), "text": text})
            elif child.tag == W + "tbl":
                table += 1
                rows = []
                for row in child.findall(W + "tr"):
                    cells = []
                    for cell in row.findall(W + "tc"):
                        cells.append("\n".join(word_text(p) for p in cell.iter(W + "p")))
                    rows.append(cells)
                # JSON preserves cell boundaries, tabs and newlines without inventing columns.
                blocks.append({"kind": "table", "locator": "table " + str(table),
                               "text": json.dumps(rows, ensure_ascii=False)})
            elif child.tag != W + "sectPr":
                warnings.append("Unsupported body element: " + child.tag.split("}")[-1])
        tags = {node.tag for node in document.iter()}
        for names, message in [
            (("ins", "del", "moveFrom", "moveTo"), "Tracked changes need original review; deleted text is not included"),
            (("numPr",), "Automatic list numbering is not resolved"),
            (("drawing", "pict", "object", "txbxContent", "oMath", "oMathPara"), "Drawings, text boxes, embedded objects or equations need visual review"),
            (("gridSpan", "vMerge"), "Merged table cells need original layout review"),
            (("hyperlink", "fldSimple", "instrText"), "Hyperlink targets or fields need original review"),
        ]:
            if any(W + name in tags or any(tag.endswith("}" + name) for tag in tags) for name in names):
                warnings.append(message)
        if len(document.findall(".//" + W + "tbl")) > table:
            warnings.append("Nested tables are flattened inside cells; inspect their layout")
        for name in archive.namelist():
            if re.match(r"word/(?:footnotes|endnotes|comments|header\d*|footer\d*)\.xml$", name):
                warnings.append("Not extracted: " + name)
    return blocks, warnings, "Body text only; verify flagged content and visual meaning in the original"


def text_blocks(raw):
    text = raw.decode("utf-8-sig").replace("\r\n", "\n")
    blocks, pending, first, fence = [], [], 1, None

    def flush(last):
        if pending:
            value = "\n".join(pending)
            blocks.append({"kind": "heading" if re.match(r"^#{1,6}\s", value) else "text",
                           "locator": "lines %d-%d" % (first, last), "text": value})
            pending.clear()

    for number, line in enumerate(text.splitlines(), 1):
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if not fence and (not line.strip() or re.match(r"^#{1,6}\s", line)):
            flush(number - 1)
        if line.strip() or fence:
            if not pending:
                first = number
            pending.append(line)
        if marker:
            if fence and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            elif not fence:
                fence = marker[1]
    flush(len(text.splitlines()))
    return blocks, [], "UTF-8 text with line locators; no semantic or visual interpretation"


def pdf_blocks(raw):
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise ValueError("PDF needs an available pypdf installation or a host PDF tool; nothing was installed") from error
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted:
        raise ValueError("Encrypted PDF; use an authorized host tool to read it")
    blocks, warnings = [], []
    for number, page in enumerate(reader.pages, 1):
        issues = []
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            # Some pypdf versions raise in layout mode on a page with no content or fonts.
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
                issues.append("Text extraction failed; inspect the original")
        if not text.strip():
            issues.append("No extractable text; inspect or OCR if needed")
        if issues:
            warnings.append("Some pages have missing/failed text; inspect warnings on their blocks")
        blocks.append({"kind": "page", "locator": "page " + str(number), "text": text,
                       "warnings": issues})
    return blocks, warnings, "PDF text only; verify page layout, tables, images, formulas and existing OCR"


def load_document(path, expected_hash=None):
    source = Path(path)
    if source.stat().st_size > 50 * 1024 * 1024:
        raise ValueError("Input exceeds 50 MiB; use a dedicated extractor")
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected_hash and digest != expected_hash:
        raise ValueError("Source changed: SHA-256 does not match; rebuild the source map")
    extract = {".docx": docx_blocks, ".pdf": pdf_blocks, ".md": text_blocks,
               ".markdown": text_blocks, ".txt": text_blocks}.get(source.suffix.lower())
    if extract is None:
        raise ValueError("Unsupported format; use DOCX, PDF, Markdown/TXT or an explicit derived export")
    blocks, warnings, limitations = extract(raw)
    for index, block in enumerate(blocks, 1):
        block["id"] = "b%04d" % index
    return {"source": str(source), "sha256": digest, "extractor_version": VERSION,
            "limitations": limitations, "warnings": sorted(set(warnings)), "blocks": blocks}


def select(document, mode="outline", query=None, ids=None, start=1, limit=20,
           max_chars=6000, offset=0):
    blocks = document["blocks"]
    if ids:
        known = {block["id"]: block for block in blocks}
        if any(name not in known for name in ids):
            raise ValueError("Unknown block ID; refresh the outline for this source version")
        blocks = [known[name] for name in ids]
    matcher = re.compile(re.escape(query), re.I) if query else None
    if mode == "search":
        if matcher is None:
            raise ValueError("Search requires --query")
        blocks = [block for block in blocks if matcher.search(block["text"])]
    if offset and (mode != "read" or not ids or len(ids) != 1):
        raise ValueError("--offset requires read mode and exactly one --ids value")
    if start > len(blocks) and blocks:
        raise ValueError("--start exceeds the selected block count")
    result = {key: value for key, value in document.items() if key != "blocks"}
    result.update(mode=mode, total_blocks=len(document["blocks"]), matched_blocks=len(blocks),
                  text_budget_chars=max_chars, blocks=[])
    remaining, consumed = max_chars, 0
    for block in blocks[start - 1:start - 1 + limit]:
        if remaining <= 0:
            break
        value = {key: block[key] for key in ("id", "kind", "locator")}
        if block.get("warnings"):
            value["warnings"] = block["warnings"]
        text = block["text"]
        begin = offset if mode == "read" else 0
        if begin > len(text):
            raise ValueError("--offset exceeds block length")
        if mode == "search":
            begin = max(0, matcher.search(text).start() - 80)
        count = remaining if mode == "read" else min(160 if mode == "search" else 80, remaining)
        excerpt = text[begin:begin + count]
        value.update(text=excerpt, text_start=begin, text_end=begin + len(excerpt),
                     total_chars=len(text), truncated=begin > 0 or begin + len(excerpt) < len(text))
        if mode == "read" and value["text_end"] < len(text):
            value["next_offset"] = value["text_end"]
        result["blocks"].append(value)
        consumed += 1
        remaining -= len(excerpt)
        if mode == "read" and "next_offset" in value:
            break
    result["next_start"] = start + consumed if start - 1 + consumed < len(blocks) else None
    result["selection_complete"] = mode == "read" and start == 1 and consumed == len(blocks) and all(
        not block["truncated"] for block in result["blocks"])
    return result


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--mode", choices=("outline", "search", "read"), default="outline")
    parser.add_argument("--query", help="Literal, case-insensitive search text")
    parser.add_argument("--ids", help="Comma-separated block IDs from the same source SHA-256")
    parser.add_argument("--expect-sha256")
    parser.add_argument("--start", type=positive, default=1, help="1-based position within the selection")
    parser.add_argument("--limit", type=positive, default=20)
    parser.add_argument("--max-chars", type=positive, default=6000, help="Excerpt text budget, not tokens or total JSON size")
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()
    if args.limit > 100 or args.max_chars > 20000 or args.offset < 0:
        parser.error("limit must be <= 100, max-chars <= 20000 and offset >= 0")
    try:
        document = load_document(args.path, args.expect_sha256)
        result = select(document, args.mode, args.query, args.ids.split(",") if args.ids else None,
                        args.start, args.limit, args.max_chars, args.offset)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
