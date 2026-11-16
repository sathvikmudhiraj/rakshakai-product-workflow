"""Audit installed AI dependencies, including official PyTorch CPU builds.

PyPI advisories use the upstream release number, without the official +cpu
wheel suffix. Preserve torch/torchvision in the audit rather than skipping
them when pip-audit cannot find that wheel's local version on PyPI.
"""
import argparse
from importlib import metadata
from pathlib import Path
import subprocess
import sys
import tempfile


def audit_requirements(distributions):
    requirements = set()
    for distribution in distributions:
        name = distribution.metadata["Name"]
        version = distribution.version
        if name.lower().replace("_", "-") in {"torch", "torchvision"} and version.endswith("+cpu"):
            version = version[:-4]
        requirements.add(f"{name}=={version}")
    return sorted(requirements, key=str.lower)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auditor-python", default=sys.executable)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="rakshakai-ai-audit-") as directory:
        requirements = Path(directory) / "installed-requirements.txt"
        requirements.write_text("\n".join(audit_requirements(metadata.distributions())) + "\n", encoding="utf-8")
        return subprocess.run([
            options.auditor_python, "-m", "pip_audit", "-r", str(requirements),
            "--no-deps", "--disable-pip", "--strict", "--progress-spinner", "off", "--timeout", "20"
        ], check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
