#!/usr/bin/env python3
"""Offline desktop launcher for RetireCompass.

RetireCompass is a fully client-side app: this launcher only serves the bundled
static files from the local machine and opens them in the default browser. It
uses the Python standard library only, makes no network call, and transmits
nothing. Closing the console window stops the local server.
"""
from __future__ import annotations

import functools
import http.server
import os
import socketserver
import sys
import threading
import webbrowser


def _resource_root() -> str:
    # PyInstaller unpacks bundled data to _MEIPASS; in source we serve this dir.
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    root = _resource_root()
    port = int(os.environ.get("RETIRECOMPASS_PORT", "8777"))
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    handler.log_message = lambda *a, **k: None  # keep the console quiet
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}/index.html"
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        print(f"RetireCompass is running at {url}")
        print("Your data stays on this machine. Close this window to quit.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
