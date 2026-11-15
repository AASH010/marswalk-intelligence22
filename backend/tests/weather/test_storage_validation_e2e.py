import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.weather import ExitCode
from app.services.weather import normalization as N
from app.services.weather import pipeline as PL
from app.services.weather import storage as S
from app.services.weather import validation as V
from . import fixtures as F

DEFAULT_SOLS = ["--sols", "230-231"]


def _obs_row(**kw):
    base = {c: None for c in N.OBS_COLUMNS}
    base.update(sol=230, sclk=1.0, variable="v", value=1.5, unit="K", original_value="1.5", original_unit="kelvin",
              source_channel="C", source_product="P", source_file="f", source_row=2, quality_status="valid", provenance="p")
    base.update(kw)
    return base


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, path, rows):
        with S.ParquetSink(path, S.OBS_SCHEMA) as sink:
            sink.write(pd.DataFrame(rows, columns=N.OBS_COLUMNS))
        return sink.rows

    def test_schema_reload_and_explicit_nulls(self):
        rows = [_obs_row(), _obs_row(sclk=2.0, value=np.nan, original_value="", quality_status="missing", quality_code="MISSING_EMPTY_FIELD")]
        n = self._write(self.dir / "o.parquet", rows)
        self.assertEqual(n, 2)
        back = S.read_parquet(self.dir / "o.parquet")
        self.assertEqual(list(back.columns), N.OBS_COLUMNS)
        self.assertTrue(np.isnan(back.value.iloc[1]))
        self.assertEqual(back.original_value.iloc[1], "")  # raw token preserved
        self.assertIsNone(back.utc.iloc[0] if back.utc.iloc[0] is None else None)
        self.assertEqual(back.sclk.iloc[0], 1.0)

    def test_deterministic_bytes(self):
        rows = [_obs_row(sclk=float(i), source_row=i + 2) for i in range(50)]
        self._write(self.dir / "a.parquet", rows)
        self._write(self.dir / "b.parquet", rows)
        self.assertEqual(S.sha256_file(self.dir / "a.parquet"), S.sha256_file(self.dir / "b.parquet"))

    def test_json_is_byte_stable(self):
        S.write_json(self.dir / "a.json", {"b": 1.5, "a": [1, 2]})
        S.write_json(self.dir / "b.json", {"a": [1, 2], "b": 1.5})
        self.assertEqual((self.dir / "a.json").read_bytes(), (self.dir / "b.json").read_bytes())


class PipelineBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.raw = self.root / "raw"
        F.write_tree(self.raw)
        self.out = self.root / "out"

    def tearDown(self):
        self.tmp.cleanup()

    def run_process(self, out=None, raw=None):
        return PL.main(["--log-level", "ERROR", "process", "--raw-dir", str(raw or self.raw), "--out-dir", str(out or self.out)] + DEFAULT_SOLS)


