"""RetireCompass must stay fully offline: it transmits nothing. These tests fail
if any network call or remote reference is introduced into the app."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
BANNED = re.compile(r"\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon"
                    r"|https?://(?!localhost|127\.0\.0\.1)")


def test_app_makes_no_network_call():
    offenders = []
    for rel in ["index.html", "js/app.js", "css/styles.css"]:
        for i, line in enumerate((ROOT / rel).read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if BANNED.search(line):
                offenders.append(f"{rel}:{i}: {line.strip()[:90]}")
    assert not offenders, "Offline guarantee broken:\n" + "\n".join(offenders)


def test_csp_blocks_the_network():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "connect-src 'none'" in html
    assert "Content-Security-Policy" in html
