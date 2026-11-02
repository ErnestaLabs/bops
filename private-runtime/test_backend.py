import unittest
from unittest.mock import patch, MagicMock
import backend

class WorkerTests(unittest.TestCase):
    def test_name_validation(self):
        for value in ("", "Abc", "../other", "a b", "x" * 41, None):
            with self.assertRaises(ValueError):
                backend.worker_name(value)
        self.assertEqual(backend.worker_name("sales-2"), "ernesta-sales-2")

    @patch("backend.docker")
    def test_isolation_flags(self, docker):
        backend.create_worker("sales")
        args = docker.call_args.args
        self.assertIn("--network", args)
        self.assertIn("none", args)
        self.assertIn("--cap-drop", args)
        self.assertIn("ALL", args)
        self.assertIn("--read-only", args)
        self.assertIn("no-new-privileges", args)

    @patch("backend.docker")
    def test_delete_uses_sanitised_name(self, docker):
        backend.delete_worker("ops")
        docker.assert_called_once_with("rm", "-f", "ernesta-ops")

if __name__ == "__main__":
    unittest.main()
