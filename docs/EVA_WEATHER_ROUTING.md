# Weather-aware EVA walking (Task 2)

The regional weather intensity W_t from the Task 1 MEDA pipeline changes two things:

1. the A* route cost, through a slope-dependent factor;
2. EVA walking duration and consumables, computed per route segment on the server.

Raw MEDA is never read at runtime. Only `weather_intensity.parquet` is.

## Data files (generated, git-ignored)

| File | Path |
|---|---|
| Processed DEM | `data/processed/jezero/terrain/jezero_aoi_ctx_dem_20m.tif` |
| Task 1 W_t | `data/resources/MEDA_Weather_ds/processed/weather_intensity.parquet` (+ `manifest.json`) |

The W_t path can be changed with `MARSWALK_WEATHER_INTENSITY_PATH`. The pipeline that produces it is in `backend/app/services/weather/` (see `docs/MEDA_WEATHER_PIPELINE.md`).

## Route cost

```
T(i) = 1 + w (C_t(i) - 1)                  terrain part, unchanged (w = mode weight)
s(i) = clip(slope_i / reference_slope, 0, 1)
F(i) = 1 + beta * W_t * s(i)               weather factor
P(i) = 0                                   weather penalty (off)
C(i) = T(i) * F(i) + P(i)                  blocked cells (slope > 20 deg, NoData) = inf
```

- F multiplies the whole terrain part, including its flat-ground 1. It is exactly 1 on flat cells (s = 0), so flat ground costs the same with or without weather.
- Every finite cost is at least 1, so the octile heuristic stays admissible (tested against an exact search).
- `beta = 0.5` is a **modeled** value, not validated. `MARSWALK_WEATHER_BETA` overrides it.
- P can only be enabled with a written justification (`WeatherCostConfig.penalty_justification`). There are no weather hard constraints.
- W_t is regional: one value for the whole AOI.

`optimization_cost` is now the value A* minimises: the sum over moves of move length (m, diagonal = sqrt(2) x 20 m) times the destination cell cost. The start cell is excluded. `average_optimization_cost` = `optimization_cost` / route length. The old value was the plain sum of cell costs along the path.

## Weather time selection

- Input: `sol` and `start_time` (LMST, `HH:MM[:SS[.fff]]`). Defaults: the latest sol in the Task 1 file, at 12:00:00.
- **LMST is the time basis.** The `sol` column in Task 1 is the LMST sol. LTST strings roll into the next sol near midnight, and UTC is null in every row.
- The selected record is the nearest one in the **same sol** within **1800 LMST s** (`MARSWALK_WEATHER_WINDOW_S`), with `quality_status = valid`. Suspect rows are excluded because their W_t is computed from a subset of components.
- The response reports:
  - `selection_method`, either `exact_match` or `nearest_within_window`;
  - the record's LMST, LTST and SCLK;
  - the time difference in LMST seconds.
- When no record qualifies, the route is computed with weather off (F = 1, P = 0). The response then has `weather_status = "unavailable"`, a reason and `confidence = "reduced"`. W_t is never replaced by 0.
- With `MARSWALK_WEATHER_REQUIRED=1` that case returns HTTP 422 instead.

## Route Profile

Built from the exact A* path: one segment per move, with no merging. Each segment uses its destination cell, the same cell A* charges for the move. Each segment carries:

- cells and coordinates;
- length;
- DEM slope (deg and %) and along-track grade;
- elevations;
- C_t, T, s, F, P and C;
- W_t and `weather_status`.

## Segment EVA model (`POST /api/v1/mission/eva-estimate`)

| Step | Formula | Tag |
|---|---|---|
| Speed | `v = v0 / (1 + k_t (C_t - 1)) / (1 + k_s slope_pct)`, k_t = 0.15, k_s = 0.02, C_t = raw terrain cost (same for every route mode) | modeled |
| Duration | `distance / v` | modeled |
| Power | Pandolf, Givoni & Goldman 1977: `1.5W + 2.0(W+L)(L/W)^2 + eta(W+L)(1.5V^2 + 0.35VG)` | modeled |
| Mars gravity | load-support and grade terms x 3.71/9.80665; standing and level-walking terms unscaled | modeled |
| Downhill | G < 0 uses G = 0 (Santee 2003 correction not implemented) | modeled |
| Energy | `W x 0.859845 kcal/h per W x hours` | modeled |
| Weather energy term | 0 (no supported model) | assumed |
| Oxygen | `kcal / 4.86 kcal/L` (RQ about 0.85) | calculated |
| Suit time fraction | `duration / suit capacity x 100` (time, not oxygen) | calculated |

Masses are planning assumptions: body 80 kg, suit 100 kg (treated as carried load). The request can set v0 and suit capacity. Their defaults are:

- v0 = 0.75 m/s (2.7 km/h), the average speed Apollo planners assumed for suited walkbacks of over an hour (Apollo Lunar Surface Journal, "Lunar Gaits");
- suit capacity = 8.5 h.

In the interface the user sets only the payload. Distance, slope, grade and terrain always come from the planned route.

Totals are sums of the segment values. The average metabolic rate is checked against 100 to 500 kcal/h. If it falls outside, a clamped value and a warning are reported next to the raw value, and the totals keep the raw values.

Requests that contain a profile, slope, distance or terrain cost are rejected with 400.

## Status codes

| | /navigate | /mission/eva-estimate |
|---|---|---|
| invalid input | 400 (schema errors stay 422, as before) | 400 (including schema errors) |
| no route | 404 | 404 |
| W_t required but unavailable | 422 | 422 |
| DEM missing | 503 | 503 |

`POST /api/v1/mission/consumables` is unchanged and marked deprecated.

## Tests

```
cd backend
pytest                                         # synthetic DEM / W_t
pytest --run-slow tests/test_real_dem_integration.py   # real DEM + Task 1 file
```

## Limitations

- No spatial weather. W_t is one regional value per time.
- beta, k_t, k_s, the gravity scaling and the downhill rule are modeled and not validated.
- W_t direction: the pipeline config now sets `invert = true` for air temperature, so colder air raises W_t. This matches the EVA weather limits, where cold is the hazard. Task 2 reads the direction from `manifest.json` and returns a warning if the processed folder was produced with the old setting (warmer air raises W_t).
- Speed uses the raw terrain cost C_t, not the mode-weighted T in the task text. The mode weight is a planner preference and should not change how fast the same ground can be walked. `EvaModelConfig.speed_uses_mode_weighted_terrain = True` restores T.
- These physiological values are unverified planning numbers:
  - body mass 80 kg;
  - suit mass 100 kg;
  - eta = 1.0;
  - the 100 to 500 kcal/h bounds;
  - the default v0 of 0.75 m/s, a lunar planning value.
