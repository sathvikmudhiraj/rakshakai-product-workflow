"""Evaluation matching and transformation regressions, with no model calls."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("evaluation", Path(__file__).resolve().parents[1] / "scripts" / "evaluate_scenarios.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class EvaluationTests(unittest.TestCase):
    def test_matching_counts_duplicates_and_missing_boxes(self):
        ground_truth = [("person", [0, 0, 10, 10]), ("car", [20, 20, 30, 30])]
        predictions = [("person", 0.9, [0, 0, 10, 10]), ("person", 0.8, [0, 0, 10, 10])]
        counts = evaluation.score_boxes(predictions, ground_truth)
        self.assertEqual(counts["person"], {"tp": 1, "fp": 1, "fn": 0})
        self.assertEqual(counts["car"], {"tp": 0, "fp": 0, "fn": 1})

    def test_transformations_keep_dimensions_without_mutating_original(self):
        image = np.full((48, 64, 3), 128, dtype=np.uint8)
        variants = evaluation.scenarios(image)
        self.assertTrue(np.all(image == 128))
        self.assertEqual(variants["center_occluded"][24, 32, 0], 0)
        self.assertTrue(all(value.shape == image.shape for value in variants.values()))


if __name__ == "__main__":
    unittest.main()
