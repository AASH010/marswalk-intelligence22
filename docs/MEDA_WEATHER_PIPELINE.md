# MEDA weather pipeline (Task 1) - file inventory

The pipeline lives in `backend/app/services/weather/` with its tests in `backend/tests/weather/`.
Its output folder is `data/resources/MEDA_Weather_ds/processed/`, which the weather-aware routing (Task 2) reads.

W_t direction: in `default_config.json` the air-temperature component has `"invert": true`, so colder air gives a
higher W_t. This matches the EVA weather limits, where low temperature is the hazard.

## Source - `backend/app/services/weather/`
| Path | Purpose |
|---|---|
| `__init__.py` | Version, schema version, exit codes, exception hierarchy |
| `default_config.json` | Default config: variable catalogue, quality-flag rules, header aliases, W_t components, **fixed normalization constants**, weights |
| `config.py` | Pydantic config models, loader, canonical config hash |
| `discovery.py` | Finds label+CSV pairs in directory trees and/or zips (no extraction), malformed-archive handling, version selection, SHA-256 |
| `parsers.py` | PDS4 label parser (stdlib XML) and raw CSV reader (all cells kept as raw strings) |
| `normalization.py` | Channel verification against the label, documented unit conversions, canonical observation rows |
| `quality.py` | Record quality classification (valid/invalid/missing/suspect/unverified) and QA counters |
| `temporal.py` | SCLK/LMST/LTST preservation; UTC status (unavailable) |
| `weather_intensity.py` | W_t computation (fixed constants, clipping, weighted mean, provenance) |
| `storage.py` | Parquet schemas and deterministic writers, JSON writer, QA Markdown renderer |
| `validation.py` | Output-only validation (never touches raw data) |
| `pipeline.py` | CLI (`process`, `validate`) and orchestration; writes manifest last |

## Tests - `backend/tests/weather/`
| Path | Purpose |
|---|---|
| `__init__.py`, `conftest.py` | Package marker; puts `backend/` on `sys.path` for pytest |
| `fixtures.py` | Synthetic PDS4-style products, tree/zip builders (no real data) |
| `test_discovery.py` | Discovery, zips, malformed/corrupt archives, missing partners, versions, conflicts |
| `test_labels_quality_units_time.py` | Label parsing, channel verification/exclusion, sentinels and flags, unit round-trip, temporal preservation |
| `test_weather_intensity.py` | Constants as written, clipping, missing components, no interpolation, determinism |
| `test_storage_validation_e2e.py` | Parquet schema/reload/hash, validation failure modes, exit codes, end-to-end (tree and zip) |

## Outputs written by `process` (in `--out-dir`)
`observations.parquet`, `weather_intensity.parquet`, `variables.json`, `manifest.json`, `qa_report.json`, `qa_report.md`

## Install / run (from `backend/`)
    pip install pandas pyarrow numpy pydantic        # pydantic v2
    python -m unittest discover -s tests/weather -t .   # or: pytest tests/weather   (tests are unittest-based)
    python -m app.services.weather.pipeline process --raw-dir <dir with sol_* folders and/or .zip> --out-dir ../data/resources/MEDA_Weather_ds/processed --sols 230-239 --config app/services/weather/default_config.json
    python -m app.services.weather.pipeline validate --out-dir ../data/resources/MEDA_Weather_ds/processed
Exit codes: 0 ok, 2 bad config/args, 3 missing/malformed input, 4 validation failure (1 = unexpected error).
