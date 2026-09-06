<p align="center">
  <img src="assets/banner.svg" alt="RetireCompass — household retirement navigator" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-1b3a4b" alt="version 1.0.0">
  <img src="https://img.shields.io/badge/license-MIT-0e7c7b" alt="MIT license">
  <img src="https://img.shields.io/badge/runs-100%25%20offline-c9a227" alt="runs offline">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Browser-5c6b73" alt="cross platform">
  <img src="https://img.shields.io/badge/accounts-none-276749" alt="no accounts">
</p>

<p align="center"><strong>A household retirement navigator that answers one honest question:</strong><br>
<em>given your real life — kids, parents, debt, a partner, healthcare, housing, taxes — will your money last?</em></p>

RetireCompass runs entirely on your device. No account, no subscription, no cloud, no ad network, **no network call at all** — every number you type stays with you, and every number it shows is produced by plain, visible arithmetic. There is no AI in the logic and no hidden default that isn't a labelled input on screen. It is **decision-support, not financial advice**.

---

## Try it

- **In your browser:** use it live at **<https://rajeevyadav.github.io/retirecompass/>** — nothing to install.
- **On your desktop:** download the offline app for **Windows / macOS / Linux** from the [latest release](https://github.com/rajeevyadav/retirecompass/releases/latest). It opens in your browser at `http://127.0.0.1:8777/` and runs with no internet connection.

The same tool is fully responsive on a phone, tablet or desktop.

---

## Why it exists

Most "how much do I need to retire?" tools collapse a household into one number ("70–80% of your income") and one rule. RetireCompass treats the lines that actually break plans as first-class modules, not footnotes:

- spending that doesn't drop the day you stop working, and fades only later;
- healthcare inflation above CPI, and property tax / insurance / upkeep after the mortgage is gone;
- tax on public pensions and sheltered withdrawals, clawbacks and surcharges;
- children still dependent past your retirement age, and education pots;
- eldercare for a parent; one-off gifts; ongoing debt that may not amortize;
- a long-term-care block in the tail; job-loss, disability and survivor shocks;
- a plan-to age of 95 or 100, not a hopeful 85.

## What's inside (v1.0)

A step-by-step model across sixteen sections: household / currency, job & layoff & disability risk, partner & survivor path, kids & education accounts, eldercare, one-off gifts, pets, upskilling & debt amortization, insurance, home sale / downsize, country accounts & contribution room, a stylized tax engine, everyday living + pensions + long-term care with a stress scenario, a **result** (sufficiency verdict, KPIs, structural flags), a full **year-by-year** table, and a **roadmap** of what to watch for.

## How to use it

1. Fill in your real numbers everywhere; leave every "shock" toggle **off** — that's your base case.
2. Turn on the **survivor path** and check the surviving partner is still funded.
3. Turn on a **job-loss** or **disability** shock at an age you're worried about, and watch how far it moves the "money runs out" age.
4. Read the **stress-test** KPI as your margin of safety, not a prediction.

Use **Print / PDF** for a clean, professional report you can keep or share.

---

## Privacy & security by design

- **Transmits nothing.** A strict Content-Security-Policy (`connect-src 'none'`) blocks every network request; a release test fails the build if any `fetch`, socket or remote URL is ever introduced.
- **No account, no tracking, no storage on any server.** Your inputs live only in your browser session (and any file you choose to save).
- See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Build from source

```bash
python -m pip install -r requirements-build.txt
build_exe.bat            # Windows: dist\RetireCompass.exe
```

Windows / macOS / Linux launchers are also produced by CI (the **Build desktop packages** workflow) and attached to each tagged release.

## Verification

```bash
python -m pytest                  # offline-guarantee, hygiene and structure guards
python tools/verify_release.py    # full release gate (syntax, offline, manifest, version)
```

## Limits

- Not investment, tax or financial advice, and not a broker or planner.
- Country tax/pension/account rules are **stylized** and simplified — confirm the specifics for your jurisdiction.
- A deterministic projection is only as good as the assumptions you enter; change one and the answer changes.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Rajeev Yadav.

**Disclaimer.** Educational decision-support software. Projections can be wrong for your situation; suitability, tax and financial decisions are yours.
