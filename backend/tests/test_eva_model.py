"""Segment EVA consumables."""

import math
from dataclasses import replace

import pytest

from app.core.eva_config import EvaModelConfig
from app.core.science.eva_model import (
    TAGS,
    EvaInputs,
    estimate_consumables,
    model_parameters,
    pandolf_power_w,
    segment_speed_ms,
)

CONFIG = EvaModelConfig()
INPUTS = EvaInputs(payload_kg=10.0, base_walking_speed_ms=0.5, suit_capacity_hours=8.0)


def segment(index, distance=20.0, slope_pct=5.0, grade=3.0, terrain_part=1.2, terrain_cost=1.2, w_t=0.4):
    return {
        "index": index,
        "from_cell": [0, index],
        "to_cell": [0, index + 1],
        "distance_m": distance,
        "slope_percent": slope_pct,
        "grade_percent": grade,
        "terrain_part": terrain_part,
        "terrain_cost": terrain_cost,
        "weather_factor": 1.1,
        "w_t": w_t,
        "weather_status": "applied",
    }


SEGMENTS = [
    segment(0),
    segment(1, distance=20 * math.sqrt(2), slope_pct=12.0, grade=-8.0, terrain_part=1.5),
    segment(2, slope_pct=0.0, grade=0.0, terrain_part=1.0),
]


def test_segment_sums_equal_totals():
    out = estimate_consumables(SEGMENTS, INPUTS, CONFIG, w_t=0.4)
    totals = out["totals"]
    for seg_key, total_key in [("duration_s", "duration_s"), ("energy_kcal", "energy_kcal"), ("oxygen_l", "oxygen_liters")]:
        summed = math.fsum(s[seg_key]["value"] for s in out["segments"])
        assert summed == pytest.approx(totals[total_key]["value"], rel=1e-12, abs=1e-12)
    hours = totals["duration_hours"]["value"]
    assert totals["average_metabolic_rate_kcal_hr"]["value"] == pytest.approx(totals["energy_kcal"]["value"] / hours)
    assert totals["suit_time_fraction_percent"]["value"] == pytest.approx(hours / 8.0 * 100)
    assert totals["suit_time_fraction_percent"]["unit"] == "% of suit time"


def test_speed_formula_and_duration():
    seg = SEGMENTS[0]
    v = segment_speed_ms(seg, 0.5, CONFIG)
    assert v == pytest.approx(0.5 / (1 + 0.15 * 0.2) / (1 + 0.02 * 5.0))
    out = estimate_consumables([seg], INPUTS, CONFIG, w_t=0.4)
    assert out["segments"][0]["duration_s"]["value"] == pytest.approx(20.0 / v)


def test_speed_ignores_weather_factor():
    a = dict(SEGMENTS[0], weather_factor=1.0)
    b = dict(SEGMENTS[0], weather_factor=3.0)
    assert segment_speed_ms(a, 0.5, CONFIG) == segment_speed_ms(b, 0.5, CONFIG)


def test_pandolf_terms_and_mars_scaling():
    v, grade, payload = 0.4, 10.0, 10.0
    W, L = 80.0, 110.0
    g = 3.71 / 9.80665
    terms = pandolf_power_w(v, grade, payload, CONFIG)
    assert terms["standing_w"] == pytest.approx(1.5 * W)
    assert terms["load_support_w"] == pytest.approx(2.0 * (W + L) * (L / W) ** 2 * g)
    assert terms["level_walking_w"] == pytest.approx(1.0 * (W + L) * 1.5 * v**2)
    assert terms["grade_w"] == pytest.approx(1.0 * (W + L) * 0.35 * v * grade * g)
    # Earth gravity reproduces the unscaled Pandolf equation.
    earth = replace(CONFIG, mars_gravity_m_s2=CONFIG.earth_gravity_m_s2)
    unscaled = 1.5 * W + 2.0 * (W + L) * (L / W) ** 2 + (W + L) * (1.5 * v**2 + 0.35 * v * grade)
    assert pandolf_power_w(v, grade, payload, earth)["total_w"] == pytest.approx(unscaled)


def test_downhill_gets_no_grade_credit():
    assert pandolf_power_w(0.4, -12.0, 0.0, CONFIG)["grade_w"] == 0.0
    assert pandolf_power_w(0.4, -12.0, 0.0, CONFIG)["total_w"] == pytest.approx(
        pandolf_power_w(0.4, 0.0, 0.0, CONFIG)["total_w"]
    )


