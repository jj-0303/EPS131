import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from fetch_phases import build_output, read_phase_text


class PhaseParserTest(unittest.TestCase):
    def setUp(self):
        self.event = json.loads((ROOT / "data" / "ridgecrest-2019.json").read_text())
        self.text = "\n".join([
            "38457511 le 2019/07/06,03:19:53.500 35.7700 -117.5990 8.0 7.1 l 1.0",
            "CI CLC HHZ -- 35.8157 -117.5975 1469.0 P c. i 1.0 5.44 2.100",
            "CI CLC HHZ -- 35.8157 -117.5975 1469.0 P c. i 1.0 5.44 2.400",
            "CI CLC HHE -- 35.8157 -117.5975 1469.0 S c. i 1.0 5.44 3.800",
            "CI CCC HHZ -- 35.5249 -117.3645 512.0 P c. i 1.0 25.2 5.600",
            "CI XYZ HHZ -- 35.5249 -117.3645 512.0 P c. i 1.0 25.2 5.600"
        ])

    def test_alignment_and_earliest_pick(self):
        result = build_output(self.text, self.event)
        clc = next(s for s in result["observations"] if s["id"] == "CI.CLC")
        self.assertAlmostEqual(clc["p"], 2.6)
        self.assertAlmostEqual(clc["s"], 4.3)
        self.assertEqual(len(result["observations"]), 2)
        self.assertAlmostEqual(result["originOffsetSeconds"], 0.5)

    def test_real_scedc_header(self):
        raw = "\n".join([
            "  38457511 eq  l 2019/07/06,03:19:53.040   35.7695   -117.5993   8.00  7.10  w 0.5",
            "\tCI    CLC HHZ --   35.8157  -117.5975   775.0 P d. i  0.8    5.14   0.628"
        ])
        result = build_output(raw, self.event)
        self.assertEqual(len(result["observations"]), 1)
        self.assertAlmostEqual(result["observations"][0]["p"], 0.668)

    def test_wrong_event_rejected(self):
        with self.assertRaises(ValueError):
            read_phase_text(self.text.replace("38457511 le", "12345678 le"), "38457511")


if __name__ == "__main__":
    unittest.main()
