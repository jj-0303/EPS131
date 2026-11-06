import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

from fetch_phases import read_phase_text, utc_time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def parse_event(raw, event, stations, source):
    picks = {s['code'] for s in stations}
    origin, matches = read_phase_text(raw, event['id'].removeprefix('ci'), picks)
    reference = datetime.fromisoformat(event['originUTC'].replace('Z', '+00:00'))
    offset = (origin - reference).total_seconds()
    rows = []
    for station in stations:
        recorded = matches.get(station['id'], {})
        row = {'id': station['id']}
        for phase in ('P', 'S'):
            if phase in recorded:
                row[phase.lower()] = round(recorded[phase]['secondsAfterOrigin'] + offset, 5)
                row[phase.lower() + 'Channel'] = recorded[phase]['channel']
        if 'p' in row or 's' in row:
            rows.append(row)
    if not rows:
        raise RuntimeError('No matching phase picks for ' + event['id'])
    return {
        'schemaVersion': 3,
        'eventId': event['id'],
        'source': source,
        'phaseOriginUTC': origin.isoformat().replace('+00:00', 'Z'),
        'referenceOriginUTC': event['originUTC'],
        'originOffsetSeconds': round(offset, 5),
        'observations': rows
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', default='all')
    parser.add_argument('--source-file', type=Path)
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
    events = [e for e in data['events'] if args.event in ('all', e['id'])]
    for event in events:
        event_id = event['id'].removeprefix('ci')
        day = datetime.fromisoformat(event['originUTC'].replace('Z', '+00:00')).timetuple().tm_yday
        url = f'https://scedc-pds.s3.us-west-2.amazonaws.com/event_phases/2019/2019_{day:03d}/{event_id}.phase'
        if args.source_file:
            raw = args.source_file.read_text(encoding='utf-8')
        else:
            request = Request(url, headers={'User-Agent':'EEW-Lab/0.3'})
            with urlopen(request, timeout=90) as response:
                raw = response.read().decode('utf-8')
        output = parse_event(raw, event, data['stations'], url)
        dest = ROOT / 'data/observations' / f"{event['id']}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
        print(event['id'], len(output['observations']), 'station picks')


if __name__ == '__main__':
    main()