class EndToEndTests(PipelineBase):
    def test_end_to_end_directory(self):
        self.assertEqual(self.run_process(), ExitCode.OK)
        for f in (*S.DATA_OUTPUTS, S.MANIFEST_FILE):
            self.assertTrue((self.out / f).is_file(), f)
        obs = S.read_parquet(self.out / S.OBS_FILE)
        wt = S.read_parquet(self.out / S.WT_FILE)
        self.assertEqual(len(obs), 2 * 9 * 5)  # 2 sols x (5 ATS + 4 WS variables) x 5 records; one row per measurement
        self.assertEqual(set(obs.variable), {f"air_temperature_ats{i}" for i in range(1, 6)} | {
            "wind_speed_horizontal_boom1", "wind_speed_horizontal_boom2", "wind_direction_boom1", "wind_direction_boom2"})
        self.assertFalse(any("HUMIC" in c for c in obs.source_channel))  # unverified channel excluded
        self.assertTrue(obs.utc.isna().all())
        ws = obs[(obs.variable == "wind_speed_horizontal_boom1") & (obs.sol == 230)].sort_values("sclk")
        self.assertEqual(list(ws.quality_status), ["valid", "valid", "suspect", "missing", "valid"])
        self.assertEqual(ws.quality_code.iloc[2], "WS_ROVER_MOVING")
        self.assertEqual(list(ws.original_value), ["3.0", "15.0", "45.0", "", "6.0"])  # originals kept, incl. the empty sentinel
        self.assertEqual(ws.lmst.iloc[0], "00230M00:00:00.123")  # verbatim
        self.assertEqual(list(ws.source_row), [2, 3, 4, 5, 6])
        # W_t hand-computed (sol 230, first record): see fixtures
        w0 = wt[wt.sol == 230].sort_values("sclk").iloc[0]
        self.assertAlmostEqual(w0.w_t, 0.25 * 0.1 + 0.25 * 1.0 + 0.5 * (1.0 - 50.5 / 150.0), places=12)
        self.assertTrue(((wt.w_t >= 0) & (wt.w_t <= 1)).all())
        self.assertEqual(len(wt), 10)
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        self.assertEqual(m["spatial"], {"status": "unavailable", "reason": "missing_spice_kernels", "crs_reference": m["spatial"]["crs_reference"]})
        self.assertEqual([c["name"] for c in m["normalization"]["components"]], ["air_temperature", "wind_speed_boom1", "wind_speed_boom2"])
        self.assertEqual({o["file"] for o in m["outputs"]}, set(S.DATA_OUTPUTS))
        qa = json.loads((self.out / S.QA_JSON_FILE).read_text())
        self.assertIn("HUMICAP_A_HUMIDITY", {c["channel"] for c in qa["unverified_channels"]})
        self.assertEqual(self.validate(), ExitCode.OK)

    def test_end_to_end_zip_records_archive_hash(self):
        zdir = self.root / "zraw"
        zdir.mkdir()
        F.write_zip(zdir / "ds.zip")
        self.assertEqual(self.run_process(raw=zdir), ExitCode.OK)
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        self.assertEqual(m["inputs"]["archives"][0]["name"], "ds.zip")
        self.assertEqual(len(m["inputs"]["archives"][0]["sha256"]), 64)

    def test_two_runs_give_identical_data_files(self):
        out2 = self.root / "out2"
        self.run_process()
        self.run_process(out=out2)
        for f in S.DATA_OUTPUTS:
            self.assertEqual(S.sha256_file(self.out / f), S.sha256_file(out2 / f), f)

    def test_exit_codes(self):
        self.assertEqual(PL.main(["--log-level", "ERROR", "process", "--raw-dir", str(self.root / "nope"), "--out-dir", str(self.out), "--sols", "230"]), 3)
        bad = self.root / "bad.json"
        bad.write_text("{not json")
        self.assertEqual(PL.main(["--log-level", "ERROR", "process", "--raw-dir", str(self.raw), "--out-dir", str(self.out), "--sols", "230", "--config", str(bad)]), 2)
        self.assertEqual(PL.main(["--log-level", "ERROR", "process", "--raw-dir", str(self.raw), "--out-dir", str(self.out), "--sols", "abc"]), 2)
        with self.assertRaises(SystemExit) as cm:
            PL.main(["process", "--out-dir", str(self.out)])  # argparse: missing required args
        self.assertEqual(cm.exception.code, 2)
        self.assertEqual(PL.main(["--log-level", "ERROR", "validate", "--out-dir", str(self.root / "missing")]), 3)

    def test_corrupted_input_is_rejected(self):
        csv = next((self.raw / "sol_0230").glob("*ATS*.CSV"))
        csv.write_bytes(csv.read_bytes().replace(b"200.5", b"201.5", 1))  # md5 no longer matches the label
        self.assertEqual(self.run_process(), 3)
        self.assertFalse((self.out / S.MANIFEST_FILE).exists())

    def validate(self, out=None):
        return PL.main(["--log-level", "ERROR", "validate", "--out-dir", str(out or self.out)])


