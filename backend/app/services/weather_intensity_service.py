"""Regional weather intensity W_t from the Task 1 output.

Reads ``weather_intensity.parquet`` produced by the Task 1 MEDA pipeline
(never raw MEDA) and picks the record that applies to a requested
(sol, start_time).

Facts about the Task 1 output this module relies on (checked on the file):

* one row per MEDA record time; columns sol, sclk, lmst, ltst, utc, w_t,
  components_used, components_missing, source_record_ids, quality_status,
  observation_type;
* utc is null in every row (no verified SCLK -> UTC conversion), so time is
  matched on the Mars local clock;
* the ``sol`` column is the LMST sol. LMST strings look like
  ``00230M12:00:03.726``; LTST strings (``0230 12:21:22``) can roll into the
  next sol near midnight, so LTST is not used for matching;
* W_t is regional: one value for the whole AOI at a given time.

Selection rule (see WeatherTimeConfig): nearest record with an accepted
quality status in the same sol, within the configured window. If there is
none, the caller routes with weather switched off and reports
weather_status = "unavailable" with the reason. A missing W_t is never
replaced by 0, and a nearest record is never reported as an exact match.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.core.eva_config import WeatherCostConfig, WeatherTimeConfig

_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?$")
_LMST_RE = re.compile(r"^(\d{5})M(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$")

READ_COLUMNS = ["sol", "sclk", "lmst", "ltst", "w_t", "quality_status", "components_used"]


class WeatherDataUnavailable(RuntimeError):
    """The Task 1 output cannot be read."""


def parse_start_time(text: str) -> float:
    """'HH:MM', 'HH:MM:SS' or 'HH:MM:SS.fff' (LMST) -> seconds after midnight."""
    if not isinstance(text, str):
        raise ValueError("start_time must be a string 'HH:MM[:SS[.fff]]' (LMST).")
    match = _TIME_RE.match(text.strip())
    if not match:
        raise ValueError(f"start_time '{text}' is not in the form HH:MM[:SS[.fff]] (LMST).")
    hours, minutes = int(match.group(1)), int(match.group(2))
    seconds = float((match.group(3) or "0") + (match.group(4) or ""))
    if not (0 <= hours <= 23 and 0 <= minutes <= 59 and 0.0 <= seconds < 60.0):
        raise ValueError(f"start_time '{text}' is outside 00:00:00-23:59:59.999.")
    return hours * 3600 + minutes * 60 + seconds


def format_seconds(seconds: float) -> str:
    whole = int(math.floor(seconds))
    frac = seconds - whole
    text = f"{whole // 3600:02d}:{(whole % 3600) // 60:02d}:{whole % 60:02d}"
    if frac > 0:
        text += f"{frac:.3f}"[1:]
    return text


@dataclass(frozen=True)
class WeatherRecord:
    sol: int
    sclk: float
    lmst: str
    ltst: str
    w_t: float
    quality_status: str
    components_used: list[str]


@dataclass
class WeatherSelection:
    """Outcome of the W_t lookup, reported in route and EVA responses."""

    status: str  # "applied" | "unavailable" | "disabled"
    reason: str | None
    requested_sol: int | None
    requested_time: str | None
    defaults_used: list[str] = field(default_factory=list)
    time_basis: str = "LMST"
    window_s: float | None = None
    accepted_quality: list[str] = field(default_factory=list)
    selection_method: str | None = None  # "exact_match" | "nearest_within_window"
    time_difference_s: float | None = None  # LMST seconds, absolute
    record: WeatherRecord | None = None
    source: dict | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def w_t(self) -> float | None:
        """W_t used in the cost surface; None when weather is not applied."""
        if self.status == "applied" and self.record is not None:
            return self.record.w_t
        return None

    @property
    def available(self) -> bool:
        return self.record is not None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["w_t"] = self.w_t
        data["w_t_tag"] = "calculated" if self.w_t is not None else None
        data["regional"] = True
        data["time_difference_unit"] = "LMST seconds (1/86400 mean sol, about 1.0275 SI s)"
        return data


class WeatherIntensityStore:
    """W_t records, loaded once, with a per-sol index cached on first use."""

    def __init__(self, path: Path):
        self.path = Path(path)
        if not self.path.exists():
            raise WeatherDataUnavailable(f"Task 1 output not found at {self.path}.")

        try:
            import pyarrow as pa
            import pyarrow.compute as pc
            import pyarrow.parquet as pq

            table = pq.read_table(self.path, columns=READ_COLUMNS)
        except Exception as error:  # pragma: no cover - depends on the file
            raise WeatherDataUnavailable(f"Task 1 output at {self.path} could not be read: {error}") from error

        # Strings stay in compact Arrow arrays; only the selected row is
        # converted to Python objects.
        lmst = table.column("lmst").combine_chunks()
        self._lmst = lmst
        self._ltst = table.column("ltst").combine_chunks()
        components = pc.binary_join(table.column("components_used"), ",").combine_chunks().dictionary_encode()
        self._component_codes = components.indices.to_numpy(zero_copy_only=False)
        self._component_sets = [
            [c for c in (text or "").split(",") if c] for text in components.dictionary.to_pylist()
        ]
        quality = table.column("quality_status").combine_chunks().dictionary_encode()
        self._quality_codes = quality.indices.to_numpy(zero_copy_only=False)
        self._quality_names = [str(name) for name in quality.dictionary.to_pylist()]

        self._sol = pc.fill_null(table.column("sol"), -1).to_numpy().astype(np.int64)
        self._sclk = table.column("sclk").to_numpy().astype(float)
        self._w_t = table.column("w_t").to_numpy().astype(float)
        del table, components

        # Vectorised LMST parsing: "SSSSSMHH:MM:SS.fff".
        well_formed = pc.fill_null(pc.match_substring_regex(lmst, _LMST_RE.pattern), False)
        safe = pc.if_else(well_formed, lmst, pa.scalar("00000M00:00:00"))
        lmst_sol = pc.cast(pc.utf8_slice_codeunits(safe, 0, 5), pa.int64()).to_numpy()
        hours = pc.cast(pc.utf8_slice_codeunits(safe, 6, 8), pa.float64()).to_numpy()
        minutes = pc.cast(pc.utf8_slice_codeunits(safe, 9, 11), pa.float64()).to_numpy()
        secs = pc.cast(pc.utf8_slice_codeunits(safe, 12, 64), pa.float64()).to_numpy()
        valid_text = well_formed.to_numpy(zero_copy_only=False)
        seconds = np.where(valid_text, hours * 3600 + minutes * 60 + secs, np.nan)
        self._seconds = seconds

        # Rows that cannot be used are excluded, never filled in.
        self._usable = (
            valid_text
            & (lmst_sol == self._sol)
            & np.isfinite(seconds)
            & (seconds < 86400.0)
            & np.isfinite(self._w_t)
            & (self._w_t >= 0.0)
            & (self._w_t <= 1.0)
        )
        # Give the Arrow allocator's freed read buffers back to the OS.
        pa.default_memory_pool().release_unused()
        self.rows_total = int(len(self._sol))
        self.rows_excluded = int((~self._usable).sum())
        self.sols = sorted(int(s) for s in np.unique(self._sol[self._usable]))
        self.manifest = self._read_manifest()
        self._sol_cache: dict[tuple[int, tuple[str, ...]], tuple[np.ndarray, np.ndarray]] = {}

    def _read_manifest(self) -> dict:
        manifest_path = self.path.parent / "manifest.json"
        info = {"file": self.path.name, "rows": self.rows_total, "rows_excluded": self.rows_excluded}
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, ValueError):
            return info
        info["task1_run_id"] = manifest.get("run", {}).get("run_id")
        for output in manifest.get("outputs", []):
            if output.get("file") == self.path.name:
                info["sha256"] = output.get("sha256")
        normalization = manifest.get("normalization", {}) or {}
        info["normalization_method"] = normalization.get("method")
        components = []
        for item in normalization.get("components", []) or []:
            invert = bool(item.get("invert", False))
            components.append(
                {
                    "name": item.get("name"),
                    "variable": item.get("variable"),
                    "weight": item.get("weight"),
                    "invert": invert,
                    "direction": "higher value -> lower W_t" if invert else "higher value -> higher W_t",
                }
            )
        info["components"] = components
        return info

    def direction_warnings(self) -> list[str]:
        """Warn when Task 1 makes warmer air raise W_t.

        MarsWalk's own EVA weather limits treat cold as the hazard (GO needs
        air and ground temperature ABOVE a minimum), so a higher W_t for
        warmer air contradicts them. The fix belongs in the Task 1
        configuration (invert = true for air temperature, then re-run);
        Task 2 reads W_t as given and only reports the conflict.
        """
        warnings = []
        for component in self.manifest.get("components", []):
            name = str(component.get("name") or "")
            if "temperature" in name and not component.get("invert"):
                warnings.append(
                    f"Task 1 W_t rises with {name} (invert = false): warmer hours make slopes cost more. "
                    "This conflicts with the EVA weather limits, where cold is the hazard; "
                    "set invert = true for this component in Task 1 and re-run it."
                )
        return warnings

    def sol_index(self, sol: int, accepted_quality: tuple[str, ...]) -> tuple[np.ndarray, np.ndarray]:
        """(sorted LMST seconds, row indices) of accepted records in one sol.

        Built on first use for each (sol, quality set) and kept for the life
        of the store.
        """
        key = (int(sol), tuple(accepted_quality))
        cached = self._sol_cache.get(key)
        if cached is not None:
            return cached
        codes = [i for i, name in enumerate(self._quality_names) if name in accepted_quality]
        mask = self._usable & (self._sol == sol) & np.isin(self._quality_codes, codes)
        rows = np.flatnonzero(mask)
        order = np.argsort(self._seconds[rows], kind="stable")
        rows = rows[order]
        cached = (self._seconds[rows], rows)
        self._sol_cache[key] = cached
        return cached

    def record(self, row: int) -> WeatherRecord:
        code = self._component_codes[row]
        components = self._component_sets[code] if code is not None and code >= 0 else []
        return WeatherRecord(
            sol=int(self._sol[row]),
            sclk=float(self._sclk[row]),
            lmst=str(self._lmst[row].as_py()),
            ltst=str(self._ltst[row].as_py()),
            w_t=float(self._w_t[row]),
            quality_status=self._quality_names[self._quality_codes[row]],
            components_used=[str(c) for c in components] if components else [],
        )

    def count_in_window(self, sol: int, center_s: float, window_s: float) -> int:
        mask = self._usable & (self._sol == sol) & (np.abs(self._seconds - center_s) <= window_s)
        return int(mask.sum())


@lru_cache(maxsize=4)
def _store_for(path: str) -> WeatherIntensityStore:
    return WeatherIntensityStore(Path(path))


def get_weather_store(path: Path) -> WeatherIntensityStore:
    """Store for a file, loaded once per process. Load failures are not cached."""
    return _store_for(str(Path(path).resolve()))


def clear_weather_cache() -> None:
    _store_for.cache_clear()


def select_weather(
    sol: int | None,
    start_time: str | None,
    time_config: WeatherTimeConfig,
    cost_config: WeatherCostConfig,
) -> WeatherSelection:
    """Pick the W_t record for (sol, start_time).

    Raises ValueError only for malformed input (bad start_time, negative sol).
    Everything else is reported in the returned selection.
    """
    defaults_used: list[str] = []

    if sol is not None and sol < 0:
        raise ValueError("sol must be >= 0.")

    if start_time is None:
        start_time = time_config.default_start_time
        defaults_used.append("start_time")
    requested_s = parse_start_time(start_time)
    requested_text = format_seconds(requested_s)

    selection = WeatherSelection(
        status="unavailable",
        reason=None,
        requested_sol=sol,
        requested_time=requested_text,
        defaults_used=defaults_used,
        time_basis=time_config.time_basis.upper(),
        window_s=time_config.window_s,
        accepted_quality=list(time_config.accepted_quality),
    )

    try:
        store = get_weather_store(time_config.path)
    except WeatherDataUnavailable as error:
        if sol is None:
            defaults_used.append("sol")
        selection.reason = str(error)
        return selection

    selection.source = store.manifest
    selection.warnings = store.direction_warnings()

    if sol is None:
        if time_config.default_sol is not None:
            sol = time_config.default_sol
        elif store.sols:
            sol = store.sols[-1]
        defaults_used.append("sol")
        selection.requested_sol = sol

    if sol is None or sol not in store.sols:
        span = f"sols {store.sols[0]}-{store.sols[-1]}" if store.sols else "no usable sols"
        selection.reason = f"Sol {sol} is not in the Task 1 weather output ({span})."
        return selection

    seconds, rows = store.sol_index(int(sol), tuple(time_config.accepted_quality))
    if seconds.size == 0:
        selection.reason = (
            f"Sol {sol} has no W_t record with quality status in {list(time_config.accepted_quality)}."
        )
        return selection

    position = int(np.searchsorted(seconds, requested_s))
    candidates = [p for p in (position - 1, position) if 0 <= p < seconds.size]
    # Nearest; on a tie the earlier record wins.
    best = min(candidates, key=lambda p: (abs(seconds[p] - requested_s), seconds[p]))
    difference = abs(float(seconds[best]) - requested_s)

    if difference > time_config.window_s:
        others = store.count_in_window(int(sol), requested_s, time_config.window_s)
        selection.reason = (
            f"No W_t record with quality status in {list(time_config.accepted_quality)} within "
            f"{time_config.window_s:g} s of LMST {requested_text} on sol {sol}; the nearest one is "
            f"{difference:.0f} s away"
            + (f" ({others} record(s) of other quality are inside the window)." if others else ".")
        )
        selection.time_difference_s = None
        return selection

    selection.record = store.record(int(rows[best]))
    selection.time_difference_s = round(difference, 3)
    selection.selection_method = (
        "exact_match" if difference <= time_config.exact_match_tolerance_s else "nearest_within_window"
    )

    if cost_config.beta == 0.0 and cost_config.penalty_coefficient == 0.0:
        selection.status = "disabled"
        selection.reason = "Weather is switched off in the configuration (beta = 0, no penalty)."
        return selection

    selection.status = "applied"
    return selection
