import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RADIUS_KM = 6371.0088


def surface_distance(event, station):
    p1 = math.radians(event['latitude'])
    p2 = math.radians(station['latitude'])
    dp = p2 - p1
    dl = math.radians(station['longitude'] - event['longitude'])
    value = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * RADIUS_KM * math.atan2(math.sqrt(value), math.sqrt(max(0, 1 - value)))


def first_time(taup, depth, degrees, phase):
    names = ['P', 'p', 'Pn', 'Pg'] if phase == 'p' else ['S', 's', 'Sn', 'Sg']
    try:
        arrivals = taup.get_travel_times(source_depth_in_km=depth, distance_in_degree=degrees, phase_list=names)
    except Exception:
        return None
    values = [x.time for x in arrivals if math.isfinite(x.time) and x.time >= 0]
    return min(values) if values else None


def build():
    from obspy.taup import TauPyModel
    data = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
    model = TauPyModel(model='iasp91')
    output = {
        'schemaVersion': 1,
        'name': 'iasp91',
        'method': 'ObsPy TauP first P/S arrival in spherical 1D iasp91 Earth model',
        'source': 'Kennett and Engdahl (1991), iasp91; ObsPy TauP',
        'url': 'https://docs.obspy.org/packages/obspy.taup.html',
        'events': {}
    }
    receivers = data['stations'] + data['cities']
    for event in data['events']:
        rows = {}
        for place in receivers:
            delta = surface_distance(event, place) / RADIUS_KM * 180 / math.pi
            p = first_time(model, event['depthKm'], delta, 'p')
            s = first_time(model, event['depthKm'], delta, 's')
            rows[place['id']] = {'p': p, 's': s}
        output['events'][event['id']] = rows
    path = ROOT / 'data' / 'models-1d.json'
    path.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    print('Wrote', path, 'with events', list(output['events']))
    for event_id, rows in output['events'].items():
        print(event_id, 'valid P', sum(row['p'] is not None for row in rows.values()), 'valid S', sum(row['s'] is not None for row in rows.values()))


if __name__ == '__main__':
    build()
