import argparse
import csv
import json
import math
import tempfile
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]


def geo_xyz(latitude, longitude, depth, center_lat=35.75, center_lon=-117.6):
    x = (longitude - center_lon) * 111.195 * math.cos(math.radians(center_lat))
    y = (latitude - center_lat) * 111.195
    return x, y, depth


def load_points(path, latitude_range=(34.5, 37.0), longitude_range=(-119.4, -116.2), max_depth=35):
    xyz = []
    speeds = []
    with Path(path).open('r', encoding='utf-8-sig', errors='replace', newline='') as handle:
        reader = csv.DictReader(handle)
        reader.fieldnames = [x.strip().lower().replace(' ', '_') for x in reader.fieldnames]
        aliases = {'latitude': ('latitude', 'lat'), 'longitude': ('longitude', 'lon', 'long'), 'depth': ('depth', 'depth_km'), 'vp': ('vp', 'v_p'), 'vs': ('vs', 'v_s')}
        keys = {key: next((name for name in aliases[key] if name in reader.fieldnames), None) for key in aliases}
        if any(value is None for value in keys.values()):
            raise ValueError('Expected latitude, longitude, depth, vp, vs columns; received ' + str(reader.fieldnames))
        for row in reader:
            try:
                latitude, longitude, depth, vp, vs = (float(row[keys[key]]) for key in ('latitude', 'longitude', 'depth', 'vp', 'vs'))
            except (ValueError, TypeError):
                continue
            if latitude_range[0] <= latitude <= latitude_range[1] and longitude_range[0] <= longitude <= longitude_range[1] and 0 <= depth <= max_depth and 1.0 <= vp <= 12.0 and 0.4 <= vs <= 8.0:
                xyz.append(geo_xyz(latitude, longitude, depth))
                speeds.append((vp, vs))
    if not xyz:
        raise ValueError('No valid 3D model nodes in the Ridgecrest region')
    return np.asarray(xyz, dtype=np.float32), np.asarray(speeds, dtype=np.float32)


def travel_time(tree, speeds, event, receiver, phase, max_neighbor_km=5.0, steps=120):
    origin = np.asarray(geo_xyz(event['latitude'], event['longitude'], event['depthKm']))
    ending = np.asarray(geo_xyz(receiver['latitude'], receiver['longitude'], 0))
    distance = np.linalg.norm(ending - origin)
    positions = origin + np.linspace(0, 1, steps + 1)[:, None] * (ending - origin)
    distance_to_nodes, node_indices = tree.query(positions, k=8)
    if np.any(distance_to_nodes[:, 0] > max_neighbor_km):
        return None
    weights = 1 / np.maximum(distance_to_nodes, 0.15) ** 2
    weights = weights / weights.sum(axis=1, keepdims=True)
    component = 0 if phase == 'p' else 1
    velocity = np.sum(speeds[node_indices, component] * weights, axis=1)
    return round(float(np.trapezoid(1 / velocity, dx=distance / steps)), 6)


def process(csv_file, output_path):
    points, speeds = load_points(csv_file)
    tree = cKDTree(points)
    data = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
    receivers = data['stations'] + data['cities']
    events = {}
    for event in data['events']:
        arrivals = {}
        for receiver in receivers:
            arrivals[receiver['id']] = {phase: travel_time(tree, speeds, event, receiver, phase) for phase in ('p', 's')}
        events[event['id']] = arrivals
    output = {
        'schemaVersion': 1,
        'name': 'Ridgecrest 3D tomography',
        'method': '3D tomography sampled along straight source-to-receiver ray; slowness integrated by trapezoidal rule; inverse-distance-weighted 8 nearest velocity nodes',
        'source': 'White et al. 2021 Ridgecrest 2019 tomography, DOI 10.17632/gv33tgvt5f.2',
        'url': 'https://data.mendeley.com/datasets/gv33tgvt5f/2',
        'limitations': 'Does not solve curved-ray Fermat problem, finite-fault rupture, topography, or full wavefield. Missing spatial coverage is null, never filled with a uniform velocity.',
        'nodeCount': len(points),
        'maxNeighborKm': 5.0,
        'events': events
    }
    Path(output_path).write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    print('3D model nodes:', len(points))
    for key, values in events.items():
        print(key, sum(row['p'] is not None for row in values.values()), 'valid arrivals')
    return output


def download_mendeley(target):
    import requests
    info = requests.get('https://api.data.mendeley.com/datasets/publics/gv33tgvt5f/files', params={'version': 2}, timeout=50)
    info.raise_for_status()
    payload = info.json()
    entries = payload if isinstance(payload, list) else payload.get('results', payload.get('files', []))
    item = next((x for x in entries if str(x.get('filename', x.get('name', ''))).lower().endswith('.csv')), None)
    if item is None:
        raise RuntimeError('Published dataset does not expose a CSV download entry')
    file_id = item.get('id') or item.get('file_id')
    if not file_id:
        raise RuntimeError('Dataset CSV file ID unavailable')
    url = f'https://api.data.mendeley.com/datasets/gv33tgvt5f/files/{file_id}/file_downloaded?version=2'
    with requests.get(url, stream=True, timeout=100, allow_redirects=True) as response:
        response.raise_for_status()
        with Path(target).open('wb') as handle:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    handle.write(chunk)
    if Path(target).stat().st_size < 100_000:
        raise RuntimeError('Downloaded 3D file is unexpectedly small')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/models-3d.json')
    args = parser.parse_args()
    if args.download:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'model.csv'
            download_mendeley(path)
            process(path, args.output)
    elif args.input:
        process(args.input, args.output)
    else:
        parser.error('Provide --input CSV or --download')


if __name__ == '__main__':
    main()
