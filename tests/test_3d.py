import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from build_3d import geo_xyz, load_points, travel_time
from scipy.spatial import cKDTree


class ThreeDTests(unittest.TestCase):
    def test_constant_grid_integrates_direct_distance(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'grid.csv'
            with path.open('w') as out:
                out.write('latitude,longitude,depth,vp,vs\n')
                for lat in (35.7, 35.8):
                    for lon in (-117.7, -117.6):
                        for depth in (0, 4, 8, 12):
                            out.write(f'{lat},{lon},{depth},6,3.5\n')
            points, velocities = load_points(path)
            tree = cKDTree(points)
            event = {'latitude': 35.75, 'longitude': -117.65, 'depthKm': 8}
            result = travel_time(tree, velocities, event, {'latitude': 35.75, 'longitude': -117.65}, 'p', max_neighbor_km=15)
            self.assertAlmostEqual(result, 8 / 6, places=4)

    def test_missing_coverage_is_null(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'grid.csv'
            path.write_text('latitude,longitude,depth,vp,vs\n35.75,-117.65,0,6,3.5\n35.75,-117.65,8,6,3.5\n')
            points, velocities = load_points(path)
            tree = cKDTree(points)
            event = {'latitude': 35.75, 'longitude': -117.65, 'depthKm': 8}
            result = travel_time(tree, velocities, event, {'latitude': 34, 'longitude': -120}, 's')
            self.assertIsNone(result)


if __name__ == '__main__':
    unittest.main()