def test_watts_to_kcal_per_hour_and_oxygen():
    out = estimate_consumables([SEGMENTS[2]], INPUTS, CONFIG, w_t=0.4)
    seg = out["segments"][0]
    assert seg["metabolic_rate_kcal_hr"]["value"] == pytest.approx(seg["metabolic_rate_w"]["value"] * 0.859845)
    assert seg["oxygen_l"]["value"] == pytest.approx(seg["energy_kcal"]["value"] / 4.86)
    assert seg["energy_kcal"]["value"] == pytest.approx(
        seg["metabolic_rate_kcal_hr"]["value"] * seg["duration_s"]["value"] / 3600
    )
    assert 3600 / 4186.8 == pytest.approx(0.859845, abs=5e-7)


def test_weather_energy_term_is_zero():
    with_weather = estimate_consumables(SEGMENTS, INPUTS, CONFIG, w_t=0.9)
    without = estimate_consumables(SEGMENTS, INPUTS, CONFIG, w_t=None)
    assert with_weather["totals"]["energy_kcal"]["value"] == without["totals"]["energy_kcal"]["value"]
    assert with_weather["totals"]["weather_energy_kcal"]["value"] == 0.0


def test_clamping_is_reported_not_silent():
    narrow = replace(CONFIG, max_metabolic_rate_kcal_hr=150.0)
    out = estimate_consumables(SEGMENTS, INPUTS, narrow, w_t=0.4)
    totals = out["totals"]
    raw = totals["average_metabolic_rate_kcal_hr"]["value"]
    assert raw > 150.0
    assert totals["metabolic_rate_clamped"] is True
    assert totals["reported_metabolic_rate_kcal_hr"]["value"] == 150.0
    assert any("outside the configured range" in w for w in out["warnings"])
    # Totals still use the unclamped values.
    unclamped = estimate_consumables(SEGMENTS, INPUTS, CONFIG, w_t=0.4)
    assert totals["energy_kcal"]["value"] == unclamped["totals"]["energy_kcal"]["value"]

    assert unclamped["totals"]["metabolic_rate_clamped"] is False
    assert not any("outside the configured range" in w for w in unclamped["warnings"])


def test_over_capacity_warning():
    out = estimate_consumables(SEGMENTS, EvaInputs(0.0, 0.5, 0.01), CONFIG, w_t=None)
    assert out["totals"]["suit_time_margin_hours"]["value"] < 0
    assert any("exceeds the suit capacity" in w for w in out["warnings"])


def test_every_value_has_a_tag_and_unit():
    out = estimate_consumables(SEGMENTS, INPUTS, CONFIG, w_t=0.4)
    tagged = [v for v in out["totals"].values() if isinstance(v, dict)]
    for seg in out["segments"]:
        tagged += [v for v in seg.values() if isinstance(v, dict)]
    assert tagged
    for value in tagged:
        assert value["tag"] in TAGS and isinstance(value["unit"], str)
    assert out["totals"]["oxygen_liters"]["tag"] == "calculated"
    for param in model_parameters(INPUTS, CONFIG):
        assert param["tag"] in TAGS and param["source"]


def test_invalid_inputs_rejected():
    with pytest.raises(ValueError):
        estimate_consumables(SEGMENTS, EvaInputs(-1.0, 0.5, 8.0), CONFIG, w_t=None)


def test_speed_is_the_same_for_every_route_mode_on_the_same_ground():
    """Default: speed uses the raw terrain cost, not the mode-weighted T."""
    fastest = dict(SEGMENTS[0], terrain_cost=1.5, terrain_part=1.1)  # w = 0.2
    conservative = dict(SEGMENTS[0], terrain_cost=1.5, terrain_part=2.0)  # w = 2.0
    assert segment_speed_ms(fastest, 0.75, CONFIG) == segment_speed_ms(conservative, 0.75, CONFIG)
    assert segment_speed_ms(fastest, 0.75, CONFIG) == pytest.approx(0.75 / (1 + 0.15 * 0.5) / (1 + 0.02 * 5.0))

    weighted = replace(CONFIG, speed_uses_mode_weighted_terrain=True)
    assert segment_speed_ms(fastest, 0.75, weighted) > segment_speed_ms(conservative, 0.75, weighted)


def test_default_walking_speed_is_the_sourced_planning_value():
    assert CONFIG.default_base_walking_speed_ms == pytest.approx(2.7 / 3.6)
