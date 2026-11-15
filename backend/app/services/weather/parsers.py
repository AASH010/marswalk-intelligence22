"""PDS4 label parsing and raw CSV reading. Values are kept exactly as written (strings)."""

import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from . import InputError

NS = {
    "p": "http://pds.nasa.gov/pds4/pds/v1",
    "m": "http://pds.nasa.gov/pds4/mission/mars2020/v1",
}


@dataclass(frozen=True)
class LabelField:
    number: int
    name: str
    data_type: str
    unit: Optional[str]
    description: str


@dataclass
class LabelInfo:
    logical_identifier: str
    version_id: str
    title: str
    processing_level: Optional[str]
    instrument: Optional[str]
    start_time: Optional[str]
    stop_time: Optional[str]
    sclk_start: Optional[str]
    sclk_stop: Optional[str]
    start_sol: Optional[int]
    stop_sol: Optional[int]
    file_name: Optional[str]
    table_records: int
    md5: Optional[str]
    fields: list = field(default_factory=list)


def _text(node, path):
    el = node.find(path, NS)
    if el is None or el.text is None:
        return None
    return re.sub(r"\s+", " ", el.text).strip() or None


def _int_or_none(s):
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


def parse_label(data: bytes, name: str = "label") -> LabelInfo:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise InputError(f"{name}: label is not well-formed XML: {exc}")
    table = root.find(".//p:Table_Delimited", NS)
    if table is None:
        raise InputError(f"{name}: label has no Table_Delimited section")
    fields = []
    for fd in table.iterfind(".//p:Field_Delimited", NS):
        num = _int_or_none(_text(fd, "p:field_number"))
        fname = _text(fd, "p:name")
        if num is None or not fname:
            raise InputError(f"{name}: Field_Delimited without field_number/name")
        fields.append(
            LabelField(num, fname, _text(fd, "p:data_type") or "", _text(fd, "p:unit"), _text(fd, "p:description") or "")
        )
    fields.sort(key=lambda f: f.number)
    if [f.number for f in fields] != list(range(1, len(fields) + 1)):
        raise InputError(f"{name}: label field numbers are not 1..N")
    instrument = None
    for comp in root.iterfind(".//p:Observing_System_Component", NS):
        if _text(comp, "p:type") == "Instrument":
            instrument = _text(comp, "p:name")
    rec = _int_or_none(_text(table, "p:records"))
    if rec is None:
        raise InputError(f"{name}: label does not state the table record count")
    return LabelInfo(
        logical_identifier=_text(root, ".//p:Identification_Area/p:logical_identifier") or "",
        version_id=_text(root, ".//p:Identification_Area/p:version_id") or "",
        title=_text(root, ".//p:Identification_Area/p:title") or "",
        processing_level=_text(root, ".//p:processing_level"),
        instrument=instrument,
        start_time=_text(root, ".//p:Time_Coordinates/p:start_date_time"),
        stop_time=_text(root, ".//p:Time_Coordinates/p:stop_date_time"),
        sclk_start=_text(root, ".//m:spacecraft_clock_start"),
        sclk_stop=_text(root, ".//m:spacecraft_clock_stop"),
        start_sol=_int_or_none(_text(root, ".//m:start_sol_number")),
        stop_sol=_int_or_none(_text(root, ".//m:stop_sol_number")),
        file_name=_text(root, ".//p:File_Area_Observational/p:File/p:file_name"),
        table_records=rec,
        md5=_text(root, ".//p:File_Area_Observational/p:File/p:md5_checksum"),
        fields=fields,
    )


def read_table(data: bytes, name: str = "data") -> pd.DataFrame:
    """Read a delimited MEDA table with every cell kept as its raw string (no NA conversion)."""
    try:
        df = pd.read_csv(
            io.BytesIO(data), dtype=str, keep_default_na=False, na_filter=False, skip_blank_lines=False
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as exc:
        raise InputError(f"{name}: cannot parse CSV: {exc}")
    if df.columns.duplicated().any():
        raise InputError(f"{name}: duplicate column headers in CSV")
    return df
