import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from build_1d import surface_distance
from fetch_events_phases import parse_event


class ModelTests(unittest.TestCase):
    def test_zero_distance(self):
        place = {'latitude': 35.77, 'longitude': -117.599}
        self.assertAlmostEqual(surface_distance(place, place), 0)

    def test_second_event_available(self):
        data = json.loads((ROOT / 'data/events.json').read_text())
        self.assertEqual([x['id'] for x in data['events']], ['ci38457511', 'ci38443183'])

    def test_origin_alignment_second_event(self):
        data = json.loads((ROOT / 'data/events.json').read_text())
        event = data['events'][1]
        raw = '38443183 eq l 2019/07/04,17:33:49.040 35.70 -117.50 10.5 6.4\nCI CLC HHZ -- 35.8157 -117.5975 775.0 P d. i 0.8 12.3 9.12'
        result = parse_event(raw, event, data['stations'], 'test')
        self.assertEqual(result['eventId'], 'ci38443183')
        self.assertAlmostEqual(result['observations'][0]['p'], 9.16)


if __name__ == '__main__':
    unittest.main()
