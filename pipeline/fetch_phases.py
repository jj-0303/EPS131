import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://scedc-pds.s3.us-west-2.amazonaws.com/event_phases/2019/2019_187/38457511.phase"


def utc_time(value):
    return datetime.strptime(value, "%Y/%m/%d,%H:%M:%S.%f").replace(tzinfo=timezone.utc)


def read_phase_text(text, event_id="38457511", station_codes=None):
    codes = set(station_codes or [])
    origin = None
    picks = {}
    header = re.compile(r"^\s*(\d+)\s+\S+\s+(?:\S+\s+)?(\d{4}/\d{2}/\d{2},\d{2}:\d{2}:\d{2}(?:\.\d+)?)")
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        match = header.match(line)
        if match:
            if match.group(1) == event_id:
                timestamp = match.group(2)
                if "." not in timestamp:
                    timestamp += ".000"
                origin = utc_time(timestamp)
            continue
        if origin is None or len(fields) < 13 or fields[0].upper() != "CI":
            continue
        station = fields[1].upper()
        phase = fields[7].upper()
        if codes and station not in codes:
            continue
        if phase not in ("P", "S"):
            continue
        try:
            seconds = float(fields[-1])
            latitude = float(fields[4])
            longitude = float(fields[5])
        except (ValueError, IndexError):
            continue
        if not (0 <= seconds < 300) or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            continue
        station_picks = picks.setdefault(f"CI.{station}", {})
        if phase not in station_picks or seconds < station_picks[phase]["secondsAfterOrigin"]:
            station_picks[phase] = {"secondsAfterOrigin": seconds, "channel": fields[2], "latitude": latitude, "longitude": longitude}
    if origin is None:
        raise ValueError("Matching event header with an origin UTC timestamp was not found")
    return origin, picks


def build_output(text, event_data):
    event = event_data["event"]
    expected = {s["code"] for s in event_data["stations"]}
    origin, matches = read_phase_text(text, "38457511", expected)
    reference = datetime.fromisoformat(event["originUTC"].replace("Z", "+00:00"))
    offset = (origin - reference).total_seconds()
    records = []
    for station in event_data["stations"]:
        phases = matches.get(station["id"], {})
        result = {"id": station["id"]}
        for phase in ("P", "S"):
            if phase in phases:
                result[phase.lower()] = round(phases[phase]["secondsAfterOrigin"] + offset, 5)
                result[phase.lower() + "Channel"] = phases[phase]["channel"]
        if "p" in result or "s" in result:
            records.append(result)
    if not records:
        raise ValueError("No matching CI station observations found; inspect downloaded STP phase format")
    return {
        "schemaVersion": 2,
        "eventId": event["id"],
        "source": SOURCE_URL,
        "sourceCitation": "Southern California Earthquake Data Center (SCEDC), doi:10.7909/C3WD3xH1",
        "phaseOriginUTC": origin.isoformat().replace("+00:00", "Z"),
        "referenceOriginUTC": event["originUTC"],
        "originOffsetSeconds": round(offset, 5),
        "selection": "Earliest positive P and S pick per matching CI station; 0-300 s; adjusted to the USGS reference origin",
        "observations": records,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "observations.json")
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_text(encoding="utf-8")
    else:
        req = Request(SOURCE_URL, headers={"User-Agent": "EEW-Lab/0.2 (+https://github.com/CSFS64/EPS131)"})
        with urlopen(req, timeout=45) as response:
            raw = response.read().decode("utf-8")
    event_data = json.loads((ROOT / "data" / "ridgecrest-2019.json").read_text(encoding="utf-8"))
    result = build_output(raw, event_data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Parsed {len(result['observations'])} matching station observations to {args.output}")


if __name__ == "__main__":
    main()
