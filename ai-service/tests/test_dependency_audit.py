"""Ensure CPU wheels remain covered by the dependency advisory gate."""
import importlib.util
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "audit_ai_dependencies", ROOT / "scripts" / "audit-ai-dependencies.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DependencyAuditTests(unittest.TestCase):
    def test_patched_setuptools_pin_is_shared_by_ci_and_docker_installs(self):
        requirements = (ROOT / "ai-service" / "requirements.txt").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "release-checks.yml").read_text(encoding="utf-8")
        dockerfile = (ROOT / "ai-service" / "Dockerfile").read_text(encoding="utf-8")

        self.assertRegex(requirements, r"(?m)^setuptools==84\.1\.0$")
        for audited_requirement in ("certifi==2026.10.23", "filelock==4.2.8", "pillow==13.0.0"):
            self.assertIn(audited_requirement, requirements)
        self.assertIn("pip install -r ai-service/requirements.txt pip-audit", workflow)
        self.assertIn("pip install -r requirements.txt", dockerfile)
        self.assertNotRegex(workflow, r"setuptools==(?:8[0-3]\.|84\.0\.)")
        self.assertNotRegex(dockerfile, r"setuptools==(?:8[0-3]\.|84\.0\.)")

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
