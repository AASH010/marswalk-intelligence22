"""Tiny synthetic MEDA-like products (PDS4 label + CSV) for tests. No real data is used."""
import hashlib
import io
import json
import zipfile
from pathlib import Path

from app.services.weather import config as C

NSDECL = ('xmlns="http://pds.nasa.gov/pds4/pds/v1" xmlns:mars2020="http://pds.nasa.gov/pds4/mission/mars2020/v1"')

TIME = [("SCLK", "ASCII_Real", "second", "Spacecraft Clock, approximated by MEDA internal clock"),
        ("LMST", "ASCII_String", None, "Local Mean Solar Time"),
        ("LTST", "ASCII_String", None, "Local True Solar Time")]
ATS = TIME + [(f"ATS_LOCAL_TEMP{i}", "ASCII_Real", "kelvin", d) for i, d in enumerate(
    ["Local air temperature near the unit mounted on the RSM at 50º", "Local air temperature near the unit mounted on the RSM at 155º",
     "Local air temperature near the unit mounted on the RSM at 290º", "Local air temperature near the unit mounted on the RFB at Port side/Pilot",
     "Local air temperature near the unit mounted on the RFB at Starboard/Co-pilot"], 1)]
def _ws_fields():
    f = []
    for b in (1, 2):
        f += [(f"BOOM{b}_HORIZONTAL_WIND_SPEED", "ASCII_Real", "meter/second", f"Boom {b} wind horizontal speed"),
              (f"BOOM{b}_HORIZONTAL_WIND_SPEED_UNCERTAINTY", "ASCII_Real", None, f"Boom {b} wind horizontal speed uncertainty"),
              (f"BOOM{b}_VERTICAL_WIND_SPEED", "ASCII_Real", "meter/second", f"Boom {b} wind vertical speed"),
              (f"BOOM{b}_VERTICAL_WIND_SPEED_UNCERTAINTY", "ASCII_Real", None, f"Boom {b} wind vertical speed uncertainty"),
              (f"BOOM{b}_WIND_DIRECTION", "ASCII_Real", "degree", f"Boom {b} wind direction"),
              (f"BOOM{b}_WIND_DIRECTION_UNCERTAINTY", "ASCII_Real", None, f"Boom {b} wind direction uncertainty")]
    return f + [
        ("BOOM1_ALG_IN_STABLE_STATE", "ASCII_Integer", None, "0 = Boom 1 control algorithm is changing state, 1 = not changing state"),
        ("BOOM2_ALG_IN_STABLE_STATE", "ASCII_Integer", None, "0 = Boom 2 control algorithm is changing state, 1 = not changing state"),
        ("ROVER_STILL", "ASCII_Integer", None, "0 = Rover is moving, 1 = Rover is motionless")]


# Same 18-field layout as the real WS label (aliases in the config are pinned to field positions 16 and 17).
WS = TIME + _ws_fields()
WS_HEADER_OVERRIDE = {"BOOM1_ALG_IN_STABLE_STATE": "BOOM1_ALG_STATE_STABLE", "BOOM2_ALG_IN_STABLE_STATE": "BOOM2_ALG_STATE_STABLE"}
RHS = TIME + [("HUMICAP_A_HUMIDITY", "ASCII_Real", None, "Humicap humidity sensor A relative humidity"),
              ("HUMICAP_TEMP", "ASCII_Real", "kelvin", "Humicap sensor in-built PT1000 temperature")]

TITLES = {"ATS": "Mars 2020 MEDA Air Temperature Sensor Calibrated Data", "WS": "Mars 2020 MEDA Wind Sensor Calibrated Data",
          "RHS": "Mars 2020 MEDA Relative Humidity Sensor Calibrated Data"}


def label_xml(ptype, fields, sol, nrec, md5, fname, version="2.0"):
    fx = ""
    for i, (n, dt, unit, desc) in enumerate(fields, 1):
        u = f"<unit>{unit}</unit>" if unit else ""
        fx += (f"<Field_Delimited><name>{n}</name><field_number>{i}</field_number><data_type>{dt}</data_type>{u}"
               f"<description>{desc}</description></Field_Delimited>")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Product_Observational {NSDECL}>
