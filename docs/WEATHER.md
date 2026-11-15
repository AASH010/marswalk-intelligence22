# EVA Weather Intelligence

Hourly surface temperature forecast for Jezero crater, built on Perseverance MEDA data, and turned into GO / CAUTION / NO-GO hours for an EVA.

## What it does

- Issued at the end of a sol, it forecasts air and ground temperature for every hour of the next 1 to 7 sols (up to 168 h).
- Each hour gets a forecast, a 7-sol baseline, quantiles (5 to 95 %) and the probability that both planning limits are met.
- Status: GO when P >= 80 %, CAUTION when P >= 50 %, otherwise NO-GO. Night hours are always NO-GO.
- When a route is calculated, its estimated duration is fitted into the best GO window (highest lowest-hour confidence, earliest on ties).
- Replay: any issue sol from 21 to 700 can be replayed and compared with what was observed.

## Layout

```
data/weather/meda/                     MEDA hourly CSVs (sols 1-700)
backend/app/ml/weather/features.py     QC, solar geometry, features
backend/app/ml/weather/model.py        ridge + LightGBM blend, residual pool
backend/app/ml/weather/artifacts/      trained model, residuals, report.json
backend/app/services/weather_service.py
backend/app/api/weather.py             /api/v1/weather/*
scripts/train_weather_model.py         full retrain + evaluation report
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/weather/status` | model availability, sol range, default limits |
| GET | `/api/v1/weather/current?sol=` | current conditions (latest sol if omitted) |
| GET | `/api/v1/weather/forecast` | `issue_sol`, `start_hour`, `end_hour` (0-168), `route_hours`, `air_min_k`, `ground_min_k`, `go_confidence`, `caution_confidence`, `min_sun_elevation_deg` |
| GET | `/api/v1/weather/report` | full evaluation report used by the dashboard |

## Mission clock ("now")

The weather panels follow a simulated mission clock (right panel, "Mission clock"). It ticks in Mars time (real time, 60x or 600x), can be scrubbed to any time of day, and can jump to any sol.

- On a sol with data (replay), "now" shows what MEDA measured, using only hours up to the clock time. The forecast is the one issued after the previous sol, counted from now.
- After the last data ("Live"), sols continue from the last measured one. The time of day starts at Jezero's current local solar time (Mars24 algorithm). Conditions are the model's estimate for that hour, labelled as such. The model reaches 7 sols past the last data, after that the panel asks for newer data.
- The forecast range ("24 h", "48 h", custom) is counted from the clock's now.

`GET /api/v1/weather/current?sol=&hour=` returns the conditions using only measurements up to that LTST hour.

## Data files and updating them

The service reads every `data/weather/meda/meda_hourly_*.csv`, merges them, and when two files hold the same (sol, hour) the file that sorts last wins. To update the live data, drop a new file such as `meda_hourly_sol0701_0740.csv` into that folder and restart the backend. Nothing else changes.

Required columns: `sol,hour,air_temp_k,ground_temp_k,n_rows`. The model also uses `up_sw_wm2,up_lw_wm2,down_lw_wm2,pressure_pa`; leave them in.

How much history is needed: 35 sols is enough, and a forecast from the last 40 sols is identical to one from all 700 (checked, and covered by a test). Below about 25 sols it degrades. Replay (and the earliest issue sol) follow the data: with only 40 sols the replay range is the last ~26 sols; with the full history it starts at sol 27.

The trained model (`backend/app/ml/weather/artifacts/`, about 11 MB) must be in the repository: the backend loads it at startup and never retrains. The training script and the full history are only needed to retrain.

## Run

```
pip install -r backend/requirements.txt
cd backend && uvicorn app.main:app --reload
cd frontend && npm run dev
```

## Retrain

```
python scripts/train_weather_model.py
```

About 8 minutes on a laptop CPU, deterministic. It rewrites `backend/app/ml/weather/artifacts/`.

## Test results (sols 520-700, never seen in selection)

| Target | +1 sol MAE | baseline | +7 sol MAE | baseline |
|---|---|---|---|---|
| Air | 1.65 K | 1.76 K | 2.01 K | 2.05 K |
| Ground | 1.36 K | 2.26 K | 2.98 K | 3.34 K |

Air leads 4 to 6 are 0.5 to 2.6 % worse than the baseline: the test season was not in training.

## Limits

The default limits (air >= 205 K, ground >= 210 K, sun above the horizon) are placeholders. Set real suit and operations values in the dashboard or through the query parameters.
