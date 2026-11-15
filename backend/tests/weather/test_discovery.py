import tempfile
import unittest
import zipfile
from pathlib import Path

from app.services.weather import ConfigError, InputError
from app.services.weather import discovery as D
from . import fixtures as F


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_parse_sols(self):
        self.assertEqual(D.parse_sols("230-232"), [230, 231, 232])
        self.assertEqual(D.parse_sols("230,235-236"), [230, 235, 236])
        for bad in ("", "x", "5-2", "1,,2"):
            with self.assertRaises(ConfigError):
                D.parse_sols(bad)

    def test_directory_tree_and_sol_filter(self):
        F.write_tree(self.root, sols=(230, 231, 232))
        d = D.discover(self.root, [230, 231])
        self.assertEqual(sorted({p.sol for p in d.products}), [230, 231])
        self.assertEqual(len(d.products), 6)
        self.assertEqual({p.product_type for p in d.products}, {"ATS", "WS", "RHS"})
        self.assertTrue(all(not Path(p.data.rel).is_absolute() for p in d.products))

    def test_zip_archive_is_read_without_extraction(self):
        F.write_zip(self.root / "a.zip")
        d = D.discover(self.root, [230, 231])
        self.assertEqual(len(d.products), 6)
        self.assertEqual(d.archives[0]["name"], "a.zip")
        self.assertEqual(len(d.archives[0]["sha256"]), 64)
        self.assertIn("a.zip!/", d.products[0].data.rel)
        self.assertTrue(d.products[0].data.read_bytes().startswith(b"SCLK"))

    def test_malformed_archive_is_fatal_input_error(self):
        (self.root / "bad.zip").write_bytes(b"this is not a zip")
        with self.assertRaises(InputError):
            D.discover(self.root, [230])

    def test_corrupt_member_is_detected(self):
        F.write_zip(self.root / "a.zip", sols=(230,))
        raw = bytearray((self.root / "a.zip").read_bytes())
        raw[200] ^= 0xFF  # flip a byte inside the compressed stream
        (self.root / "a.zip").write_bytes(bytes(raw))
        with self.assertRaises(InputError):
            D.discover(self.root, [230])

    def test_missing_partner_and_missing_sol(self):
        F.write_tree(self.root, sols=(230,))
        next((self.root / "sol_0230").glob("*WS*.xml")).unlink()
        with self.assertRaises(InputError):
            D.discover(self.root, [230])  # strict
        d = D.discover(self.root, [230, 231], strict=False)
        kinds = {f["failure"] for f in d.failures}
        self.assertEqual(kinds, {"missing_partner_file", "no_products_for_sol"})

    def test_no_products_at_all(self):
        with self.assertRaises(InputError):
            D.discover(self.root, [230])
        with self.assertRaises(InputError):
            D.discover(self.root / "missing", [230])

    def test_highest_version_selected_and_superseded_reported(self):
        d230 = self.root / "sol_0230"
        d230.mkdir()
        for v in (1, 2):
            stem, csv, xml = F.make_product("ATS", 230, version=v)
            (d230 / f"{stem}.CSV").write_bytes(csv)
            (d230 / f"{stem}.xml").write_bytes(xml)
        d = D.discover(self.root, [230])
        self.assertEqual(len(d.products), 1)
        self.assertEqual(d.products[0].version, 2)
        self.assertEqual(len(d.superseded), 1)

    def test_conflicting_copies_in_tree_and_zip_are_rejected(self):
        F.write_tree(self.root / "tree", sols=(230,), types=("ATS",))
        stem, csv, xml = F.make_product("ATS", 230, mutate_rows=lambda r: r[:-1])
        with zipfile.ZipFile(self.root / "z.zip", "w") as zf:
            zf.writestr(f"{stem}.CSV", csv)
            zf.writestr(f"{stem}.xml", xml)
        with self.assertRaises(InputError):
            D.discover(self.root, [230])