<Identification_Area><logical_identifier>urn:nasa:pds:mars2020_meda:data_calibrated_env:we__{sol:04d}_cal_{ptype.lower()}_p</logical_identifier>
<version_id>{version}</version_id><title>{TITLES[ptype]}</title></Identification_Area>
<Observation_Area><Time_Coordinates><start_date_time>2021-10-12T12:11:02.758Z</start_date_time><stop_date_time>2021-10-13T12:48:56.457Z</stop_date_time></Time_Coordinates>
<Primary_Result_Summary><processing_level>Calibrated</processing_level></Primary_Result_Summary>
<Observing_System><Observing_System_Component><name>Mars Environmental Dynamics Analyzer (MEDA)</name><type>Instrument</type></Observing_System_Component></Observing_System>
<Mission_Area><mars2020:Mars2020_Parameters><mars2020:Observation_Information>
<mars2020:start_sol_number>{sol:05d}</mars2020:start_sol_number><mars2020:stop_sol_number>{sol:05d}</mars2020:stop_sol_number>
</mars2020:Observation_Information></mars2020:Mars2020_Parameters></Mission_Area></Observation_Area>
<File_Area_Observational><File><file_name>{fname}</file_name><records>{nrec + 1}</records><md5_checksum>{md5}</md5_checksum></File>
<Table_Delimited><records>{nrec}</records><Record_Delimited><fields>{len(fields)}</fields>{fx}</Record_Delimited></Table_Delimited>
</File_Area_Observational></Product_Observational>
"""


def _rows(ptype, sol, n=5):
    base = 1000 * (sol - 229)
    out = []
    for i in range(n):
        t = [f"{base + i}", f"{sol:05d}M00:00:{i:02d}.123", f"{sol:04d} 00:21:{i:02d}"]
        if ptype == "ATS":
            out.append(t + [f"{200 + i + k}.5" for k in range(5)])
        elif ptype == "WS":
            sp1 = ["3.0", "15.0", "45.0", "", "6.0"][i]
            sp2 = ["30.0", "0.0", "7.5", "9.0", "12.0"][i]
            alg1 = ["1", "1", "1", "0", "1"][i]
            still = ["1", "1", "0", "1", "1"][i]
            out.append(t + [sp1, "", "", "", "100.5" if sp1 else "", "", sp2, "", "", "", "200.5", "", alg1, "1", still])
        elif ptype == "RHS":
            out.append(t + ["6.1", "206.5"])
    return out


SPEC = {"ATS": ATS, "WS": WS, "RHS": RHS}


def make_product(ptype, sol, header_override=None, mutate_rows=None, version=1, fields=None):
    """Return (stem, csv_bytes, xml_bytes)."""
    fields = fields or SPEC[ptype]
    stem = f"WE__{sol:04d}___________CAL_{ptype}{'_' * (18 - len(ptype))}P{version:02d}"
    hdr = [(header_override or {}).get(f[0], f[0]) for f in fields]
    rows = _rows(ptype, sol)
    if mutate_rows:
        rows = mutate_rows(rows)
    csv = ("\r\n".join([",".join(hdr)] + [",".join(r) for r in rows]) + "\r\n").encode()
    md5 = hashlib.md5(csv).hexdigest()
    xml = label_xml(ptype, fields, sol, len(rows), md5, stem + ".CSV", f"{version}.0").encode("utf-8")
    return stem, csv, xml


def write_tree(root: Path, sols=(230, 231), types=("ATS", "WS", "RHS")):
    for sol in sols:
        d = Path(root) / f"sol_{sol:04d}"
        d.mkdir(parents=True, exist_ok=True)
        for t in types:
            stem, csv, xml = make_product(t, sol, WS_HEADER_OVERRIDE if t == "WS" else None)
            (d / (stem + ".CSV")).write_bytes(csv)
            (d / (stem + ".xml")).write_bytes(xml)


def write_zip(path: Path, sols=(230, 231), types=("ATS", "WS", "RHS")):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for sol in sols:
            for t in types:
                stem, csv, xml = make_product(t, sol, WS_HEADER_OVERRIDE if t == "WS" else None)
                zf.writestr(f"DS/sol_{sol:04d}/{stem}.CSV", csv)
                zf.writestr(f"DS/sol_{sol:04d}/{stem}.xml", xml)


def default_cfg_dict():
    return json.loads(C.default_config_path().read_text())


def cfg_from(d):
    return C.Config.model_validate(d)
