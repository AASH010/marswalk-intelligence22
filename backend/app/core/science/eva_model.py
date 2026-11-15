"""Segment-based EVA walking consumables (modeled).

Input is the server-built Route Profile. For every segment:

    speed     v = v0 / (1 + k_t (C_t - 1)) / (1 + k_s * slope_pct)      modeled
    duration  d = distance / v                                           modeled
    power     Pandolf et al. (1977), Mars-gravity scaled (see config)    modeled
    energy    E = P [W] * 0.859845 kcal/h/W * d [h]                      modeled
    oxygen    O2 = E / 4.86 kcal/L                                       calculated

Totals are plain sums of the segment values. The average metabolic rate is
total energy / total duration. It is compared with the configured reporting
bounds; if it falls outside, the raw value is kept in every total and a
clamped value is reported next to it with a warning. Nothing is clamped
silently.

Weather and energy: no documented, supported model links W_t to metabolic
cost, so that term is 0 (stated in every response). Weather still affects
the walk through the route itself (A* cost) and therefore its distance and
slopes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.core.eva_config import EvaModelConfig

TAGS = ("measured", "calculated", "modeled", "assumed")


@dataclass(frozen=True)
class EvaInputs:
    payload_kg: float
    base_walking_speed_ms: float
    suit_capacity_hours: float


def tagged(value, unit: str, tag: str) -> dict:
    assert tag in TAGS
    if value is not None and not math.isfinite(value):
        value = None
    return {"value": value, "unit": unit, "tag": tag}


def pandolf_power_w(
    speed_ms: float,
    grade_percent: float,
    payload_kg: float,
    config: EvaModelConfig,
) -> dict:
    """Pandolf (1977) terms in watts, with the documented Mars scaling."""
    body = config.body_mass_kg
    load = config.suit_mass_kg + payload_kg
    total = body + load
    eta = config.terrain_factor_eta
    g_scale = config.gravity_scale
    uphill_grade = max(grade_percent, 0.0)

    standing = 1.5 * body
    load_support = 2.0 * total * (load / body) ** 2 * g_scale
    level_walking = eta * total * 1.5 * speed_ms**2
    grade_work = eta * total * 0.35 * speed_ms * uphill_grade * g_scale

    return {
        "standing_w": standing,
        "load_support_w": load_support,
        "level_walking_w": level_walking,
        "grade_w": grade_work,
        "total_w": standing + load_support + level_walking + grade_work,
    }


def segment_speed_ms(segment: dict, v0: float, config: EvaModelConfig) -> float:
    terrain_term = segment["terrain_part"] if config.speed_uses_mode_weighted_terrain else segment["terrain_cost"]
    return v0 / (1.0 + config.k_t * (terrain_term - 1.0)) / (1.0 + config.k_s * segment["slope_percent"])


def estimate_consumables(
    segments: list[dict],
    inputs: EvaInputs,
    config: EvaModelConfig,
    w_t: float | None,
) -> dict:
    if inputs.base_walking_speed_ms <= 0 or inputs.suit_capacity_hours <= 0 or inputs.payload_kg < 0:
        raise ValueError("Walking speed and suit capacity must be > 0, payload >= 0.")

    kcal_per_w = config.kcal_per_hour_per_watt
    warnings: list[str] = []
    rows = []

    for segment in segments:
        speed = segment_speed_ms(segment, inputs.base_walking_speed_ms, config)
        duration_s = segment["distance_m"] / speed
        power = pandolf_power_w(speed, segment["grade_percent"], inputs.payload_kg, config)

        # Weather term in the energy model: no supported model -> 0.
        weather_w = config.weather_energy_coefficient * (w_t or 0.0)
        total_w = power["total_w"] + weather_w

        rate_kcal_hr = total_w * kcal_per_w
        energy_kcal = rate_kcal_hr * duration_s / 3600.0
        oxygen_l = energy_kcal / config.kcal_per_liter_o2

        rows.append(
            {
                "index": segment["index"],
                "from_cell": segment["from_cell"],
                "to_cell": segment["to_cell"],
                "distance_m": tagged(segment["distance_m"], "m", "calculated"),
                "slope_percent": tagged(segment["slope_percent"], "%", "calculated"),
                "grade_percent": tagged(segment["grade_percent"], "%", "calculated"),
                "terrain_part": tagged(segment["terrain_part"], "1", "modeled"),
                "terrain_cost": tagged(segment["terrain_cost"], "1", "modeled"),
                "weather_factor": tagged(segment["weather_factor"], "1", "modeled"),
                "w_t": tagged(segment["w_t"], "1", "calculated") if segment["w_t"] is not None else None,
                "weather_status": segment["weather_status"],
                "speed_ms": tagged(speed, "m/s", "modeled"),
                "duration_s": tagged(duration_s, "s", "modeled"),
                "metabolic_rate_w": tagged(total_w, "W", "modeled"),
                "metabolic_rate_kcal_hr": tagged(rate_kcal_hr, "kcal/h", "modeled"),
                "weather_energy_w": tagged(weather_w, "W", "assumed"),
                "energy_kcal": tagged(energy_kcal, "kcal", "modeled"),
                "oxygen_l": tagged(oxygen_l, "L", "calculated"),
                "_raw": (duration_s, energy_kcal, oxygen_l),
            }
        )

    duration_s = math.fsum(r["_raw"][0] for r in rows)
    energy_kcal = math.fsum(r["_raw"][1] for r in rows)
    oxygen_l = math.fsum(r["_raw"][2] for r in rows)
    for r in rows:
        del r["_raw"]

    duration_h = duration_s / 3600.0
    finite = all(math.isfinite(v) for v in (duration_s, energy_kcal, oxygen_l))

    rate_raw = energy_kcal / duration_h if duration_h > 0 and finite else None
    rate_reported = rate_raw
    clamped = False
    if rate_raw is not None:
        low, high = config.min_metabolic_rate_kcal_hr, config.max_metabolic_rate_kcal_hr
        if rate_raw < low or rate_raw > high:
            clamped = True
            rate_reported = min(high, max(low, rate_raw))
            warnings.append(
                f"Average metabolic rate {rate_raw:.1f} kcal/h is outside the configured range "
                f"{low:g}-{high:g} kcal/h. The clamped value {rate_reported:.1f} kcal/h is reported "
                "separately; energy and oxygen totals use the unclamped segment values."
            )

    suit_fraction = duration_h / inputs.suit_capacity_hours * 100.0
    margin_h = inputs.suit_capacity_hours - duration_h
    if margin_h < 0:
        warnings.append(
            f"Estimated walking time {duration_h:.2f} h exceeds the suit capacity of "
            f"{inputs.suit_capacity_hours:g} h given in the request."
        )
    if not finite:
        warnings.append("Some segment values are not finite; totals could not be evaluated.")

    totals = {
        "duration_s": tagged(duration_s, "s", "modeled"),
        "duration_hours": tagged(duration_h, "h", "modeled"),
        "energy_kcal": tagged(energy_kcal, "kcal", "modeled"),
        "oxygen_liters": tagged(oxygen_l, "L", "calculated"),
        "average_metabolic_rate_kcal_hr": tagged(rate_raw, "kcal/h", "calculated"),
        "reported_metabolic_rate_kcal_hr": tagged(rate_reported, "kcal/h", "calculated"),
        "metabolic_rate_clamped": clamped,
        "suit_time_fraction_percent": tagged(suit_fraction, "% of suit time", "calculated"),
        "suit_time_margin_hours": tagged(margin_h, "h", "calculated"),
        "weather_energy_kcal": tagged(0.0 if config.weather_energy_coefficient == 0 else None, "kcal", "assumed"),
    }

    return {"segments": rows, "totals": totals, "warnings": warnings, "finite": finite}


def model_parameters(inputs: EvaInputs, config: EvaModelConfig) -> list[dict]:
    """Every number the estimate depends on, with its kind and source."""

    def param(name, value, unit, tag, source):
        return {"name": name, "value": value, "unit": unit, "tag": tag, "source": source}

    return [
        param("base_walking_speed_ms", inputs.base_walking_speed_ms, "m/s", "assumed",
              "request, or default 0.75 m/s = 2.7 km/h Apollo walkback planning average (ALSJ)"),
        param("payload_kg", inputs.payload_kg, "kg", "assumed", "request"),
        param("suit_capacity_hours", inputs.suit_capacity_hours, "h", "assumed", "request"),
        param("k_t", config.k_t, "1", "modeled", "prototype constant, not validated"),
        param("k_s", config.k_s, "1/%", "modeled", "prototype constant, not validated"),
        param("body_mass_kg", config.body_mass_kg, "kg", "assumed", "planning value"),
        param("suit_mass_kg", config.suit_mass_kg, "kg", "assumed", "planning value; treated as carried load"),
        param("terrain_factor_eta", config.terrain_factor_eta, "1", "assumed",
              "Pandolf 1977 reference surface (treadmill / paved)"),
        param("pandolf_coefficients", "1.5, 2.0, 1.5, 0.35", "W/kg terms", "modeled",
              "Pandolf, Givoni & Goldman 1977, J Appl Physiol 43:577-581"),
        param("mars_gravity_m_s2", config.mars_gravity_m_s2, "m/s^2", "assumed", "task specification"),
        param("earth_gravity_m_s2", config.earth_gravity_m_s2, "m/s^2", "assumed", "standard gravity (CGPM 1901)"),
        param("gravity_scale", config.gravity_scale, "1", "modeled",
              "applied to the load-support and grade terms only"),
        param("kcal_per_hour_per_watt", config.kcal_per_hour_per_watt, "kcal/h per W", "calculated",
              "3600 J/h / 4186.8 J/kcal"),
        param("kcal_per_liter_o2", config.kcal_per_liter_o2, "kcal/L", "assumed",
              "Zuntz-Schumburg table, RQ about 0.85"),
        param("min_metabolic_rate_kcal_hr", config.min_metabolic_rate_kcal_hr, "kcal/h", "assumed",
              "reporting bound only"),
        param("max_metabolic_rate_kcal_hr", config.max_metabolic_rate_kcal_hr, "kcal/h", "assumed",
              "reporting bound only"),
        param("weather_energy_coefficient", config.weather_energy_coefficient, "W", "assumed",
              "no supported model links W_t to metabolic cost; set to 0"),
    ]


MODEL_DESCRIPTION = {
    "segmentation": "one segment per A* move (destination-cell terrain, along-track grade)",
    "speed": (
        "v = v0 / (1 + k_t (C_t - 1)) / (1 + k_s * slope_pct); C_t = raw terrain cost of the cell "
        "(same for every route mode, no weather factor)"
    ),
    "energy": (
        "Pandolf 1977: M = 1.5 W + 2.0 (W+L)(L/W)^2 + eta (W+L)(1.5 V^2 + 0.35 V G); "
        "W body mass, L suit + payload, V segment speed, G uphill along-track grade (%)"
    ),
    "mars_gravity": "load-support and grade terms x 3.71 / 9.80665; standing and level-walking terms unscaled",
    "downhill": "negative grades use G = 0 (no credit); Santee 2003 correction not implemented",
    "oxygen": "energy (kcal) / 4.86 kcal per litre O2",
    "weather_energy_term": "0: no supported model links W_t to metabolic cost",
    "validation": "Planning model. Not validated against EVA data; not an operational limit.",
}
