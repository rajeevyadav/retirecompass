"""Production source carries no engineering-process labels."""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
KILL = re.compile(r"\bTrack [AB]\b|\bPhase [1-4]\b|\bSlice [12]\b|\bD-00[0-9]\b|directive\b|source drop", re.I)


def test_no_process_labels_in_source():
    files = subprocess.check_output(["git", "ls-files", "*.js", "*.py", "*.html", "*.css"],
                                    cwd=str(ROOT)).decode().split()
    offenders = []
    for rel in files:
        if rel.startswith("tests/"):
            continue
        for i, line in enumerate((ROOT / rel).read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if KILL.search(line):
                offenders.append(f"{rel}:{i}: {line.strip()[:80]}")
    assert not offenders, "Process labels in source:\n" + "\n".join(offenders)
