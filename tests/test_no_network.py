"""RetireCompass must stay fully offline: it transmits nothing and auto-loads no
remote resource. Plain hyperlinks (<a href> to a download/release page) are
user-initiated navigation, not a network call, and are allowed."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
# JavaScript network APIs — forbidden anywhere.
JS_NET = re.compile(r"\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|navigator\.sendBeacon")
# Auto-loaded remote resources: src=, @import, url(...) pointing at http(s).
# (Not <a href>, which only navigates when the user clicks it.)
RESOURCE = re.compile(r"(?:\bsrc\s*=|@import|\burl\s*\()\s*['\"]?https?://", re.I)


def test_app_makes_no_network_call():
    offenders = []
    for rel in ["index.html", "js/app.js", "css/styles.css"]:
        for i, line in enumerate((ROOT / rel).read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if JS_NET.search(line) or RESOURCE.search(line):
                offenders.append(f"{rel}:{i}: {line.strip()[:90]}")
    assert not offenders, "Offline guarantee broken (network call or remote resource):\n" + "\n".join(offenders)


def test_csp_blocks_the_network():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "connect-src 'none'" in html and "Content-Security-Policy" in html
