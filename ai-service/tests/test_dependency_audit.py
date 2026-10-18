"""Ensure CPU wheels remain covered by the dependency advisory gate."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location(
    "audit_ai_dependencies", Path(__file__).resolve().parents[2] / "scripts" / "audit-ai-dependencies.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DependencyAuditTests(unittest.TestCase):
    def test_official_cpu_wheels_are_audited_as_upstream_releases(self):
        distributions = [
            SimpleNamespace(metadata={"Name": "torch"}, version="2.14.1+cpu"),
            SimpleNamespace(metadata={"Name": "torchvision"}, version="0.29.1+cpu"),
            SimpleNamespace(metadata={"Name": "starlette"}, version="1.9.0"),
        ]
        self.assertEqual(audit.audit_requirements(distributions), [
            "starlette==1.9.0", "torch==2.14.1", "torchvision==0.29.1"
        ])

    def test_unrecognized_local_builds_are_not_silently_excluded_or_relabelled(self):
        distributions = [
            SimpleNamespace(metadata={"Name": "torch"}, version="2.14.1+custom"),
            SimpleNamespace(metadata={"Name": "private-package"}, version="1.0+cpu"),
        ]
        self.assertEqual(audit.audit_requirements(distributions), [
            "private-package==1.0+cpu", "torch==2.14.1+custom"
        ])
