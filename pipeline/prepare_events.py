import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    original = json.loads((ROOT / 'data/ridgecrest-2019.json').read_text(encoding='utf-8'))
    a = original['event']
    b = {
        'id': 'ci38443183',
        'title': '2019 Ridgecrest M6.4 Foreshock',
        'magnitude': 6.4,
        'magnitudeType': 'Mw',
        'originUTC': '2019-07-04T17:33:49Z',
        'latitude': 35.705334,
        'longitude': -117.50383,
        'depthKm': 10.5,
        'source': 'https://earthquake.usgs.gov/earthquakes/eventpage/ci38443183',
        'precisionNote': 'USGS reviewed hypocenter; point-source simplification.'
    }
    result = {
        'schemaVersion': 3,
        'events': [a, b],
        'stations': original['stations'],
        'stationSource': original['stationSource'],
        'cities': original['cities'],
        'citySourceNote': original['citySourceNote'],
        'model': original['model']
    }
    (ROOT / 'data/events.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
