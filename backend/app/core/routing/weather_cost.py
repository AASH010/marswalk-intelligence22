"""Weather-aware cell cost for A*.

    T(i) = 1 + w * (C_t(i) - 1)                 terrain-only part (existing)
    s(i) = clip(slope_i / reference_slope, 0, 1)
    F(i) = 1 + beta * W_t * s(i)                weather factor
    P(i) = penalty_coefficient * W_t * s(i)     weather penalty, 0 by default
    C(i) = T(i) * F(i) + P(i)                   blocked cells -> inf

Design choice (documented, tested): F multiplies the whole terrain part T,
including its flat-ground base of 1. Because F is built from s(i), it is
exactly 1 on flat cells (s = 0), so flat ground costs the same with or
without weather. On sloped cells the weather scales the full cell cost, which
is what makes a flat detour attractive when W_t is high.

W_t is one regional value for the whole AOI at the selected time (Task 1 has
no spatial weather field).

Admissibility: C_t >= 1 and w >= 0 give T >= 1; beta >= 0, W_t in [0, 1] and
s in [0, 1] give F >= 1; P >= 0. So every finite cell cost is >= 1, the
minimum the octile heuristic assumes, and the heuristic stays admissible.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.routing.cost_function import normalize_feature, weighted_terrain_cost
from app.core.terrain.hazard import apply_blocked_mask


@dataclass(frozen=True)
class CostSurface:
    terrain_part: np.ndarray  # T(i)
    slope_weight: np.ndarray  # s(i)
    weather_factor: np.ndarray  # F(i)
    weather_penalty: np.ndarray  # P(i)
    cost: np.ndarray  # C(i), inf where blocked
    w_t: float | None  # None when weather is off
    beta: float
    penalty_coefficient: float


def slope_weight(slope_deg: np.ndarray, reference_slope: float) -> np.ndarray:
    """s(i) = clip(slope / reference_slope, 0, 1). NaN slope stays NaN."""
    if not (np.isfinite(reference_slope) and reference_slope > 0):
        raise ValueError("reference_slope must be a positive finite number.")
    return normalize_feature(np.asarray(slope_deg, dtype=float), reference_slope)


def weather_factor(slope_w: np.ndarray, w_t: float | None, beta: float) -> np.ndarray:
    """F(i) = 1 + beta * W_t * s(i); exactly 1 when weather is off."""
    s = np.nan_to_num(np.asarray(slope_w, dtype=float), nan=0.0)
    if w_t is None or beta == 0.0:
        return np.ones_like(s)
    return 1.0 + beta * w_t * s


def weather_penalty(slope_w: np.ndarray, w_t: float | None, coefficient: float) -> np.ndarray:
    """P(i) = coefficient * W_t * s(i); exactly 0 when off."""
    s = np.nan_to_num(np.asarray(slope_w, dtype=float), nan=0.0)
    if w_t is None or coefficient == 0.0:
        return np.zeros_like(s)
    return coefficient * w_t * s


def build_cost_surface(
    terrain_cost: np.ndarray,
    blocked_mask: np.ndarray,
    terrain_weight: float,
    slope_deg: np.ndarray | None = None,
    reference_slope: float | None = None,
    w_t: float | None = None,
    beta: float = 0.0,
    penalty_coefficient: float = 0.0,
) -> CostSurface:
    """Final A* cost grid C(i) and its parts.

    Without slope data or without W_t the weather terms are neutral
    (F = 1, P = 0) and C equals the terrain-only cost used before.
    """
    if beta < 0:
        raise ValueError("beta must be >= 0.")
    if penalty_coefficient < 0:
        raise ValueError("penalty_coefficient must be >= 0.")
    if w_t is not None and not (np.isfinite(w_t) and 0.0 <= w_t <= 1.0):
        raise ValueError("W_t must be a finite value in [0, 1].")

    terrain_part = weighted_terrain_cost(np.asarray(terrain_cost, dtype=float), terrain_weight)

    if slope_deg is None or reference_slope is None:
        s = np.zeros_like(terrain_part)
        w_used = None
    else:
        s = slope_weight(slope_deg, reference_slope)
        w_used = w_t

    factor = weather_factor(s, w_used, beta)
    penalty = weather_penalty(s, w_used, penalty_coefficient)

    with np.errstate(invalid="ignore"):
        cost = terrain_part * factor + penalty

    cost = apply_blocked_mask(cost, blocked_mask)
    # NoData cells already have an infinite terrain cost; keep anything
    # non-finite impassable rather than turning it into a number.
    cost[~np.isfinite(cost)] = np.inf

    return CostSurface(
        terrain_part=terrain_part,
        slope_weight=s,
        weather_factor=factor,
        weather_penalty=penalty,
        cost=cost,
        w_t=w_used,
        beta=beta,
        penalty_coefficient=penalty_coefficient,
    )
