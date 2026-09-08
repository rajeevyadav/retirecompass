"""Cross-consistency regression suite for the calculation engine.

Runs tests/scenario_engine.js (a headless-DOM harness using jsdom) and
asserts it exits clean. The heavy lifting — driving the real index.html +
js/app.js exactly like a person would, then checking that the chart, the
KPI cards, and the year-by-year table all agree with each other for the
same plan — lives in that script; see its own header comment for why this
exists (an external QA review found the three could silently disagree by
up to 14 years on the same plan).

This wrapper exists so the check runs as part of the normal `pytest -q`
suite the rest of this repo already uses, rather than needing a separate
CI step someone has to remember to run.
"""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_scenario_engine_passes():
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "scenario_engine.js")],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, (
        "scenario_engine.js reported a failure — the chart, a KPI card, "
        "and/or the year-by-year table disagree on at least one scenario. "
        "Full output:\n\n" + result.stdout + "\n" + result.stderr
    )
