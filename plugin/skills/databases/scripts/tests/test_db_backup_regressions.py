"""Subprocess boundary regressions; no database or third-party test packages required."""

import contextlib
import gzip
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "db_backup.py"
SPEC = importlib.util.spec_from_file_location("verid_backup_regressions", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
SQL = b"CREATE TABLE example(id integer);\nINSERT INTO example VALUES (1);\n"
POPEN = subprocess.Popen


class BackupRegressions(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="verid-backup-test-")
        self.folder = Path(self.temporary.name).resolve()
        assert self.folder.is_relative_to(Path(tempfile.gettempdir()).resolve())
        assert self.folder.name.startswith("verid-backup-test-")
        self.addCleanup(self.temporary.cleanup)
        self.manager = MODULE.BackupManager("postgres", str(self.folder))

    def dump(self, exit_code=0):
        def start(command, **kwargs):
            self.assertEqual(command[0], "pg_dump")
            return POPEN(
                [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({SQL!r}); sys.exit({exit_code})"],
                **kwargs,
            )
        return patch.object(MODULE.subprocess, "Popen", side_effect=start)

    def test_compressed_backup_waits_for_dump_and_contains_sql(self):
        with self.dump():
            result = self.manager.create_backup("postgresql://example.invalid/demo", "demo")
        self.assertIsNotNone(result)
        with gzip.open(self.folder / result.filename, "rb") as backup:
            self.assertEqual(backup.read(), SQL)
        self.assertTrue(result.verified)

    def test_failed_dump_does_not_publish_a_partial_backup(self):
        with self.dump(exit_code=1):
            result = self.manager.create_backup("postgresql://example.invalid/demo", "demo")
        self.assertIsNone(result)
        self.assertEqual(list(self.folder.iterdir()), [])

    def archive(self):
        archive = self.folder / "demo.sql.gz"
        with gzip.open(archive, "wb") as backup:
            backup.write(SQL)
        return archive

    def test_compressed_restore_passes_plain_sql_to_psql(self):
        archive = self.archive()
        def restore(command, **kwargs):
            self.assertIn("ON_ERROR_STOP=1", command)
            self.assertEqual(os.read(kwargs["stdin"].fileno(), len(SQL) + 1), SQL)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        with patch.object(MODULE.subprocess, "run", side_effect=restore):
            self.assertTrue(self.manager.restore_backup(archive.name, "postgresql://example.invalid/demo"))

    def test_restore_propagates_sql_errors(self):
        archive = self.archive()
        result = subprocess.CompletedProcess(["psql"], 1, stdout="", stderr="SQL failed")
        with patch.object(MODULE.subprocess, "run", return_value=result):
            self.assertFalse(self.manager.restore_backup(archive.name, "postgresql://example.invalid/demo"))

    def test_metadata_is_read_and_removed_with_its_backup(self):
        from datetime import datetime
        archive = self.archive()
        info = MODULE.BackupInfo(archive.name, "postgres", "demo", datetime.now(), archive.stat().st_size, True)
        self.manager._save_metadata(info)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertTrue(self.manager.restore_backup(archive.name, "postgresql://example.invalid/demo", dry_run=True))
        self.assertIn("Database: demo", output.getvalue())
        old = datetime.now().timestamp() - 10 * 24 * 3600
        os.utime(archive, (old, old))
        self.assertEqual(self.manager.cleanup_old_backups(7), 1)
        self.assertEqual(list(self.folder.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
