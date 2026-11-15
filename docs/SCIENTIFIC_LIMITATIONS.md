# Scientific limitations

MarsWalk is a planning prototype built in a hackathon timeframe. This page lists what each part of it can and cannot support, so a number from the app is never quoted with more confidence than it has.

**One rule runs through the whole project.** Every value the API returns carries a tag, and the interface shows it:

| Tag | Meaning |
|---|---|
| **measured** | Taken directly from an instrument record |
| **calculated** | Derived from measured data by a stated formula, no free parameters |
| **modeled** | Output of a model with parameters chosen for this prototype |
| **assumed** | A planning input a mission planner is expected to replace |

If a value is *modeled* or *assumed*, it is a placeholder for a better number, not a finding.

**Contents:** [At a glance](#at-a-glance) · [Terrain and routing](#terrain-and-routing) · [Weather in the route cost](#weather-in-the-route-cost) · [EVA estimate](#eva-estimate) · [Weather forecast](#weather-forecast) · [Science targets](#science-targets) · [Software](#software-and-deployment) · [What would improve it](#what-would-improve-it)

---

## At a glance

| Area | Status | The short version |
|---|---|---|
| Terrain and slope | Calculated | From a 20 m stereo DEM. Cannot see rocks or anything smaller than about 20 m |
| 20 degree slope block | Assumed | A prototype threshold, not a safety limit |
| Weather term in route cost (beta = 0.5) | Modeled, not validated | Shape is reasoned, size is a guess |
| W_t weather index | Calculated from MEDA, design constants | Regional, 10 sols of input, not a physical quantity |
| EVA duration, energy, oxygen | Modeled | Pandolf-style model with assumed masses and speed |
| GO and NO-GO temperature limits (205 K, 210 K) | Assumed | Placeholders, not suit specifications |
| Temperature forecast | Modeled, validated on held-out sols | Beats a naive baseline at 1 sol, roughly ties it beyond |
| Forecast uncertainty bands | Modeled | The 80 percent band covers 72.1 percent of held-out hours, under nominal |
| CRISM science targets | Candidates | Spectral signal ranked within one scene, not confirmed minerals |

---

## Terrain and routing

**Resolution.** The DEM is 20 m per cell. A route that looks clear can still cross a boulder field, a sand ripple or a 1 m step, because none of these exist in the data. The app plans on slope alone.

**Source of the DEM.** It is built from CTX stereo pairs and fitted vertically to MOLA. Its absolute accuracy is not characterised in this project. Local slopes derived from a 20 m grid smooth out steeper short sections: the route profile reports a maximum slope of about 36 percent (19.7 degrees) on the demo route, but the real ground between two cells can be steeper.

**The 20 degree block.** `MAX_WALKABLE_SLOPE = 20` is a configurable prototype parameter. It is not derived from suit, mobility or rover data, and it is not a safety limit.

**The cost function.** Terrain cost is `1 + (slope / P95 slope)^2`, clipped to the range 1 to 2. It is a smooth penalty chosen to keep A* well behaved, not a fit to measured walking cost. The three strategies only change how strongly that penalty is weighted (0.2, 1 and 2). On the demo points they differ by 0.14 km in length, so the choice matters most where there is a real choice between a steep short way and a flat long way.

**What A* guarantees.** The route is optimal for the cost grid. It is not optimal for walking time or for risk, because the grid is not either of those. Every cell cost is at least 1 and the heuristic is octile, so the search is admissible (tested against an exact search).

**Cells are not segments of a real path.** A route is a chain of 20 m grid moves (including diagonals), so it is stair-stepped. The reported distance sums the grid moves, so it slightly overestimates a smooth path.

**Hazards that are not modelled:** rocks and boulders, loose sand and soft soil, shadow and illumination, communication line of sight, navigation error, and the position of the rover or habitat.

---

## Weather in the route cost

The route cost is `C = T x F + P`, with `F = 1 + beta x W_t x s`, where `s` is the slope scaled to 0 to 1 and `W_t` is the regional weather index.

- **beta = 0.5 is modeled and not validated.** The API reports `validated: false` and `beta_tag: modeled` on every route. With the largest W_t in the processed output (0.737), the steepest cells cost 1.37 times their terrain-only value. That is the whole effect.
- **The weather term only acts on slopes.** Flat ground costs the same with or without weather. Weather never blocks a cell. The penalty term P is off, and cannot be switched on without a written justification in the configuration.
- **W_t is regional.** One number for the whole 10 km area at one time. Real surface conditions vary across terrain, and the pipeline has no spatial weather field because the SPICE kernels needed to place rover measurements on the map are not available.
- **W_t is built from design constants.** The weights (0.5 air temperature, 0.25 and 0.25 for two wind sensors) and the normalisation ranges are fixed in the configuration and are not fitted to anything. The air-temperature component is inverted so that cold raises W_t, which matches the EVA limits where cold is the hazard. Hot-side hazards are not represented.
- **Ten sols of input.** The processed index covers Sols 230 to 239. It is a short window of one season.
- **The wind sensor.** Wind data are used by W_t, but the wind sensor was damaged during the mission and wind records have gaps. Records missing a component are marked suspect and left out, not filled.
- **No UTC.** UTC is null in every row. Times are matched in LMST within 1,800 LMST seconds of the same sol. If nothing qualifies, the route is planned with weather off and the response says `weather_status: "unavailable"`.
- **The file is not deployed by default.** `data/resources/MEDA_Weather_ds/processed/` is git-ignored, so a deployment without it plans every route with weather off and flags that in the response and in the interface.

---

## EVA estimate

Duration, energy, oxygen and suit time come from a segment model in `backend/app/core/science/eva_model.py`, applied to every grid move of the planned route.

| Part | Value | Tag | Basis |
|---|---|---|---|
| Base speed v0 | 0.75 m/s (2.7 km/h) | assumed | Apollo planners' average for suited walkbacks of more than an hour, a lunar value |
| Speed penalties | k_t = 0.15 on terrain cost, k_s = 0.02 per percent slope | modeled | No validation source |
| Energy | Pandolf, Givoni and Goldman (1977) | modeled | Derived for load carriage on Earth |
| Mars gravity | Load and grade terms scaled by 3.71 / 9.80665 | modeled | The standing and level-walking terms are left unscaled, which errs high |
| Downhill | Grade term set to 0 | modeled | No credit for descending. The Santee (2003) correction is not implemented |
| Body mass | 80 kg | assumed | Planning value |
| Suit mass | 100 kg, treated as carried load | assumed | Planning value |
| Terrain factor eta | 1.0 | assumed | Treadmill reference surface |
| Suit capacity | 8.5 h | assumed | The user can change it through the API |
| Oxygen | energy / 4.86 kcal per litre | calculated | Zuntz-Schumburg, at a respiratory quotient of about 0.85 |
| Weather effect on energy | 0 | assumed | No supported model links W_t to metabolic cost |

**What the outputs are.** "Suit time used" is duration divided by suit capacity. It is a share of **time**, not of oxygen or battery. The older `/mission/consumables` endpoint called a similar number "oxygen percent", which was misleading, and that endpoint is now deprecated.

**Metabolic rate bounds.** The average rate is compared with 100 to 500 kcal/h. On long uphill routes with a payload it can exceed that range, and the interface then shows the raw value, the clamped value and a warning. The totals keep the raw values.

**What it ignores:** thermal load on the suit, heat loss in the cold, dust, battery and cooling limits, rest stops, sampling time, and individual differences.

None of this is a substitute for suit specifications or crew physiology.

---

## Weather forecast

The hourly temperature forecast is the part of the project with a proper held-out evaluation. It is also the part where the honest result is modest.

**What it forecasts.** Air and ground temperature only, hourly, 1 to 7 sols ahead, from MEDA records. It does not forecast wind, pressure or dust.

**Data.** One Mars year of one rover at one location: Sols 14 to 700 after quality control, 14,835 observed hours. Seasons and dust events beyond this are not represented.

**Evaluation.** Splits by sol, in time order: training Sols 14 to 199, selection 200 to 519, test 520 to 700. Test sols were never used to choose features, blend weights or settings.

| Target | Lead | Model MAE | Baseline MAE | Reading |
|---|---|---|---|---|
| Air | +1 sol | 1.65 K | 1.76 K | 6.1 percent better. The 95 percent interval of the gain is 0.07 to 0.15 K, and the model wins on 69 percent of sols |
| Air | +7 sols | 2.01 K | 2.05 K | Roughly a tie |
| Air | +4 to +6 sols | | | 0.5 to 2.6 percent **worse** than the baseline |
| Ground | +1 sol | 1.36 K | 2.26 K | Clearly better |
| Ground | +7 sols | 2.98 K | 3.34 K | Better |

The baseline is the same-hour mean of the previous 7 sols, a strong baseline for a daily cycle. Air leads 4 to 6 are worse because the test season was not in training. The dashboard shows these numbers, including the ones that do not flatter the model.

**Uncertainty.** Bands come from split-conformal calibration by lead and hour. On the test sols the nominal 80 percent band covers **72.1 percent** of observations. It is under-confident in coverage, which means the GO and NO-GO probabilities lean optimistic. Probabilities in the middle bins are noisy and should be read as coarse.

**GO, CAUTION and NO-GO.** GO needs a probability of at least 80 percent that both air and ground stay inside the limits, CAUTION at least 50 percent, otherwise NO-GO. Night hours are always NO-GO. The limits (air 205 K, ground 210 K, sun above the horizon) are **placeholders**. The dashboard lets you change them. Do not read them as suit specifications.

**Replay is in-sample.** The deployed model is refit through Sol 700, and the data shipped in the repository ends at Sol 239. When you replay a sol, the forecast has seen that sol during training. The replay shows how the tool behaves, not how accurate it is. The accuracy numbers above are the honest ones.

**"Live" mode is an extrapolation.** After the last measured sol, the clock continues and the panel shows the model's estimate, labelled "Model estimate". The model reaches 7 sols past the last data. After that the panel asks for newer data.

**Retraining** takes about 8 minutes on a laptop CPU and is deterministic: `python scripts/train_weather_model.py`.

---

## Science targets

**What a target is.** A grid cell where both the D2300 and BD1900_2 summary indices from one CRISM scene (FRT000047A3) exceed their own 95th percentile over valid cells. There are 295 of them, 0.21 percent of the valid area.

**What that does and does not mean.**

- The indices are browse-derived summary parameters in digital numbers, not calibrated band depths and not abundances.
- Thresholds are relative to this one image. P95 of a different scene would be a different number.
- Overlap of two bands is a candidate for follow-up, not an identification. The label in the app reads "candidate spectral signal; not confirmed mineral identification", and that is the correct reading.
- `science_value` ranks candidates against each other within this scene. It is not a measure of scientific importance or a prediction of what a sample would contain.
- CRISM data are orbital, at about 20 m scale. Dust cover, atmosphere and illumination all affect them.
- The "route-adjacent targets" list measures a straight-line distance to the nearest route vertex. It is a post-route analysis and does not change the route.

---

## Software and deployment

- Weather and EVA values are computed on the server. The browser only displays them and fits the route duration into GO windows.
- The backend is a free-tier service that sleeps when idle. The first request after a pause can be slow, and the interface retries its health check before showing the service as offline. Some ad blockers block `/health` requests by name.
- CORS is open (`*`) because there is no authentication and no private data.
- The test suite covers the cost function, A*, the route profile, the weather selection, the EVA model, the API contracts and the MEDA pipeline with synthetic data. The real-DEM integration test needs the data and is marked slow.

---

## What would improve it

In rough order of value:

1. **Replace the placeholder limits** (20 degree slope, 205 K and 210 K, suit capacity, masses) with values from suit and mobility specifications.
2. **Add a hazard layer** from HiRISE and rock-abundance products, so routes avoid what a 20 m DEM cannot show.
3. **Validate the speed and energy model** against measured traverse or analogue-field data, then drop the "modeled" tags that earn it.
4. **More weather history** for W_t and the forecast: more sols, a second season, and dust opacity as an input.
5. **Make W_t spatial** by placing rover measurements on the map, which needs SPICE kernels.
6. **Calibrate the uncertainty bands** until the 80 percent band covers close to 80 percent of held-out hours.
7. **Calibrated CRISM products** (full spectral cubes) in place of browse summaries.
