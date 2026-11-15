# Data provenance

Every dataset MarsWalk uses, where it comes from, what was done to it, and what the app does with it. If a number in the interface cannot be traced to a row in this document, that is a bug in the document.

**Contents:** [Summary](#summary) · [Terrain](#1-terrain-ctx-dem) · [Imagery](#2-imagery-ctx-orthomosaic) · [Science](#3-science-crism) · [Weather](#4-weather-meda) · [Coordinates](#5-coordinate-system) · [Where files live](#6-where-the-files-live) · [Licences](#7-licences) · [Reproduce](#8-reproducing-the-processed-data)

---

## Summary

| Layer | Original product | Resolution | Area used | Processed file |
|---|---|---|---|---|
| Elevation and slope | CTX DEM mosaic (USGS) | 20 m | 10 x 10 km AOI, 500 x 500 cells | `data/processed/jezero/terrain/jezero_aoi_ctx_dem_20m.tif` |
| Base imagery | CTX orthomosaic (USGS) | 5 m | Full mosaic, tiled | `data/processed/jezero/tiles/ctx_ortho/` |
| 3D texture | Same CTX orthomosaic | 500 x 500 texture | AOI | `data/processed/jezero/terrain/ctx_texture.png` |
| Spectral signal | CRISM FRT000047A3, browse products (PDS) | resampled to the 20 m DEM grid | AOI | `data/processed/jezero/science/crism/` |
| Weather history | MEDA calibrated records (PDS) | hourly aggregates | Sols 1 to 700 | `data/weather/meda/` (demo subset) |
| Weather index W_t | MEDA calibrated records (PDS), Sols 230 to 239 | per record | regional, one value per time | `data/resources/MEDA_Weather_ds/processed/` (not committed) |

---

## 1. Terrain (CTX DEM)

**Product.** `M20_JezeroCrater_CTXDEM_20m.tif`, the USGS Astrogeology *Mars 2020 Science Investigation CTX DEM Mosaic*. It is a mosaic of digital elevation models made from Context Camera (CTX) stereo pairs of Jezero Crater. It includes the original Mars 2020 terrain-relative-navigation CTX DEM and extends it to the whole crater with models produced by the Ames Stereo Pipeline (Beyer, 2020). The added models were fitted vertically to the MOLA dataset. USGS lists the product as public domain.

**Page:** https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic

**Processing done by this project** (`scripts/crop_aoi.py`):

1. Crop the mosaic to a 10 x 10 km area of interest (X 4,350,000 to 4,360,000 m, Y 1,090,000 to 1,100,000 m in the project CRS, see [section 5](#5-coordinate-system)).
2. Result: a 500 x 500 grid at 20 m. This is the grid A* runs on.
3. At runtime the backend computes slope in degrees from the DEM with `numpy.gradient` and builds the terrain cost from it.

**What the app derives from it**

| Derived value | Definition |
|---|---|
| Slope (degrees) | Gradient magnitude of the 20 m DEM |
| Reference slope | 95th percentile of slope inside the AOI (9.61 degrees). Reported by the API as `reference_slope_deg`, tagged `calculated` |
| Terrain cost | `1 + (slope / reference slope)^2`, with the ratio clipped to 1, so cost runs from 1 to 2 |
| Blocked cells | Slope above 20 degrees, or NoData. The 20 degree value is a prototype parameter, not a validated safety limit |

**Not in this data.** Rocks, boulders, sand ripples and any feature smaller than about 20 m. See [SCIENTIFIC_LIMITATIONS.md](SCIENTIFIC_LIMITATIONS.md).

---

## 2. Imagery (CTX orthomosaic)

**Product.** `M20_JezeroCrater_CTXortho_mosaic_5m.tif`, the 5 m/pixel orthomosaic that USGS publishes alongside the Science Investigation DEM, matched to it. Source images are from the Context Camera on the Mars Reconnaissance Orbiter.

**Related USGS releases.** The original terrain-relative-navigation CTX products (DOI 10.5066/P906QQT8 for the DTM, 10.5066/P9GV1ND3 for the orthomosaic; Fergason et al., 2020) are marked CC0 1.0. The 5 m Science Investigation mosaic used here is listed under the same USGS programme, and its page says to cite the authors.

**Processing done by this project**

1. The mosaic (17,766 x 20,234 pixels at about 5.002 m/pixel) was cut into XYZ tiles, 256 px, with `gdal2tiles.py -p raster --xyz -r bilinear`. The pyramid has zoom levels 0 to 7. Zoom 7 is the native resolution.
2. 7,490 tile files are committed to the repository and served by the backend at `/tiles/ctx/{z}/{x}/{y}.png`.
3. The 3D view uses a 500 x 500 texture of the AOI. The backend builds it from the CTX orthomosaic (`GET /api/v1/terrain/texture`) and keeps the result as `ctx_texture.png`, so a deployment does not need the 360 MB raw mosaic.

The tiles are for context. No analysis in the app is computed from imagery pixels.

---

## 3. Science (CRISM)

**Product.** CRISM observation **FRT000047A3**, a Full Resolution Targeted observation of Jezero Crater by the Compact Reconnaissance Imaging Spectrometer for Mars on MRO. The file used is the browse-derived product `frt000047a3_07_brcarj_mtr3` (ENVI `.img`, `.hdr` and PDS `.lbl`).

**What it contains.** Two spectral summary parameters, delivered as byte-scaled browse rasters:

| Band | Meaning |
|---|---|
| **D2300** | Depth of the absorption near 2.3 micrometres |
| **BD1900_2** | Depth of the absorption near 1.9 micrometres |

These are summary indices, in digital numbers (DN). They are not mineral abundance maps and not calibrated band depths.

**Processing done by this project**

1. `scripts/align_crism_to_dem.py` projects the CRISM raster into the DEM coordinate system and resamples it onto the DEM grid (20 m, AOI extent). The intermediate grids go to `data/interim/`.
2. `scripts/build_crism_science_layer.py` writes `crism_aoi_20m.tif` with four bands: D2300 (DN), BD1900_2 (DN), a valid mask, and a candidate mask.
3. The candidate mask is defined in `crism/metadata.json` as "D2300 P95 mask AND BD1900_2 P95 mask AND valid observation". The thresholds are the 95th percentile of each band over the valid cells: 87 DN for D2300 and 54 DN for BD1900_2, over 139,876 valid cells. That leaves **295 dual-band candidate cells**, 0.21 percent of the valid area. Each becomes one science target with a relative `science_value` between 0 and 1.
4. `scripts/crism_p95_overlap.py` is the reproducibility and analysis script: it prints the label fields that matter (scaling, special pixels), reproduces the percentile thresholds, and measures how much the two bands overlap at P90, P95 and P99 against a translation null model. It states that the thresholds are relative to this one image and that it is not a mineral classification.
5. `scripts/build_crism_overlay.py` renders the red (D2300), blue (BD1900_2) and yellow (dual-band) overlay used on the map, stretching each band between its 2nd and 98th percentile for display.

**How the app labels it.** "Browse-derived D2300 and BD1900_2 signal, not a mineral abundance map." Targets are named *CRISM Spectral Candidate N* and described as "candidate spectral signal; not confirmed mineral identification". The `science_value` is a percentile-style ranking within this one scene, so it says which candidates stand out relative to each other, not how much of anything is present.

**Context from the literature.** Both bands are standard parameters used in published Jezero studies, for example the carbonate-bearing and olivine-bearing units described by Brown, Viviano and Goudge (2020, *JGR Planets*), who use CRISM images including FRT000047A3.

---

## 4. Weather (MEDA)

Weather has two independent uses, built from the same instrument. They are kept separate on purpose.

### 4a. Hourly history and the forecast model

| | |
|---|---|
| **Instrument** | Mars Environmental Dynamics Analyzer (MEDA) on the Perseverance rover |
| **Source** | NASA Planetary Data System |
| **Variables used** | Air temperature, ground temperature, pressure, up- and down-welling radiation. Wind is not used |
| **Coverage** | Sols 14 to 700 after quality control, 14,835 observed hours |
| **In the repository** | `data/weather/meda/meda_hourly_sol0001_0239.csv` (demo subset, Sols 1 to 239) and `data/weather/full_backup/` (Sols 1 to 700) |
| **Format** | Hourly aggregates with the columns `sol, hour, air_temp_k, ground_temp_k, n_rows` plus the radiation and pressure columns |

**Quality control** (`backend/app/ml/weather/features.py`, two stages):

1. 288 air-temperature hours removed because the sensor was sun-heated.
2. Temporal outliers removed: 80 air hours and 8 ground hours.

**Model.** A Ridge and LightGBM blend per forecast lead (1 to 7 sols) on 67 features, trained on the residual against a baseline (the same-hour mean of the previous 7 sols). Splits by sol: training 14 to 199, selection 200 to 519, test 520 to 700. Uncertainty comes from split-conformal calibration by lead and hour. The trained files are in `backend/app/ml/weather/artifacts/` (about 11 MB) and are loaded at startup. The backend never retrains. Retraining is `python scripts/train_weather_model.py`.

**Important.** The deployed model is refit through Sol 700. The demo CSV ends at Sol 239, so replaying any sol in the app compares the forecast against data the final model has seen. The honest accuracy numbers are the held-out ones on the Method and Performance tabs. See [SCIENTIFIC_LIMITATIONS.md](SCIENTIFIC_LIMITATIONS.md#weather-forecast).

More: [WEATHER.md](WEATHER.md).

### 4b. The weather index W_t used in route cost

| | |
|---|---|
| **Pipeline** | `backend/app/services/weather/` (see [MEDA_WEATHER_PIPELINE.md](MEDA_WEATHER_PIPELINE.md)) |
| **Input** | Raw calibrated MEDA products for Sols 230 to 239: 70 products, 140 label and data files, all hashed with SHA-256, label MD5 checks passed, 0 failures |
| **Output** | `weather_intensity.parquet` plus `manifest.json`, `variables.json` and a QA report |
| **Definition** | A weighted mean of min-max normalised components, clipped to 0 to 1: air temperature (weight 0.5, **inverted** so colder air gives a higher value), and horizontal wind speed from boom 1 and boom 2 (weight 0.25 each) |
| **Constants** | Normalisation ranges and weights are fixed design constants in `default_config.json` (for example air temperature 150 to 300 K). They are not fitted to the data and need owner sign-off |
| **Scope** | Regional. One value per time for the whole AOI. There is no spatial weather field |
| **Time basis** | LMST. UTC is null in every row because a verified SCLK to UTC conversion needs SPICE kernels that are not available |
| **Quality rule** | Only records with `quality_status = valid` are used. Records missing a component are marked `suspect` and excluded, never interpolated |

At the default time (Sol 239, 12:00 LMST) W_t is 0.319, built from air temperature and both wind sensors.

**Availability.** The output folder is git-ignored, so a fresh clone or the Render deployment does not contain it. The API then plans routes with F = 1 and returns `weather_status: "unavailable"`, `confidence: "reduced"` and the reason. It never substitutes 0 for W_t. Set `MARSWALK_WEATHER_INTENSITY_PATH` to point at a copy of the file, or set `MARSWALK_WEATHER_REQUIRED=1` to turn the missing file into an HTTP 422.

---

## 5. Coordinate system

All coordinates are in a custom projected system, `Mars_2000_Sphere_Equirectangular`, with the standard parallel at 18.4663 degrees, in metres. It is the CRS of the USGS Jezero products.

- Map and API: Mars X (easting) and Mars Y (northing) in metres.
- The grid is 500 x 500 cells at 20 m. Cell (row, col) maps to metres through the DEM affine transform.
- In the 2D map, Leaflet uses `[lat, lng] = [Mars Y, Mars X]` with a custom CRS (`frontend/src/utils/marsCRS.js`). Tiles are XYZ, 256 px, native zoom 7.
- No EPSG code is assigned. The project reference is `data/processed/jezero/map_metadata.json`.

---

## 6. Where the files live

| Path | In git | Notes |
|---|---|---|
| `data/raw/` | No | Original rasters. Downloaded from Kaggle with `scripts/bootstrap_data.py` |
| `data/processed/jezero/` | Allow-listed files only | DEM crop, CTX tiles, texture, CRISM products, AOI boundary, map metadata. Deployed with the backend |
| `data/weather/meda/`, `data/weather/full_backup/` | Yes | Hourly MEDA CSVs |
| `data/resources/MEDA_Weather_ds/processed/` | No | W_t output. Generated by the MEDA pipeline |
| `data/sample/` | Yes | Small figures from the early notebooks |
| `data/manifest.yaml` | Yes | Maps Kaggle dataset files to local paths |

Shared copies on Kaggle: `hozaifa123/marswalk-data` (raw CTX and CRISM) and `hozaifa123/marswalk-processed-jezero` (processed DEM, CRISM products, tiles). The processed dataset is published with the `CC0-1.0` licence tag.

---

## 7. Licences

| Material | Terms |
|---|---|
| MarsWalk source code | MIT, see `LICENSE` |
| USGS CTX DEM mosaic | Listed as public domain by USGS. Cite the authors |
| USGS CTX orthomosaics | The terrain-relative-navigation releases are CC0 1.0. The Science Investigation mosaic is listed under the same programme. Cite the authors |
| CRISM and MEDA data | NASA Planetary Data System products. Cite the instrument teams and the PDS archive |
| Processed Kaggle dataset | Tagged CC0-1.0 by its publisher. That tag covers the processing, not a change of terms on the NASA and USGS inputs |

If you reuse a processed file, keep the source attribution above with it.

**Suggested citations**

- Fergason, R. L., Galuszka, D. M., Hare, T. M., Mayer, D. P., Redding, B. L. (2020). *Mars 2020 Terrain Relative Navigation Flight Product Generation.* USGS Data Release, https://doi.org/10.5066/P906QQT8
- Beyer, R. (2020), Ames Stereo Pipeline, as cited on the USGS product page.
- Brown, A. J., Viviano, C. E., Goudge, T. A. (2020). Olivine-Carbonate Mineralogy of the Jezero Crater Region. *JGR Planets.*
- Murchie, S., et al. (2007). Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) on Mars Reconnaissance Orbiter. *JGR.*

---

## 8. Reproducing the processed data

Normal contributors do not need this. The processed data is already in the repository or on Kaggle.

```bash
python scripts/bootstrap_data.py                 # download raw and processed data from Kaggle
python scripts/validate_data.py                  # expect: ALL CHECKS PASSED

# maintainers only, when the raw rasters change
python scripts/crop_aoi.py
python scripts/align_crism_to_dem.py
python scripts/build_crism_science_layer.py
python scripts/crism_p95_overlap.py              # analysis and reproducibility check
python scripts/build_crism_overlay.py
gdal2tiles.py -p raster --xyz -r bilinear \
  data/raw/jezero/ctx_ortho/M20_JezeroCrater_CTXortho_mosaic_5m.tif \
  data/processed/jezero/tiles/ctx_ortho

# MEDA weather index (from backend/)
python -m app.services.weather.pipeline process \
  --raw-dir <folder with sol_* product folders> \
  --out-dir ../data/resources/MEDA_Weather_ds/processed \
  --sols 230-239 --config app/services/weather/default_config.json
python -m app.services.weather.pipeline validate \
  --out-dir ../data/resources/MEDA_Weather_ds/processed
```

Never edit anything under `data/raw/`.
