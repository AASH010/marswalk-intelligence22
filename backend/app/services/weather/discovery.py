"""Find MEDA calibrated-product pairs (PDS4 label .xml + .CSV) in a directory tree and/or zip archives.

Nothing is extracted to disk. Paths recorded in outputs are relative to the raw directory.
"""

import hashlib
import logging
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from . import ConfigError, InputError

log = logging.getLogger(__name__)

PRODUCT_RE = re.compile(
    r"^WE__(?P<sol>\d{4})_+CAL_(?P<type>[A-Z0-9]+?)_+P(?P<ver>\d+)\.(?P<ext>xml|csv)$", re.IGNORECASE
)


@dataclass(frozen=True)
class Source:
    """Where a file's bytes live: a plain file, or a member of a zip archive."""

    container: str  # absolute path (never written to outputs)
    member: Optional[str]  # zip member name, or None for a plain file
    rel: str  # POSIX path relative to the raw dir; "<zip>!/<member>" for members

    def read_bytes(self) -> bytes:
        if self.member is None:
            return Path(self.container).read_bytes()
        with zipfile.ZipFile(self.container) as zf:
            return zf.read(self.member)


@dataclass
class ProductRef:
    product_id: str  # file stem, e.g. WE__0230___________CAL_WS__________________P02
    sol: int
    product_type: str  # WS, ATS, PS, ...
    version: int  # the PNN suffix
    label: Source
    data: Source


@dataclass
class Discovery:
    products: list = field(default_factory=list)  # selected ProductRef, sorted
    superseded: list = field(default_factory=list)  # product ids not selected (older version)
    archives: list = field(default_factory=list)  # [{name, sha256, bytes, members}]
    n_plain_files: int = 0
    warnings: list = field(default_factory=list)
    failures: list = field(default_factory=list)


def parse_sols(spec: str) -> list:
    """'230-239' or '230,232,235-236' -> sorted list of ints."""
    sols = set()
    try:
        for part in spec.split(","):
            part = part.strip()
            if not part:
                raise ValueError("empty item")
            if "-" in part:
                a, b = part.split("-", 1)
                a, b = int(a), int(b)
                if a < 0 or b < a:
                    raise ValueError(f"bad range {part}")
                sols.update(range(a, b + 1))
            else:
                if int(part) < 0:
                    raise ValueError("negative sol")
                sols.add(int(part))
    except ValueError as exc:
        raise ConfigError(f"invalid --sols '{spec}': {exc}")
    return sorted(sols)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def _candidates(raw_dir: Path) -> Iterable:
    """Yield (Source) for every file whose basename looks like a MEDA product file."""
    files = [raw_dir] if raw_dir.is_file() else sorted(p for p in raw_dir.rglob("*") if p.is_file())
    base = raw_dir.parent if raw_dir.is_file() else raw_dir
    for p in files:
        rel = p.relative_to(base).as_posix()
        if p.suffix.lower() == ".zip":
            yield ("zip", p, rel)
        elif PRODUCT_RE.match(p.name):
            yield ("file", p, rel)


def discover(raw_dir, sols, strict: bool = True) -> Discovery:
    raw_dir = Path(raw_dir)
    if not raw_dir.exists():
        raise InputError(f"raw directory does not exist: {raw_dir.name}")
    wanted = set(sols)
    out = Discovery()
    found = {}  # (sol, type, version, stem) -> {"xml": [Source], "csv": [Source]}

    def add(src: Source, name: str):
        m = PRODUCT_RE.match(Path(name).name)
        if not m:
            return
        sol = int(m.group("sol"))
        if sol not in wanted:
            return
        stem = Path(name).stem
        key = (sol, m.group("type").upper(), int(m.group("ver")), stem)
        found.setdefault(key, {"xml": [], "csv": []})[m.group("ext").lower()].append(src)

    for kind, p, rel in _candidates(raw_dir):
        if kind == "file":
            out.n_plain_files += 1
            add(Source(str(p), None, rel), p.name)
            continue
        try:
            with zipfile.ZipFile(p) as zf:
                bad = zf.testzip()
                names = [i.filename for i in zf.infolist() if not i.is_dir()]
        except (zipfile.BadZipFile, OSError, EOFError, NotImplementedError, RuntimeError) as exc:
            raise InputError(f"malformed or unreadable archive {p.name}: {exc}")
        if bad is not None:
            raise InputError(f"corrupt member {bad!r} in archive {p.name}")
        out.archives.append({"name": p.name, "sha256": sha256_file(p), "bytes": p.stat().st_size, "members": len(names)})
        for n in names:
            add(Source(str(p), n, f"{rel}!/{n}"), n)

    # Pair labels with data files; resolve duplicates; record failures.
    selected = {}  # (sol, type) -> list of ProductRef
    for key in sorted(found):
        sol, ptype, ver, stem = key
        pair = found[key]
        if not pair["xml"] or not pair["csv"]:
            missing = "label (.xml)" if not pair["xml"] else "data (.CSV)"
            out.failures.append({"product_id": stem, "sol": sol, "failure": "missing_partner_file", "detail": f"no {missing}"})
            continue
        label_src = _unique(pair["xml"], stem, out)
        data_src = _unique(pair["csv"], stem, out)
        selected.setdefault((sol, ptype), []).append(ProductRef(stem, sol, ptype, ver, label_src, data_src))

    for (sol, ptype), refs in sorted(selected.items()):
        refs.sort(key=lambda r: r.version)
        best = refs[-1]
        out.products.append(best)
        for old in refs[:-1]:
            out.superseded.append(old.product_id)
            out.warnings.append(f"{old.product_id} superseded by {best.product_id} (higher version)")

    out.products.sort(key=lambda r: (r.sol, r.product_type))
    present_sols = {p.sol for p in out.products}
    for s in sorted(wanted - present_sols):
        out.failures.append({"product_id": None, "sol": s, "failure": "no_products_for_sol", "detail": "no usable product pair"})

    if not out.products:
        raise InputError("no MEDA product pairs found for the requested Sols")
    if strict and out.failures:
        first = out.failures[0]
        raise InputError(f"incomplete input ({len(out.failures)} problem(s)); first: {first['failure']} {first['product_id'] or ''} sol {first['sol']}")
    for f in out.failures:
        log.error("input failure: %s", f)
    return out


def _unique(sources: list, stem: str, out: Discovery) -> Source:
    """Several copies of one file (e.g. extracted tree + archive): identical -> keep first; differing -> error."""
    if len(sources) == 1:
        return sources[0]
    digests = {sha256_bytes(s.read_bytes()) for s in sources}
    if len(digests) > 1:
        raise InputError(f"{stem}: conflicting copies found: {[s.rel for s in sources]}")
    out.warnings.append(f"{stem}: {len(sources)} identical copies found; using {sources[0].rel}")
    return sources[0]
