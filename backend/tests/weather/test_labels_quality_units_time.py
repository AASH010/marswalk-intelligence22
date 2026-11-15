import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.weather import InputError, UnitError
from app.services.weather import normalization as N
from app.services.weather import parsers as P
from app.services.weather import quality as Q
from app.services.weather import temporal as T
from . import fixtures as F


def _verify(ptype="WS", headers=None, cfg_mut=None, fields=None):
    stem, csv, xml = F.make_product(ptype, 230, F.WS_HEADER_OVERRIDE if ptype == "WS" else None, fields=fields)
    label = P.parse_label(xml)
    df = P.read_table(csv)
    d = F.default_cfg_dict()
    if cfg_mut:
        cfg_mut(d)
    cfg = F.cfg_from(d)
    return label, df, N.verify_channels(ptype, label, headers or list(df.columns), cfg), cfg


class LabelAndVerification(unittest.TestCase):
    def test_label_fields_units_and_counts(self):
        label = P.parse_label(F.make_product("WS", 230)[2])
        self.assertEqual(label.processing_level, "Calibrated")
        self.assertEqual(label.instrument, "Mars Environmental Dynamics Analyzer (MEDA)")
        self.assertEqual(label.table_records, 5)
        f = {x.name: x for x in label.fields}
        self.assertEqual(f["BOOM1_HORIZONTAL_WIND_SPEED"].unit, "meter/second")
        self.assertIsNone(f["BOOM1_HORIZONTAL_WIND_SPEED_UNCERTAINTY"].unit)

    def test_malformed_label_rejected(self):
        with self.assertRaises(InputError):
            P.parse_label(b"<not xml")
        with self.assertRaises(InputError):
            P.parse_label(b'<Product_Observational xmlns="http://pds.nasa.gov/pds4/pds/v1"/>')

    def test_verified_channels_and_alias(self):
        _, _, v, _ = _verify()
        self.assertEqual(v.get("BOOM1_HORIZONTAL_WIND_SPEED").status, "verified")
        flag = v.get("BOOM1_ALG_IN_STABLE_STATE")
        self.assertEqual(flag.status, "verified")
        self.assertTrue(flag.alias_applied)
        self.assertEqual(flag.header, "BOOM1_ALG_STATE_STABLE")
        self.assertTrue(any("resolved" in w for w in v.warnings))

    def test_header_mismatch_without_alias_is_unverified(self):
        _, _, v, _ = _verify(cfg_mut=lambda d: d.__setitem__("header_aliases", []))
        flag = v.get("BOOM1_ALG_IN_STABLE_STATE")
        self.assertEqual(flag.status, "unverified")
        self.assertIn("header_label_name_mismatch", flag.reasons)

    def test_missing_unit_is_unverified(self):
        _, _, v, _ = _verify("RHS")
        h = v.get("HUMICAP_A_HUMIDITY")
        self.assertEqual(h.status, "unverified")
        self.assertIn("missing_unit_in_label", h.reasons)
        self.assertEqual(v.get("HUMICAP_TEMP").status, "verified")

    def test_uncertainty_without_unit_is_unverified(self):
        _, _, v, _ = _verify("WS")
        self.assertIn("missing_unit_in_label", v.get("BOOM1_HORIZONTAL_WIND_SPEED_UNCERTAINTY").reasons)

    def test_catalog_unit_mismatch_and_evidence(self):
        fields = [(n, t, ("celsius" if n == "ATS_LOCAL_TEMP1" else u), d) for n, t, u, d in F.ATS]
        _, _, v, _ = _verify("ATS", fields=fields)
        r = v.get("ATS_LOCAL_TEMP1")
        self.assertEqual(r.status, "unverified")
        self.assertTrue(any(x.startswith("catalog_unit_mismatch") for x in r.reasons))
        fields = [(n, t, u, ("Something unrelated" if n == "ATS_LOCAL_TEMP2" else d)) for n, t, u, d in F.ATS]
        _, _, v, _ = _verify("ATS", fields=fields)
        self.assertTrue(any(x.startswith("catalog_evidence_missing") for x in v.get("ATS_LOCAL_TEMP2").reasons))

    def test_shared_description_is_ambiguous(self):
        fields = list(F.ATS)
        fields[4] = (fields[4][0], fields[4][1], fields[4][2], fields[3][3])
        _, _, v, _ = _verify("ATS", fields=fields)
        self.assertIn("ambiguous_label_description_shared_with_other_field", v.get("ATS_LOCAL_TEMP2").reasons)
        self.assertIn("ambiguous_label_description_shared_with_other_field", v.get("ATS_LOCAL_TEMP1").reasons)

    def test_unverified_channels_are_excluded_from_observations(self):
        with tempfile.TemporaryDirectory() as t:
            from app.services.weather import discovery as D
            from app.services.weather import quality as QQ
            F.write_tree(Path(t), sols=(230,), types=("RHS",))
            prod = D.discover(Path(t), [230]).products[0]
            label = P.parse_label(prod.label.read_bytes())
            df = P.read_table(prod.data.read_bytes())
            cfg = F.cfg_from(F.default_cfg_dict())
            v = N.verify_channels("RHS", label, list(df.columns), cfg)
            obs = N.build_observations(df=df, product=prod, label=label, verification=v, cfg=cfg, qa=QQ.QAAccumulator(), component_vars=set())
            self.assertTrue(obs.empty)  # RHS has no catalogue variables; humidity is unverified