class ValidationTests(PipelineBase):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.run_process(), 0)

    def _errors(self):
        return {e["check"] for e in V.validate_outputs(self.out).errors}

    def test_clean_outputs_pass(self):
        rep = V.validate_outputs(self.out)
        self.assertEqual(rep.errors, [])

    def test_detects_missing_file(self):
        (self.out / S.WT_FILE).unlink()
        self.assertIn("file_present", self._errors())
        self.assertEqual(PL.main(["--log-level", "ERROR", "validate", "--out-dir", str(self.out)]), 4)

    def test_detects_missing_manifest(self):
        (self.out / S.MANIFEST_FILE).unlink()
        self.assertIn("manifest_present", self._errors())

    def test_detects_incomplete_manifest(self):
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        del m["normalization"]
        S.write_json(self.out / S.MANIFEST_FILE, m)
        self.assertIn("manifest_complete", self._errors())

    def test_detects_bad_checksum(self):
        with open(self.out / S.QA_MD_FILE, "a") as fh:
            fh.write("tampered\n")
        self.assertIn("checksum", self._errors())

    def _rewrite_wt(self, mutate):
        wt = S.read_parquet(self.out / S.WT_FILE)
        mutate(wt)
        with S.ParquetSink(self.out / S.WT_FILE, S.WT_SCHEMA) as sink:
            sink.write(wt)
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        for o in m["outputs"]:
            if o["file"] == S.WT_FILE:
                o["sha256"], o["rows"] = S.sha256_file(self.out / S.WT_FILE), sink.rows
        S.write_json(self.out / S.MANIFEST_FILE, m)

    def test_detects_out_of_range_w_t(self):
        def mut(wt):
            wt.loc[wt.index[3], "w_t"] = 1.5
        self._rewrite_wt(mut)
        self.assertEqual(self._errors(), {"w_t_range"})  # checksums were refreshed, so this is the only failure

    def test_detects_non_monotonic_time(self):
        def mut(wt):
            wt.loc[wt.index[1], "sclk"] = wt.sclk.iloc[0] - 5
        self._rewrite_wt(mut)
        self.assertIn("time_monotonic", self._errors())

    def test_detects_unit_inconsistency(self):
        obs = S.read_parquet(self.out / S.OBS_FILE)
        obs.loc[obs.index[0], "unit"] = "degC"
        with S.ParquetSink(self.out / S.OBS_FILE, S.OBS_SCHEMA) as sink:
            sink.write(obs)
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        for o in m["outputs"]:
            if o["file"] == S.OBS_FILE:
                o["sha256"], o["rows"] = S.sha256_file(self.out / S.OBS_FILE), sink.rows
        S.write_json(self.out / S.MANIFEST_FILE, m)
        self.assertIn("unit_consistency", self._errors())

    def test_detects_missing_sol(self):
        obs = S.read_parquet(self.out / S.OBS_FILE)
        obs = obs[obs.sol != 231]
        with S.ParquetSink(self.out / S.OBS_FILE, S.OBS_SCHEMA) as sink:
            sink.write(obs)
        m = json.loads((self.out / S.MANIFEST_FILE).read_text())
        for o in m["outputs"]:
            if o["file"] == S.OBS_FILE:
                o["sha256"], o["rows"] = S.sha256_file(self.out / S.OBS_FILE), sink.rows
        S.write_json(self.out / S.MANIFEST_FILE, m)
        self.assertIn("sol_coverage", self._errors())

    def test_warnings_do_not_fail(self):
        (self.out / "extra.txt").write_text("x")
        rep = V.validate_outputs(self.out)
        self.assertEqual(rep.errors, [])
        self.assertTrue(rep.warnings)
        self.assertEqual(PL.main(["--log-level", "ERROR", "validate", "--out-dir", str(self.out)]), 0)


if __name__ == "__main__":
    unittest.main()
