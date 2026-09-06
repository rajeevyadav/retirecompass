# Security

RetireCompass is a fully client-side, offline application. Its attack surface is
deliberately tiny.

## Guarantees enforced in the build

- **Offline / no network:** a strict CSP (`connect-src 'none'`, `script-src 'self'`)
  and a release test forbid any network call, remote script, or external
  resource.
- **No secrets or private data in the repository:** a guard workflow and a
  release check fail if anything matching `private/`, `secrets.*`, `*.key` or
  `*.pem` is ever tracked.
- **Integrity:** `RELEASE_MANIFEST.sha256` records a SHA-256 for every tracked
  file; `tools/verify_release.py` verifies each hash and that the manifest lists
  exactly the tracked file set.
- **No third-party runtime code:** the app depends on no external JavaScript,
  CDN, or package. The desktop launcher uses only the Python standard library.

## Reporting

Please open a private report via GitHub Security Advisories on this repository,
or contact the maintainer. Do not include real personal financial data in a
report.