class QualityTests(unittest.TestCase):
    sent = F.cfg_from(F.default_cfg_dict()).sentinels

    def test_sentinel_and_invalid_mapping(self):
        tok = pd.Series(["1.5", "", "abc", "nan", "inf", " 2.0 "])
        vals, status, codes, _ = Q.classify(tok, self.sent, [], np.ones(6, bool))
        self.assertEqual(list(status), ["valid", "missing", "invalid", "invalid", "invalid", "valid"])
        self.assertEqual(codes[1], "MISSING_EMPTY_FIELD")
        self.assertEqual(codes[2], "INVALID_NON_NUMERIC")
        self.assertEqual(codes[3], "INVALID_NON_FINITE")
        self.assertTrue(np.isnan(vals[[1, 2, 3, 4]]).all())
        self.assertEqual(vals[5], 2.0)

    def test_numeric_sentinel_and_token(self):
        d = F.default_cfg_dict()
        d["sentinels"] = {"missing_tokens": ["", "N/A"], "numeric_sentinels": [-9999.0]}
        s = F.cfg_from(d).sentinels
        _, status, codes, _ = Q.classify(pd.Series(["-9999", "N/A", "3"]), s, [], np.ones(3, bool))
        self.assertEqual(list(status), ["missing", "missing", "valid"])
        self.assertEqual(codes[0], "MISSING_SENTINEL_NUMERIC")
        self.assertEqual(codes[1], "MISSING_SENTINEL_TOKEN")

    def test_flag_rules_and_precedence(self):
        flags = [Q.FlagSpec("R1", "MOVING", 0.0, "suspect", pd.Series(["1", "0", "0", ""]))]
        _, status, codes, masks = Q.classify(pd.Series(["5", "5", "", "5"]), self.sent, flags, np.ones(4, bool))
        self.assertEqual(list(status), ["valid", "suspect", "missing", "suspect"])
        self.assertEqual(codes[1], "MOVING")
        self.assertEqual(codes[3], "FLAG_MISSING:R1")
        self.assertEqual(int(masks["MOVING"].sum()), 1)  # flag not evaluated on the missing value

    def test_unverified_flag_channel_gives_unverified(self):
        flags = [Q.FlagSpec("R1", "MOVING", 0.0, "suspect", None)]
        _, status, _, _ = Q.classify(pd.Series(["5", ""]), self.sent, flags, np.ones(2, bool))
        self.assertEqual(list(status), ["unverified", "missing"])

    def test_bad_sclk_is_invalid(self):
        _, status, codes, _ = Q.classify(pd.Series(["5", "6"]), self.sent, [], np.array([True, False]))
        self.assertEqual(list(status), ["valid", "invalid"])
        self.assertEqual(codes[1], "INVALID_BAD_SCLK")


class UnitTests(unittest.TestCase):
    def test_round_trip(self):
        x = np.array([-40.0, 0.0, 12.345, 300.0])
        for src, dst in (("degC", "K"), ("degF", "K"), ("hPa", "Pa"), ("mbar", "Pa"), ("kPa", "Pa"), ("km/h", "m/s"), ("rad", "deg"), ("K", "K")):
            back = N.convert_back(N.convert(x, src, dst), src, dst)
            np.testing.assert_allclose(back, x, rtol=0, atol=1e-9, err_msg=f"{src}->{dst}")

    def test_documented_values(self):
        self.assertAlmostEqual(float(N.convert([0.0], "degC", "K")[0]), 273.15)
        self.assertAlmostEqual(float(N.convert([32.0], "degF", "K")[0]), 273.15)
        self.assertAlmostEqual(float(N.convert([7.0], "hPa", "Pa")[0]), 700.0)
        self.assertAlmostEqual(float(N.convert([36.0], "km/h", "m/s")[0]), 10.0)
        self.assertAlmostEqual(float(N.convert_uncertainty([1.0], "degC", "K")[0]), 1.0)  # no offset on differences

    def test_identity_leaves_values_untouched_and_unknown_raises(self):
        x = np.array([204.89, 1.0 / 3.0])
        self.assertTrue(np.array_equal(N.convert(x, "K", "K"), x))
        with self.assertRaises(UnitError):
            N.convert([1.0], "furlong", "K")


class TemporalTests(unittest.TestCase):
    def test_sclk_exact_and_strings_verbatim(self):
        s = pd.Series(["687312412", "687312412.123", " 687312413.5 ", "bad", ""])
        out = T.parse_sclk(s)
        self.assertEqual(out[0], 687312412.0)
        self.assertEqual(out[1], 687312412.123)  # no rounding
        self.assertEqual(out[2], 687312413.5)
        self.assertTrue(np.isnan(out[3]) and np.isnan(out[4]))
        v = T.verbatim_or_null(pd.Series(["00230M00:01:38.131", ""]))
        self.assertEqual(v[0], "00230M00:01:38.131")
        self.assertIsNone(v[1])

    def test_lmst_sol_check_and_utc_null(self):
        self.assertEqual(T.lmst_sol("00230M00:01:38.131"), 230)
        self.assertEqual(T.count_lmst_sol_mismatch(pd.Series(["00231M00:00:00.000", "00230M00:00:00.000"]), 230), 1)
        self.assertTrue(all(x is None for x in T.utc_column(3)))
        self.assertEqual(T.UTC_STATUS["status"], "unavailable")
