import copy
import unittest

import numpy as np
import pandas as pd

from app.services.weather import weather_intensity as W
from . import fixtures as F


def cfg(min_components=1):
    d = F.default_cfg_dict()
    d["weather_intensity"]["min_components"] = min_components
    return F.cfg_from(d)


def rec(variable, sclk, value, status="valid", row=None, product="P", channel=None, lmst="L", ltst="T"):
    return {"sol": 230, "variable": variable, "sclk": float(sclk), "value": value, "quality_status": status,
            "source_row": row if row is not None else int(sclk), "source_product": product,
            "source_channel": channel or variable.upper(), "lmst": lmst, "ltst": ltst}


B1, B2, TA = "wind_speed_horizontal_boom1", "wind_speed_horizontal_boom2", "air_temperature_ats1"


class WeatherIntensityTests(unittest.TestCase):
    def test_constants_used_as_written_weights_and_mean(self):
        # constants: wind [0,30] w=.25 each ; temperature [150,300] w=.5, inverted (colder -> higher)
        obs = pd.DataFrame([rec(B1, 1, 3.0), rec(B2, 1, 30.0), rec(TA, 1, 200.5)])
        out, st = W.compute_w_t(obs, cfg(), 230)
        exp = (0.25 * 0.1 + 0.25 * 1.0 + 0.5 * (1.0 - 50.5 / 150.0)) / 1.0
        self.assertAlmostEqual(out.w_t.iloc[0], exp, places=12)
        self.assertEqual(out.components_used.iloc[0], ["air_temperature", "wind_speed_boom1", "wind_speed_boom2"])
        self.assertEqual(out.components_missing.iloc[0], [])
        self.assertEqual(out.quality_status.iloc[0], "valid")
        self.assertEqual(out.observation_type.iloc[0], "observed")
        self.assertEqual(out.source_record_ids.iloc[0][0], f"P:1:{TA.upper()}")

    def test_constants_not_recomputed_from_data(self):
        # a huge outlier must not stretch the scale: the value is clipped at the configured max
        a = pd.DataFrame([rec(B1, 1, 30.0), rec(B1, 2, 3000.0), rec(B1, 3, 15.0)])
        out, _ = W.compute_w_t(a, cfg(), 230)
        self.assertEqual(list(out.w_t), [1.0, 1.0, 0.5])
        b = pd.DataFrame([rec(B1, 3, 15.0)])
        self.assertEqual(W.compute_w_t(b, cfg(), 230)[0].w_t.iloc[0], 0.5)  # same value -> same W_t regardless of other data

    def test_clipping_both_ends(self):
        c = cfg().weather_intensity.components
        wind = next(x for x in c if x.name == "wind_speed_boom1")
        np.testing.assert_array_equal(W.normalise([-5.0, 0.0, 30.0, 99.0], wind), [0.0, 0.0, 1.0, 1.0])
        out, _ = W.compute_w_t(pd.DataFrame([rec(TA, 1, 10.0), rec(TA, 2, 999.0)]), cfg(), 230)
        self.assertEqual(list(out.w_t), [1.0, 0.0])  # temperature is inverted: very cold -> 1, very hot -> 0
        self.assertTrue(((out.w_t >= 0) & (out.w_t <= 1)).all())

    def test_missing_component_handling(self):
        obs = pd.DataFrame([rec(B1, 1, 3.0), rec(TA, 1, 200.5), rec(TA, 2, 200.5), rec(B2, 2, 9.0, status="suspect"),
                            rec(B2, 3, 0.0, status="missing")])
        out, st = W.compute_w_t(obs, cfg(), 230)
        self.assertEqual(list(out.sclk), [1.0, 2.0])  # sclk 3 has no valid component at all -> no W_t row
        r1, r2 = out.iloc[0], out.iloc[1]
        self.assertEqual(r1.components_used, ["air_temperature", "wind_speed_boom1"])
        self.assertEqual(r1.components_missing, ["wind_speed_boom2"])
        self.assertEqual(r1.quality_status, "suspect")  # partial composite
        self.assertAlmostEqual(r1.w_t, (0.25 * 0.1 + 0.5 * (1.0 - 50.5 / 150)) / 0.75, places=12)
        self.assertEqual(r2.components_used, ["air_temperature"])  # suspect record never used
        self.assertAlmostEqual(r2.w_t, 1.0 - 50.5 / 150, places=12)
        self.assertEqual((st["candidate_timestamps"], st["emitted"], st["no_valid_component"], st["partial"]), (3, 2, 1, 2))

    def test_min_components_and_no_interpolation(self):
        obs = pd.DataFrame([rec(B1, 1, 3.0), rec(TA, 2, 200.5)])
        out, _ = W.compute_w_t(obs, cfg(min_components=2), 230)
        self.assertEqual(len(out), 0)  # asynchronous records are never merged or interpolated
        out, _ = W.compute_w_t(obs, cfg(min_components=1), 230)
        self.assertEqual(list(out.sclk), [1.0, 2.0])

    def test_invert_flag(self):
        d = F.default_cfg_dict()
        self.assertTrue(d["weather_intensity"]["components"][2]["invert"])  # default: colder air -> higher W_t
        out, _ = W.compute_w_t(pd.DataFrame([rec(TA, 1, 150.0)]), F.cfg_from(d), 230)
        self.assertEqual(out.w_t.iloc[0], 1.0)
        d["weather_intensity"]["components"][2]["invert"] = False
        out, _ = W.compute_w_t(pd.DataFrame([rec(TA, 1, 150.0)]), F.cfg_from(d), 230)
        self.assertEqual(out.w_t.iloc[0], 0.0)

    def test_deterministic_and_input_order_independent(self):
        rows = [rec(B1, i, i % 31, row=i) for i in range(1, 40)] + [rec(TA, i, 150 + i, row=i) for i in range(1, 40)]
        a, _ = W.compute_w_t(pd.DataFrame(rows), cfg(), 230)
        b, _ = W.compute_w_t(pd.DataFrame(rows), cfg(), 230)
        c, _ = W.compute_w_t(pd.DataFrame(list(reversed(rows))), cfg(), 230)
        for other in (b, c):
            pd.testing.assert_frame_equal(a.reset_index(drop=True), other.reset_index(drop=True))

    def test_empty_input(self):
        out, st = W.compute_w_t(pd.DataFrame(columns=list(rec(B1, 1, 1).keys())), cfg(), 230)
        self.assertEqual(len(out), 0)
        self.assertEqual(list(out.columns), W.WT_COLUMNS)
