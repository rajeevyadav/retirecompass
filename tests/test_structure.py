"""The repository ships the expected files and a consistent version."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_required_files_present():
    for rel in ["index.html", "js/app.js", "css/styles.css", "LICENSE", "README.md",
                "run_retirecompass.py", "assets/logo.svg", "PRIVACY.md", "SECURITY.md"]:
        assert (ROOT / rel).exists(), f"missing {rel}"


def test_version_is_semver():
    v = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    assert re.match(r"^\d+\.\d+\.\d+$", v), v
