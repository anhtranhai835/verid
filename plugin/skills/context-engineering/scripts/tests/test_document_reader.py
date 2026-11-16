"""Real document extraction, bounded reads, provenance and failure regressions."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "document_reader.py"
SPEC = importlib.util.spec_from_file_location("document_reader", SCRIPT)
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


class DocumentReaderTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)

    def docx(self, body, extras=None):
        path = self.root / "requirements.docx"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="' + reader.W[1:-1] + '"><w:body>' + body + '</w:body></w:document>')
            for name, value in (extras or {}).items():
                archive.writestr(name, value)
        return path

    def test_docx_preserves_order_unicode_negation_and_table_cells(self):
        clause = "Không hoàn tiền sau 30 ngày; ngoại lệ: 5% phí."
        path = self.docx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quy tắc</w:t></w:r></w:p>'
                         '<w:p><w:r><w:t>' + escape(clause) + '</w:t></w:r></w:p>'
                         '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ngày</w:t></w:r></w:p></w:tc>'
                         '<w:tc><w:p><w:r><w:t>≤ 30</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
        before = path.read_bytes()
        document = reader.load_document(path)
        self.assertEqual([b["kind"] for b in document["blocks"]], ["heading", "paragraph", "table"])
        self.assertEqual(document["blocks"][1]["text"], clause)
        self.assertEqual(json.loads(document["blocks"][2]["text"]), [["Ngày", "≤ 30"]])
        self.assertEqual(document["blocks"][1]["locator"], "paragraph 2")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(document["sha256"], hashlib.sha256(before).hexdigest())

    def test_docx_reports_unextracted_notes_changes_and_unsupported_blocks(self):
        path = self.docx('<w:p><w:del><w:r><w:delText>old</w:delText></w:r></w:del>'
                         '<w:ins><w:r><w:t>new</w:t></w:r></w:ins></w:p><w:sdt/>',
                         {"word/footnotes.xml": "<notes/>", "word/header1.xml": "<header/>"})
        document = reader.load_document(path)
        warnings = "\n".join(document["warnings"])
        self.assertIn("Tracked changes", warnings)
        self.assertIn("word/footnotes.xml", warnings)
        self.assertIn("word/header1.xml", warnings)
        self.assertIn("Unsupported body element: sdt", warnings)
        self.assertEqual(document["blocks"][0]["text"], "new")

    def test_bounded_continuation_recovers_the_entire_original_clause(self):
        path = self.root / "large.txt"
        text = "Không bỏ ngoại lệ: " + "đơn vị ≤ 30; " * 1000
        path.write_text(text, encoding="utf-8")
        document = reader.load_document(path)
        self.assertLess(len(json.dumps(reader.select(document), ensure_ascii=False)), len(text))
        offset, reconstructed = 0, ""
        while True:
            packet = reader.select(document, mode="read", ids=["b0001"], max_chars=137, offset=offset)
            block = packet["blocks"][0]
            self.assertLessEqual(len(block["text"]), 137)
            reconstructed += block["text"]
            if "next_offset" not in block:
                break
            self.assertFalse(packet["selection_complete"])
            offset = block["next_offset"]
        self.assertEqual(reconstructed, text)

    def test_pagination_search_and_line_citations_do_not_imply_full_coverage(self):
        path = self.root / "spec.md"
        path.write_text("# Scope\n\nGiữ đơn vị\n\n# Refund\n\nKhông hoàn tiền\n\nOther rules", encoding="utf-8")
        document = reader.load_document(path)
        first = reader.select(document, limit=2)
        second = reader.select(document, start=first["next_start"], limit=2)
        self.assertNotEqual(first["blocks"][0]["id"], second["blocks"][0]["id"])
        found = reader.select(document, mode="search", query="KHÔNG")
        self.assertEqual(found["matched_blocks"], 1)
        self.assertEqual(found["blocks"][0]["locator"], "lines 7-7")
        self.assertFalse(found["selection_complete"])
        full = reader.select(document, mode="read")
        self.assertTrue(full["selection_complete"])

    def test_multi_block_read_names_unread_blocks_after_a_truncated_one(self):
        path = self.root / "spec.txt"
        path.write_text("first " * 30 + "\n\nsecond", encoding="utf-8")
        packet = reader.select(reader.load_document(path), mode="read", max_chars=20)
        self.assertEqual(packet["next_start"], 2)
        self.assertEqual(packet["blocks"][0]["next_offset"], 20)
        self.assertFalse(packet["selection_complete"])

    def test_cli_refuses_stale_source_invalid_selection_and_unsupported_format(self):
        path = self.root / "spec.txt"
        path.write_text("original", encoding="utf-8")
        original = reader.load_document(path)["sha256"]
        path.write_text("changed", encoding="utf-8")
        process = subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), str(path),
                                  "--expect-sha256", original], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(process.returncode, 1)
        self.assertEqual(process.stdout, "")
        self.assertIn("Source changed", json.loads(process.stderr)["error"])
        with self.assertRaisesRegex(ValueError, "Unknown block"):
            reader.select(reader.load_document(path), ids=["b9999"])
        with self.assertRaisesRegex(ValueError, "exactly one"):
            reader.select(reader.load_document(path), mode="read", offset=1)
        legacy = self.root / "old.doc"
        legacy.write_bytes(b"not a docx")
        with self.assertRaisesRegex(ValueError, "Unsupported format"):
            reader.load_document(legacy)

    def test_markdown_fence_keeps_internal_blank_lines_and_utf8(self):
        path = self.root / "code.md"
        text = "```text\nKhông xoá\n\nNgoại lệ\n```"
        path.write_text(text, encoding="utf-8")
        self.assertEqual(reader.load_document(path)["blocks"][0]["text"], text)

    @unittest.skipUnless(importlib.util.find_spec("pypdf"), "optional pypdf is not available")
    def test_real_pdf_keeps_page_numbers_text_and_missing_text_flags(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=200, height=200)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                 NameObject("/Subtype"): NameObject("/Type1"),
                                 NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 10 100 Td (Refund within 30 days) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
        writer.add_blank_page(width=200, height=200)
        path = self.root / "requirements.pdf"
        writer.write(path)
        document = reader.load_document(path)
        self.assertEqual(len(document["blocks"]), 2)
        self.assertIn("Refund within 30 days", document["blocks"][0]["text"])
        self.assertEqual(document["blocks"][1]["locator"], "page 2")
        self.assertIn("No extractable text", document["blocks"][1]["warnings"][0])
        preview = reader.select(document)
        self.assertIn("warnings", preview["blocks"][1])
        writer.encrypt("synthetic-test-password")
        encrypted = self.root / "encrypted.pdf"
        writer.write(encrypted)
        with self.assertRaisesRegex(ValueError, "Encrypted PDF"):
            reader.load_document(encrypted)


if __name__ == "__main__":
    unittest.main()
