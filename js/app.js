/* =============================================================================
   RetireCompass — js/app.js
   =============================================================================
   Author: Rajeev Yadav
   Version: 1.1.0

   WHAT THIS FILE IS
   ------------------
   The entire calculation engine for RetireCompass, a household retirement
   planning tool. There is no server, no build step and no external network
   call anywhere in this file — every number the person types stays on their
   own device, and every number the tool shows is produced by plain
   arithmetic below. There is no AI model, no "smart" inference, and no
   hidden default that isn't visible as a labelled input somewhere in
   index.html.

   WHY IT'S BUILT THIS WAY
   ------------------------
   Most retirement calculators collapse a household's real life into one
   number ("you'll need 70-80% of your current income") and one rule
   ("withdraw 4% a year"). That hides exactly the things that break real
   plans: a child who is still a financial dependent after you retire, a
   credit card that isn't actually amortizing, a mortgage that runs past
   your last paycheque, healthcare costs that inflate faster than everything
   else, and the risk that you lose your job or your health before you
   planned to. So instead of one formula, this engine walks the household
   forward one year at a time from today to a "plan-to" age, recalculating
   every cost, every income stream and every account balance for that
   specific year, then reports the first year (if any) the money runs out.

   HOW THE FILE IS ORGANISED
   --------------------------
   1. Reference data       — country tax/inflation tables, city cost bands,
                              profession risk packs, debt type list.
   2. DOM helpers          — tiny wrappers so the rest of the file can read
                              an input safely even if that element is ever
                              removed from the HTML (it won't crash, it will
                              just fall back to a sane default).
   3. Editable row state   — the kids / debts / one-off-gifts tables are
                              user-editable lists, kept here as plain arrays.
   4. Math helpers         — hazard (job-loss risk) curve, debt amortization,
                              per-child cost windows, progressive tax bracket
                              calculator. Each is a small, independently
                              testable piece of the bigger year-by-year loop.
   5. Table renderers      — turn the arrays in (3) into editable <tr> rows.
   6. Country/profession/  — when the person changes a dropdown, these
      city appliers           functions load that pack's typical numbers
                              into the relevant inputs (which the person can
                              then override by hand).
   7. run()                — the main engine. Reads every input on the page,
                              simulates the household year by year, and
                              writes the results (KPIs, flags, year-by-year
                              table, and a plain-English report) back into
                              the page.
   8. Boot                 — wires up every button/table/dropdown once the
                              page has loaded, and runs the first calculation
                              so the page isn't blank on load.

   A NOTE ON "STYLIZED" NUMBERS
   ------------------------------
   Tax brackets, pension clawback thresholds, IRMAA-style healthcare
   surcharges and country contribution-room figures below are deliberately
   simplified planning anchors — not a filing engine. They exist so the tool
   can show a realistic *shape* of tax (progressive, with a clawback cliff
   where relevant) rather than pretending tax is a single flat percentage.
   Replace them with your own numbers from a real tax return wherever it
   matters. This is stated in the on-page disclaimer as well.
   ========================================================================= */
(function () {
  "use strict";

  /* Bump this whenever the calculation logic changes, so a saved/printed
     report can always be traced back to the engine version that produced
     it. Shown in the header badge and on every printed page footer. */
  const APP_VERSION = "1.1.0";

  /* ===========================================================================
     1. REFERENCE DATA
     =========================================================================== */

  /* Per-country planning defaults. These populate the "Country" dropdown and
     are only a *starting point* — every field they set (currency, inflation
     rates, tax brackets...) is a normal editable input the person can
     override.
       ccy       — default account currency for that country
       infG      — general consumer-price inflation, used for salaries,
                   pensions, kids, parents, gifts, debt (things not tied to
                   a specific inflating category like housing or health)
       infH      — healthcare-specific inflation (usually runs hotter than
                   general CPI almost everywhere)
       infHouse  — housing-carry inflation (property tax, insurance,
                   maintenance)
       repl      — OECD-style "net replacement rate": what fraction of a
                   full working career's income a country's *mandatory*
                   public pension system typically replaces. This is shown
                   as an informational note only — the person should type
                   their real, personal pension amount rather than rely on
                   this average.
       brackets  — [[upperBoundOfBand, marginalRateOnThatBand], ...] used by
                   bracketTax() below to compute a progressive tax estimate.
                   These are rough, illustrative bands, not a real tax table.
       oas       — (Canada only) stylized "OAS clawback": above a household
                   income threshold, public pension income is reduced by a
                   clawback rate. Real OAS clawback has more nuance (it's
                   individual, not household, and the threshold/rate change
                   yearly) — this is a planning approximation of the shape
                   of that risk, not the CRA's actual formula.
       irmaa     — (US only) stylized "IRMAA-style" Medicare premium
                   surcharge: crossing an income threshold adds a healthcare
                   surcharge, and further multiples of that threshold add
                   further surcharge steps. Again, a shape-of-the-risk
                   approximation, not the real IRMAA table.
       room      — a very rough "how much can one person put in a
                   tax-sheltered account per year" figure for that country,
                   used only to warn the person if their intended
                   contributions look larger than what's normally
                   tax-sheltered there (the excess would sit in an ordinary
                   taxable account instead, which behaves differently). */
  const COUNTRIES = {
    Canada: { ccy: "CAD", infG: 0.025, infH: 0.045, infHouse: 0.04, repl: 0.451,
      brackets: [[55000,.25],[111000,.30],[173000,.37],[Infinity,.44]],
      oas: { threshold: 90997, rate: 0.15 },
      room: 39490, roomNote: "TFSA + RRSP room, stylized (approx. $7,000 TFSA + ~18% of income up to $32,490 RRSP)." },
    "United States": { ccy: "USD", infG: 0.028, infH: 0.055, infHouse: 0.04, repl: 0.397,
      brackets: [[45000,.12],[95000,.22],[182000,.24],[Infinity,.32]],
      irmaa: { threshold: 103000, step: 103000, surcharge: 2500 },
      room: 30500, roomNote: "401(k) + IRA room, stylized (approx. $23,500 + $7,000)." },
    "United Kingdom": { ccy: "GBP", infG: 0.025, infH: 0.04, infHouse: 0.035, repl: 0.542,
      brackets: [[12570,0],[50270,.20],[125140,.40],[Infinity,.45]],
      room: 80000, roomNote: "ISA + pension annual allowance, stylized (approx. £20,000 + £60,000)." },
    India: { ccy: "INR", infG: 0.05, infH: 0.13, infHouse: 0.06, repl: 0.234,
      brackets: [[700000,.05],[1000000,.10],[1500000,.20],[Infinity,.30]],
      room: 150000, roomNote: "80C-style deduction room, stylized (approx. ₹150,000)." },
    Australia: { ccy: "AUD", infG: 0.028, infH: 0.045, infHouse: 0.038, repl: 0.501,
      brackets: [[45000,.19],[135000,.30],[190000,.37],[Infinity,.45]],
      room: 30000, roomNote: "Superannuation concessional cap, stylized (approx. A$30,000)." },
    Germany: { ccy: "EUR", infG: 0.023, infH: 0.035, infHouse: 0.03, repl: 0.533,
      brackets: [[11000,0],[66760,.30],[277825,.42],[Infinity,.45]],
      room: 20000, roomNote: "Riester/Basisrente-style room, stylized (approx. €20,000)." },
    France: { ccy: "EUR", infG: 0.022, infH: 0.03, infHouse: 0.03, repl: 0.7,
      brackets: [[11294,0],[28797,.11],[82341,.30],[Infinity,.41]],
      room: 10000, roomNote: "PER (plan d'épargne retraite) room, stylized (approx. €10,000)." },
    Spain: { ccy: "EUR", infG: 0.023, infH: 0.035, infHouse: 0.032, repl: 0.804,
      brackets: [[12450,.19],[20200,.24],[35200,.30],[Infinity,.37]],
      room: 1500, roomNote: "Private pension-plan deduction room, stylized (approx. €1,500)." },
    Portugal: { ccy: "EUR", infG: 0.023, infH: 0.035, infHouse: 0.032, repl: 0.724,
      brackets: [[12450,.19],[20200,.24],[35200,.30],[Infinity,.37]],
      room: 2000, roomNote: "PPR (plano poupança-reforma) room, stylized (approx. €2,000)." },
    Netherlands: { ccy: "EUR", infG: 0.023, infH: 0.035, infHouse: 0.03, repl: 0.96,
      brackets: [[75518,.3697],[Infinity,.495]],
      room: 13000, roomNote: "Lijfrente (annuity) room, stylized (approx. €13,000)." },
    Japan: { ccy: "JPY", infG: 0.015, infH: 0.03, infHouse: 0.02, repl: 0.424,
      brackets: [[1950000,.05],[3300000,.10],[6950000,.20],[Infinity,.23]],
      room: 810000, roomNote: "NISA + iDeCo room, stylized (approx. ¥810,000)." },
    Mexico: { ccy: "MXN", infG: 0.04, infH: 0.07, infHouse: 0.05, repl: 0.796,
      brackets: [[250000,.10],[1000000,.21],[Infinity,.30]],
      room: 152000, roomNote: "Afore/PPR deduction room, stylized (approx. MX$152,000)." },
    "United Arab Emirates": { ccy: "AED", infG: 0.025, infH: 0.06, infHouse: 0.04, repl: 0,
      brackets: [[Infinity,0]],
      room: 0, roomNote: "No federal personal income tax and no standard tax-sheltered wrapper — plan on taxable brokerage/end-of-service gratuity." },
    "Custom / Other": { ccy: "XXX", infG: 0.03, infH: 0.05, infHouse: 0.035, repl: 0.4,
      brackets: [[Infinity,.25]],
      room: 0, roomNote: "No local table loaded — use flat-rate tax mode and edit contribution limits yourself." }
  };

  /* City cost-of-living multiplier. Applied on top of the profession
     multiplier to core living + discretionary spending — housing and
     healthcare are typed directly by the person and should already reflect
     their city, so this band deliberately does NOT touch those two. */
  const CITY_BANDS = {
    "Low-cost / rural": 0.85,
    "Typical metro": 1.00,
    "High-cost city": 1.20,
    "Very high-cost (major global metro)": 1.45
  };

  /* Profession pack: a starting cost-of-living multiplier, plus the shape of
     that profession's job-loss ("hazard") risk over age.

     WHY A HAZARD *CURVE* AND NOT A FLAT RISK NUMBER:
     Layoff risk in most white-collar/skilled fields is not constant with
     age — it tends to sit low, then climb once someone is old enough to be
     "expensive" relative to a younger replacement but young enough to still
     be a layoff candidate rather than protected by seniority/tenure norms.
     We model that climb with a simple exponential:

         hazard(age) = min(cap, h0 * exp(k * max(0, age - aStar)))

     - h0     = the baseline yearly hazard once you reach the "turning point"
                age (aStar)
     - k      = how sharply the hazard grows per year of age past aStar
     - aStar  = the age the hazard starts climbing (the "kink")
     - cap    = a ceiling, because no realistic yearly layoff chance should
                run away to 100%

     These are planning anchors calibrated by hand from general labour-market
     patterns, not a fitted statistical model — the point is to force the
     conversation about age-related income risk, not to claim precision. */
  const PROFESSIONS = {
    "Software / AI / tech": { col: 1.15, h0: 0.04, k: 0.18, aStar: 48, cap: 0.38, out: 0.55, note: "High cash COL + age-steep layoff curve after late 40s. Re-entry often means contractor/rate cut." },
    "Finance / consulting": { col: 1.20, h0: 0.035, k: 0.16, aStar: 50, cap: 0.32, out: 0.50, note: "Bonus-shaped lifestyle. Age risk is real past 50; COL rarely falls with the bonus." },
    "Physician / clinical": { col: 1.18, h0: 0.015, k: 0.08, aStar: 60, cap: 0.18, out: 0.35, note: "High COL, lower layoff hazard, but disability/hours risk is the real late-career shock." },
    "Nursing / allied health": { col: 1.00, h0: 0.02, k: 0.07, aStar: 55, cap: 0.20, out: 0.30, note: "Demand holds; body does not. Model hours-cut as income haircut." },
    "Engineering (non-tech)": { col: 1.08, h0: 0.025, k: 0.12, aStar: 52, cap: 0.26, out: 0.40, note: "Cyclical project work. Age slope milder than pure software." },
    "Public sector / civil service": { col: 0.95, h0: 0.010, k: 0.05, aStar: 58, cap: 0.12, out: 0.25, note: "Lower COL and layoff hazard; a pension is often the real asset. Do not import a private-sector savings rate." },
    "Education / teaching": { col: 0.92, h0: 0.015, k: 0.06, aStar: 55, cap: 0.16, out: 0.28, note: "Steady demand, modest pay growth. Summers-off lifestyle can hide real annual cost of living." },
    "Military / armed forces (active or veteran)": { col: 1.00, h0: 0.015, k: 0.10, aStar: 42, cap: 0.20, out: 0.30, note: "Pension can often be drawn well before typical civilian retirement age — model your actual service pension in section 13's DB pension fields, not just the public-pension field. Post-service civilian transition is the real income-risk window, not a late-career layoff curve." },
    "Trades / skilled labour (electrician, plumber, mechanic, etc.)": { col: 0.98, h0: 0.03, k: 0.09, aStar: 55, cap: 0.22, out: 0.40, note: "Body and winter/cycle risk. COL is local, not LinkedIn." },
    "Manufacturing / factory floor": { col: 0.92, h0: 0.045, k: 0.11, aStar: 50, cap: 0.30, out: 0.42, note: "Plant closures and automation are the real late-career risk, often with little notice." },
    "Construction / heavy labour": { col: 0.95, h0: 0.05, k: 0.10, aStar: 48, cap: 0.32, out: 0.45, note: "Seasonal and cyclical by nature; physical toll accelerates hazard earlier than most fields." },
    "Transportation / logistics / driving": { col: 0.95, h0: 0.035, k: 0.09, aStar: 52, cap: 0.28, out: 0.40, note: "Steady demand but physically demanding; medical-certification risk is a real late-career factor." },
    "Agriculture / farming": { col: 0.90, h0: 0.02, k: 0.06, aStar: 55, cap: 0.20, out: 0.30, note: "Income is often uneven year to year (weather, prices) rather than a clean employment/layoff curve — treat the hazard fields here as a rough stand-in for income variability." },
    "Mining / oil & gas / resource extraction": { col: 1.05, h0: 0.05, k: 0.13, aStar: 48, cap: 0.34, out: 0.45, note: "High pay, high cyclicality — commodity-price downturns hit an entire site or region at once." },
    "Retail / hospitality / food service": { col: 0.90, h0: 0.06, k: 0.10, aStar: 50, cap: 0.35, out: 0.50, note: "High baseline churn at every age. Hours, not title, drive income." },
    "Corporate / office administration": { col: 1.02, h0: 0.03, k: 0.13, aStar: 50, cap: 0.28, out: 0.42, note: "Reorganizations and outsourcing are the usual late-career risk rather than a single dramatic event." },
    "Sales / marketing": { col: 1.05, h0: 0.045, k: 0.14, aStar: 48, cap: 0.34, out: 0.45, note: "Commission-shaped income. Quota-driven roles often see the sharpest age-related turnover." },
    "Legal": { col: 1.15, h0: 0.02, k: 0.10, aStar: 55, cap: 0.20, out: 0.30, note: "Lower layoff hazard than most fields, but high COL and often a long, expensive credential path already behind you." },
    "Arts / media / entertainment": { col: 1.05, h0: 0.07, k: 0.12, aStar: 45, cap: 0.40, out: 0.55, note: "Project-based, often no single employer — income variability itself is closer to the real risk than a layoff event." },
    "Nonprofit / social services": { col: 0.90, h0: 0.03, k: 0.09, aStar: 52, cap: 0.24, out: 0.38, note: "Funding-cycle risk (grants, donations) rather than a typical corporate layoff curve." },
    "Homemaker / caregiver (unpaid)": { col: 0.90, h0: 0.0, k: 0.0, aStar: 65, cap: 0.0, out: 0.0, note: "No direct job-loss hazard modeled since there's no employer — but make sure a public/spousal pension and your own retirement accounts (section 11) reflect this properly; unpaid care work is real work and deserves real retirement savings." },
    "Founder / contract / gig": { col: 1.10, h0: 0.08, k: 0.14, aStar: 48, cap: 0.45, out: 0.60, note: "Income is the hazard. Treat 'salary' as a good year, not a line." },
    "MedTech / regulatory / RA-QA": { col: 1.10, h0: 0.03, k: 0.14, aStar: 50, cap: 0.28, out: 0.40, note: "Specialist demand, thin benches, restructuring waves. Age slope is real after 50." },
    "Other / custom": { col: 1.00, h0: 0.03, k: 0.12, aStar: 52, cap: 0.28, out: 0.40, note: "Edit hazard fields on this row via the inputs; pack is only a start." }
  };

  const DEBT_TYPES = ["Mortgage", "Credit card", "Line of credit", "Auto loan", "Student loan", "Other"];

  /* Education program presets (section 4). Real education cost is nowhere
     close to a single number — a medical degree, an MBA, and a public
     college lived at home are entirely different financial events, and
     living away from home roughly doubles or triples the cost of an
     otherwise-identical program through rent/food/travel alone. These are
     stylized, illustrative anchors (see the "stylized" note throughout this
     file) meant to get a realistic-shaped number into the plan quickly —
     the person should edit tuition/duration to match their real target
     school once they know it.
       tuition — typical all-in annual cost (tuition + fees, and living
                 costs where the preset says "away")
       years   — typical program length, used to set the tuition end age
                 from whatever start age is currently on that row */
  const EDU_PROGRAMS = {
    "— pick a program (or edit tuition directly) —": null,
    "Trade / certificate program (2 yr)": { tuition: 9000, years: 2 },
    "Public college, living at home (4 yr)": { tuition: 12000, years: 4 },
    "Public college, living away (4 yr)": { tuition: 28000, years: 4 },
    "Private college (4 yr)": { tuition: 58000, years: 4 },
    "Graduate school — Master's (2 yr)": { tuition: 35000, years: 2 },
    "Graduate school — PhD, often funded (5 yr)": { tuition: 6000, years: 5 },
    "Business school / MBA (2 yr)": { tuition: 95000, years: 2 },
    "Law school (3 yr)": { tuition: 68000, years: 3 },
    "Medical school (4 yr)": { tuition: 72000, years: 4 },
    "International / study abroad (4 yr)": { tuition: 46000, years: 4 }
  };

  /* ===========================================================================
     2. DOM HELPERS
     =========================================================================== */

  /* $ is the classic shorthand for document.getElementById. */
  const $ = (id) => document.getElementById(id);

  /* has() lets the rest of the file check "does this input actually exist on
     the page?" before touching it. Every num()/sel()/setText() below already
     does this check internally, so a future HTML edit that renames or
     removes a field degrades gracefully (falls back to a default) instead
     of throwing an error that would stop the entire calculation. This is
     exactly the bug class that made the previous version of this app
     unusable: the HTML and the JS had drifted apart, and one missing
     element crashed the whole script. */
  const has = (id) => !!$(id);

  /* num() reads a numeric input by id, returning a fallback default `d` if
     the element is missing or its value isn't a valid number (e.g. empty,
     or the person typed letters). */
  const num = (id, d = 0) => {
    const el = $(id);
    if (!el) return d;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : d;
  };

  /* sel() reads a <select> or text input's raw value, again with a safe
     fallback if the element is missing. */
  const sel = (id, d = "") => (has(id) ? $(id).value : d);

  /* setText() writes text into an element only if that element exists —
     used for every "note" paragraph and KPI box the engine fills in. */
  const setText = (id, txt) => { if (has(id)) $(id).textContent = txt; };

  /* fmt() formats a number as currency using the browser's own
     Intl.NumberFormat, so thousands separators/decimal style match the
     person's own locale. "XXX" isn't a real ISO currency code (it's what we
     show for "Custom / Other" country), so we fall back to USD formatting
     for it, and fall back to a plain rounded number if formatting fails for
     any other reason (e.g. an unrecognized currency code the person typed
     by hand into the currency field). */
  const fmt = (n, ccy) => {
    if (!Number.isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy === "XXX" ? "USD" : ccy, maximumFractionDigits: 0 }).format(n);
    } catch (e) {
      return Math.round(n).toLocaleString();
    }
  };

  /* pct() turns a decimal fraction (0.28) into a percentage string ("28.0%"). */
  const pct = (n) => (Number.isFinite(n) ? (n * 100).toFixed(1) : "0.0") + "%";

  /* esc() prevents a person's typed text (a child's name, a debt's name...)
     from breaking the HTML we generate for the editable tables, by escaping
     double quotes before we drop the value into an attribute. */
  const esc = (s) => String(s).replace(/"/g, "&quot;");

  /* ===========================================================================
     3. EDITABLE ROW STATE (kids / debts / one-off gifts)
     =========================================================================== */

  /* These three arrays back the three editable tables in the page (section
     4, 6 and 7 of index.html). They start pre-filled with one example row
     each so the tool shows a working example the first time it's opened,
     rather than an empty, confusing table. The person edits/adds/removes
     rows through the table UI; render*() below turns whichever state is
     current into HTML, and bindTables() wires up the edits back into these
     arrays. */

  let kids = [];
  let debts = [
    { name: "Home", type: "Mortgage", balance: 280000, rate: 0.045, payment: 18000 },
    { name: "Visa", type: "Credit card", balance: 8000, rate: 0.199, payment: 2400 }
  ];
  let gifts = [
    { name: "Wedding help", ageAt: 58, amount: 20000 }
  ];
  /* Pets (section 7): food/grooming/insurance + a vet-cost line per pet,
     each running until the age the person expects that cost to end (i.e.
     the pet's expected lifespan). Modeled the same shape as gifts/debts —
     a simple editable list, not a full actuarial pet-mortality model. */
  let pets = [
    { name: "Dog", cost: 1800, vet: 900, untilAge: 62 }
  ];

  /* ===========================================================================
     4. MATH HELPERS
     =========================================================================== */

  /* hazard(): the job-loss-risk curve described above the PROFESSIONS table.
     Returns a probability (0-1) for a single given age. */
  function hazard(age, h0, k, aStar, cap) {
    const raw = h0 * Math.exp(k * Math.max(0, age - aStar));
    return Math.min(cap, raw);
  }

  /* emergencyMonths(): how many months of essential costs (core living +
     housing + healthcare) this tool suggests keeping in a plain, uninvested
     savings account at a given age — see the age-based table in the Guide
     tab's "Investing basics" for the reasoning. This is a widely-used rule
     of thumb, not a personalized recommendation. */
  function emergencyMonths(age, ageR) {
    if (ageR - age <= 10) return 12; // within 10 years of stopping work, or already stopped
    if (age >= 50) return 9;
    if (age >= 40) return 6;
    return 3;
  }

  /* amortizeYear(): applies one year of interest and one year's payment to a
     single debt.
       - Interest accrues on the current balance at the debt's APR.
       - The payment is applied after interest, never taking the balance
         below zero.
       - If the yearly payment doesn't even cover a year's interest (common
         with minimum-payment credit cards), the balance actually GROWS —
         we flag that as `exploded: true` so the calling code can raise a
         "this card is not amortizing" warning instead of silently letting
         the debt balloon in the background. */
  function amortizeYear(debt) {
    const bal = Math.max(0, debt.balance);
    const r = Math.max(0, debt.rate);
    const pay = Math.max(0, debt.payment);
    if (bal <= 0) return { pay: 0, end: 0, exploded: false };
    const interest = bal * r;
    if (pay <= interest + 1e-9 && r > 0) {
      return { pay: pay, end: bal + interest - pay, exploded: true };
    }
    return { pay: Math.min(pay, bal + interest), end: Math.max(0, bal + interest - pay), exploded: false };
  }

  /* kidBill(): for a single child and a single year offset `t` from today,
     works out which of that child's cost "windows" are currently open:
       - living costs, while younger than their independence age
       - tuition, only between their tuition start/end ages
       - post-independence help, only between independence and "help stops"
       - payback (money they send you), only once independent
     `g` is the general-inflation growth factor already computed for year t,
     so every dollar figure the child has is grown consistently with the
     rest of the household's general (non-lifestyle, non-health, non-housing)
     costs. */
  function kidBill(k, t, g) {
    const kAge = k.age + t;
    let living = 0, tuition = 0, after = 0, payback = 0;
    if (kAge < k.indep) living = (k.cost || 0) * g;
    if (kAge >= (k.tStart || 99) && kAge < (k.tEnd || 0)) tuition = (k.tuition || 0) * g;
    if (kAge >= k.indep && kAge < (k.helpUntil || 0)) after = (k.afterHelp || 0) * g;
    if (kAge >= k.indep) payback = (k.payback || 0) * g;
    return { living, tuition, after, payback, total: living + tuition + after, kAge };
  }

  /* bracketTax(): standard progressive ("marginal rate") tax calculation.
     `brackets` is an ascending list of [bandUpperBound, rateOnThatBand]
     pairs. Income is taxed in slices: the first slice up to the first
     band's upper bound at that band's rate, the next slice up to the next
     band's bound at the next rate, and so on — exactly like a real
     progressive tax system, just with simplified bands (see COUNTRIES
     above). This returns the total tax owed in dollars; the calling code
     turns that into an *average* rate by dividing by income where needed. */
  function bracketTax(income, brackets) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of brackets) {
      if (income <= lower) break;
      const slice = Math.min(income, upper) - lower;
      if (slice > 0) tax += slice * rate;
      lower = upper;
      if (income <= upper) break;
    }
    return tax;
  }

  /* ===========================================================================
     5. TABLE RENDERERS (kids / debts / gifts editable rows)
     =========================================================================== */

  /* renderKids/renderDebts/renderGifts turn the current arrays in section 3
     into a table body of editable <input> cells. Each cell carries
     data-* attributes (which row index, which field) so a single delegated
     event listener in bindTables() below can figure out which array entry
     to update, rather than attaching one listener per cell. */

  function renderKids() {
    if (!has("kidsBody")) return;
    const progOptions = Object.keys(EDU_PROGRAMS).map((k) => `<option>${k}</option>`).join("");
    $("kidsBody").innerHTML = kids.map((k, i) => `<tr>
      <td><input data-k="${i}" data-f="name" value="${esc(k.name)}"></td>
      <td><input type="number" data-k="${i}" data-f="age" value="${k.age}"></td>
      <td><input type="number" data-k="${i}" data-f="indep" value="${k.indep}"></td>
      <td><input type="number" data-k="${i}" data-f="cost" value="${k.cost}"></td>
      <td><select data-k="${i}" data-f="program">${progOptions}</select></td>
      <td><input type="number" data-k="${i}" data-f="tuition" value="${k.tuition}"></td>
      <td><input type="number" data-k="${i}" data-f="tStart" value="${k.tStart}"></td>
      <td><input type="number" data-k="${i}" data-f="tEnd" value="${k.tEnd}"></td>
      <td><input type="number" data-k="${i}" data-f="afterHelp" value="${k.afterHelp}"></td>
      <td><input type="number" data-k="${i}" data-f="helpUntil" value="${k.helpUntil}"></td>
      <td><input type="number" data-k="${i}" data-f="payback" value="${k.payback}"></td>
      <td><button type="button" class="ghost" data-delk="${i}">×</button></td>
    </tr>`).join("");
    // Reflect each row's currently-stored program in its dropdown (can't be
    // done via the <option selected> attribute above since it's shared
    // markup for every row).
    kids.forEach((k, i) => {
      const s = $("kidsBody").querySelector(`select[data-k="${i}"][data-f="program"]`);
      if (s && k.program) s.value = k.program;
    });
  }

  function renderDebts() {
    if (!has("debtBody")) return;
    $("debtBody").innerHTML = debts.map((d, i) => `<tr>
      <td><input data-d="${i}" data-f="name" value="${esc(d.name)}"></td>
      <td><select data-d="${i}" data-f="type">${DEBT_TYPES.map((t) => `<option${t === d.type ? " selected" : ""}>${t}</option>`).join("")}</select></td>
      <td><input type="number" data-d="${i}" data-f="balance" value="${d.balance}"></td>
      <td><input type="number" step="0.001" data-d="${i}" data-f="rate" value="${d.rate}"></td>
      <td><input type="number" data-d="${i}" data-f="payment" value="${d.payment}"></td>
      <td><button type="button" class="ghost" data-deld="${i}">×</button></td>
    </tr>`).join("");
  }

  function renderGifts() {
    if (!has("giftBody")) return;
    $("giftBody").innerHTML = gifts.map((gft, i) => `<tr>
      <td><input data-g="${i}" data-f="name" value="${esc(gft.name)}"></td>
      <td><input type="number" data-g="${i}" data-f="ageAt" value="${gft.ageAt}"></td>
      <td><input type="number" data-g="${i}" data-f="amount" value="${gft.amount}"></td>
      <td><button type="button" class="ghost" data-delg="${i}">×</button></td>
    </tr>`).join("");
  }

  function renderPets() {
    if (!has("petsBody")) return;
    $("petsBody").innerHTML = pets.map((p, i) => `<tr>
      <td><input data-p="${i}" data-f="name" value="${esc(p.name)}"></td>
      <td><input type="number" data-p="${i}" data-f="cost" value="${p.cost}"></td>
      <td><input type="number" data-p="${i}" data-f="vet" value="${p.vet}"></td>
      <td><input type="number" data-p="${i}" data-f="untilAge" value="${p.untilAge}"></td>
      <td><button type="button" class="ghost" data-delp="${i}">×</button></td>
    </tr>`).join("");
  }

  /* bindTables(): one delegated "input" listener and one delegated "click"
     listener per table body. Delegation (listening on the parent <tbody>
     rather than each <input>/<button>) means newly-added rows automatically
     work without needing to re-attach listeners after every render. */
  function bindTables() {
    if (has("kidsBody")) {
      $("kidsBody").addEventListener("input", (e) => {
        const i = e.target.getAttribute("data-k");
        const f = e.target.getAttribute("data-f");
        if (i == null) return;
        if (f === "program") return; // handled by the "change" listener below, with a tuition/date auto-fill
        kids[+i][f] = f === "name" ? e.target.value : parseFloat(e.target.value) || 0;
      });
      // Separate "change" listener for the program <select>: picking a
      // preset fills that row's tuition and tuition-end age (tuition
      // starts from whatever "tStart" already has, or 18 if it's empty),
      // then re-renders so the person can see and further edit the
      // numbers the preset just loaded — it's a starting point, not a
      // locked-in answer.
      $("kidsBody").addEventListener("change", (e) => {
        const i = e.target.getAttribute("data-k");
        const f = e.target.getAttribute("data-f");
        if (i == null || f !== "program") return;
        const preset = EDU_PROGRAMS[e.target.value];
        kids[+i].program = e.target.value;
        if (preset) {
          const start = kids[+i].tStart || 18;
          kids[+i].tuition = preset.tuition;
          kids[+i].tStart = start;
          kids[+i].tEnd = start + preset.years;
        }
        renderKids();
      });
      $("kidsBody").addEventListener("click", (e) => {
        const i = e.target.getAttribute("data-delk");
        if (i == null) return;
        kids.splice(+i, 1);
        renderKids();
      });
    }
    if (has("debtBody")) {
      $("debtBody").addEventListener("input", (e) => {
        const i = e.target.getAttribute("data-d");
        const f = e.target.getAttribute("data-f");
        if (i == null) return;
        debts[+i][f] = f === "name" || f === "type" ? e.target.value : parseFloat(e.target.value) || 0;
      });
      $("debtBody").addEventListener("click", (e) => {
        const i = e.target.getAttribute("data-deld");
        if (i == null) return;
        debts.splice(+i, 1);
        renderDebts();
      });
    }
    if (has("giftBody")) {
      $("giftBody").addEventListener("input", (e) => {
        const i = e.target.getAttribute("data-g");
        const f = e.target.getAttribute("data-f");
        if (i == null) return;
        gifts[+i][f] = f === "name" ? e.target.value : parseFloat(e.target.value) || 0;
      });
      $("giftBody").addEventListener("click", (e) => {
        const i = e.target.getAttribute("data-delg");
        if (i == null) return;
        gifts.splice(+i, 1);
        renderGifts();
      });
    }
    if (has("petsBody")) {
      $("petsBody").addEventListener("input", (e) => {
        const i = e.target.getAttribute("data-p");
        const f = e.target.getAttribute("data-f");
        if (i == null) return;
        pets[+i][f] = f === "name" ? e.target.value : parseFloat(e.target.value) || 0;
      });
      $("petsBody").addEventListener("click", (e) => {
        const i = e.target.getAttribute("data-delp");
        if (i == null) return;
        pets.splice(+i, 1);
        renderPets();
      });
    }
  }

  /* ===========================================================================
     6. COUNTRY / PROFESSION / CITY "APPLY" FUNCTIONS
     =========================================================================== */

  /* countryApply(): runs whenever the "Country" dropdown changes. It loads
     that country's default currency and inflation rates into the relevant
     inputs (which remain fully editable afterward — this only sets a
     starting point) and refreshes the informational notes underneath
     (public-pension replacement-rate note, contribution-room note, and the
     account-section explanation of that country's clawback/surcharge
     rules, if any). */
  function countryApply() {
    const p = COUNTRIES[$("country").value];
    if (!p) return;
    if (has("ccy")) $("ccy").value = p.ccy;
    if (has("infG")) $("infG").value = p.infG;
    if (has("infH")) $("infH").value = p.infH;
    if (has("infHouse")) $("infHouse").value = p.infHouse;
    setText("replNote", "OECD-style net mandatory replacement for an average full-career earner: " + pct(p.repl) + ". Type your real public pension instead of using this shortcut.");
    if (has("acctNote")) {
      $("acctNote").innerHTML = `<div class="acct-note"><b>${$("country").value}</b> — ${p.roomNote}${p.oas ? " OAS-style clawback modeled above " + fmt(p.oas.threshold, p.ccy) + " of household taxable income." : ""}${p.irmaa ? " IRMAA-style healthcare surcharge modeled above " + fmt(p.irmaa.threshold, p.ccy) + "." : ""}</div>`;
    }
    if (has("acctGrid")) {
      $("acctGrid").innerHTML = `<div><label>Stylized annual tax-sheltered room (household, 2 people)</label><input readonly value="${fmt(p.room * 2, p.ccy)}"></div>`;
    }
    updateRoomNote();
  }

  /* updateRoomNote(): compares the person's *intended* yearly contributions
     (their own + partner's) against the country's stylized combined
     tax-sheltered room, and writes a plain-English note about whether they
     fit inside it. This runs both when the country changes and whenever the
     contribution amounts themselves change. */
  function updateRoomNote() {
    if (!has("roomNote")) return;
    const p = COUNTRIES[sel("country", "Canada")];
    if (!p) return;
    const save = num("save", 0), pSave = num("pSave", 0);
    const total = save + pSave;
    const cap = p.room * 2;
    if (cap <= 0) {
      setText("roomNote", "No stylized tax-sheltered room loaded for this country — treat all contributions as taxable-account savings.");
    } else if (total > cap) {
      setText("roomNote", "Intended contributions (" + fmt(total, $("ccy") ? $("ccy").value : p.ccy) + ") exceed the stylized household room (" + fmt(cap, p.ccy) + "). The excess is treated as taxable-account savings, not tax-sheltered.");
    } else {
      setText("roomNote", "Intended contributions fit inside the stylized household tax-sheltered room (" + fmt(cap, p.ccy) + ").");
    }
  }

  /* professionApply(): runs whenever the "Profession" dropdown changes.
     Loads that profession's typical cost-of-living multiplier and hazard
     curve (h0/k/aStar/cap/out) into the inputs, then repaints the hazard
     preview text so the person can immediately see what risk they've just
     loaded before they decide whether to edit it. */
  function professionApply() {
    const p = PROFESSIONS[$("profession").value];
    if (!p) return;
    if (has("colMult")) $("colMult").value = p.col;
    if (has("h0")) $("h0").value = p.h0;
    if (has("hk")) $("hk").value = p.k;
    if (has("aStar")) $("aStar").value = p.aStar;
    if (has("hCap")) $("hCap").value = p.cap;
    if (has("outFrac")) $("outFrac").value = p.out;
    setText("profNote", p.note + " Hazard at current age and at 55/60 is computed live below.");
    paintHazardPreview();
  }

  /* paintHazardPreview(): shows the person their current job-loss hazard
     "now", and projected at 55 and 60, in plain percentages — a sanity
     check they can read at a glance without doing the exponential math in
     their head. Re-runs live as they edit any of the underlying hazard
     inputs. */
  function paintHazardPreview() {
    const age = num("ageNow", 49);
    const h0 = num("h0", 0.03);
    const k = num("hk", 0.12);
    const aStar = num("aStar", 52);
    const cap = num("hCap", 0.28);
    const now = hazard(age, h0, k, aStar, cap);
    const h55 = hazard(55, h0, k, aStar, cap);
    const h60 = hazard(60, h0, k, aStar, cap);
    setText("hazPrev",
      "Annual displacement hazard (planning): now " + pct(now) +
      " · age 55 " + pct(h55) +
      " · age 60 " + pct(h60) +
      " — exponential in (age − kink), capped. Expected income lost ≈ hazard × months-out/12.");
  }

  /* cityApply(): runs whenever the "City band" dropdown changes. Just
     explains, in plain text, what the chosen multiplier does and doesn't
     touch (see the CITY_BANDS comment above for why housing/health are
     excluded). */
  function cityApply() {
    const mult = CITY_BANDS[sel("city", "Typical metro")] || 1;
    setText("cityNote", "City multiplier " + mult.toFixed(2) + "× applied to core living and discretionary spending on top of the profession COL multiplier. Housing and healthcare carry your own typed numbers — they should already reflect this city.");
  }

  /* buildGuidance(): turns the flags/verdict this run produced into an
     ordered, plain-English "what to do next" list. Ordered roughly by
     urgency/impact: an invalid age setup first (nothing else can be
     trusted until that's fixed), then a pre-retirement funding hole and a
     non-amortizing debt (usually the most fixable, most urgent problems),
     then base-case depletion, then the age-hazard warning, then the
     smaller structural flags, then a stress-only failure, then — if
     nothing above applies — a maintenance note for a plan that currently
     passes both the base case and the stress test. */
  function buildGuidance(flags, broke, preBroke, brokeS, survOn, ageR, overSaving, noGlidePath, extraWeekly, ccy, emergShort, recommendedEmergFund, emergFund, highDisc, discRatio, eduNotRegistered, sheltersNotUsed) {
    const g = [];
    if (flags.badAgeOrder) {
      g.push("Fix your ages first (section 1): your current age, stop-work age and plan-to age must be in strictly increasing order. No other number in this report can be trusted until that's corrected.");
      return g;
    }
    if (flags.ccExplode) g.push("Highest priority: at least one credit card's yearly payment doesn't even cover its interest, so that balance is growing, not shrinking (section 8). Increase its payment, consolidate it onto a lower rate, or pay it off before optimizing anything else in this plan.");
    if (preBroke) g.push("The household draws down savings before both of you have stopped working (age " + preBroke.age + "). This is usually fixable: check debt payments, kid/eldercare costs and the job-loss/disability settings in the years leading up to your stop-work age, and consider delaying that age or increasing savings now.");
    if (broke) g.push("Base case runs out of money at age " + broke.age + ". The usual levers, roughly in order of impact: delay when you stop working by a year or two; pay off high-APR debt faster; re-check that your typed core/discretionary spending actually matches your bank and card statements; and reconsider whether a high-cost-of-living lifestyle is realistic on your planned income." + (extraWeekly > 0 ? (" As a rough planning anchor only (not the plan's real engine — the year-by-year simulation is): closing this gap through savings alone would take roughly an extra " + fmt(extraWeekly, ccy) + "/week from now until your stop-work age, assuming it's invested at your stated accumulation return.") : ""));
    else if (brokeS) g.push("Base case is funded, but the stress test (a worse first-decade of investment returns plus faster healthcare inflation) runs out at age " + brokeS.age + ". Consider holding 1–2 years of expenses in cash-like assets specifically for your first decade of retirement, to reduce this sequence-of-returns risk.");
    if (emergShort) g.push("Your emergency fund (" + fmt(emergFund, ccy) + ", section 11) is below the age-based target for someone your age (≈" + fmt(recommendedEmergFund, ccy) + "). Build this before investing further, or before aggressively paying down low-APR debt — it's what stops a car/house repair or a job gap from becoming a forced sale of investments or a new high-APR debt.");
    if (highDisc) g.push("Discretionary spending is currently " + pct(discRatio) + " of your income (section 13). Before assuming this has to stay fixed for 30+ years, do a once- or twice-a-year audit of recurring subscriptions and memberships specifically — see the worked example in the Guide tab's \"Investing basics,\" under \"How to actually make this succeed.\"");
    if (flags.lateHazard) g.push("Your profession's job-loss hazard is already ≥12% a year before your stated stop-work age (section 2). Don't assume you'll work exactly to your target age — build a larger cash buffer, keep a marketable/consulting option open, or consider moving your stop-work age earlier while you still have negotiating leverage.");
    if (flags.mortgageIntoRetire) g.push("Your mortgage is still being paid after you stop working (section 8). Either plan an extra-principal payoff schedule before then, or make sure the ongoing payment is fully counted in your withdrawal plan (it already is, in this report — this is a flag to double check it's intentional).");
    if (flags.kidsOverlapRetire) g.push("At least one child still costs money after both of you have stopped working (section 4). Check whether tuition or after-help end-ages are realistic, and make sure this cost is deliberately budgeted rather than assumed away.");
    if (flags.eduExhausted) g.push("Your education savings account runs out before tuition is fully covered (section 4) — the remainder is already counted as hitting cashflow in this report. Consider increasing education-pot contributions now if you'd rather it not compete with other retirement spending.");
    if (flags.eldercareIntoRetire) g.push("Eldercare support continues after both of you have stopped working (section 5). If you have siblings or other family, confirm whether this cost is meant to be shared, and adjust the amount if so.");
    if (flags.partnerGap) g.push("When one partner stops working first (section 3), household costs only fall to your entered \"stay-factor\" — most of the fixed cost of the household remains. Make sure the still-working partner's timeline and savings rate account for this, rather than assuming costs halve.");
    if (survOn) g.push("A survivor scenario is modeled (section 3) — check the year-by-year table (section 15) around the assumed death age to see whether the surviving partner's accounts still hold up, and whether life insurance (section 9) should be sized to bridge the pension gap.");
    if (flags.overRoom) g.push("Your intended yearly contributions exceed the stylized tax-sheltered room for your country (section 11). The excess is treated as ordinary taxable savings in this report — consider spreading contributions over more years, or planning explicitly for a taxable-account tax drag.");
    if (eduNotRegistered) g.push("You've entered tuition costs but aren't using a registered education plan (section 4). Many countries add free money on top of what you contribute — for example, Canada's RESP is matched at 20% by the government up to an annual limit. Even if your own country's version is smaller, it's usually worth checking before saving for tuition in an ordinary account.");
    if (sheltersNotUsed) g.push("Your savings (section 11) aren't going into a tax-sheltered account. Over decades, the difference between tax-deferred/tax-free growth and an ordinary taxable account compounds into a real amount of money — this is usually one of the easiest, lowest-effort improvements available to a plan like this one.");
    if (noGlidePath) g.push("Retirement is within 10 years and your accumulation and drawdown return assumptions (section 11) are nearly identical — worth a real conversation (with a licensed advisor, not this tool) about gradually shifting toward steadier, income-producing assets and holding a real cash buffer as you approach your stop-work age. See the Guide tab's \"Investing basics\" for the general idea and worked examples.");
    if (overSaving) g.push("Your plan-to-age balance looks like far more than this plan actually needs — more than 15 years of that year's spending, still sitting unused. That's not a problem to fix, but it is worth a deliberate decision: consider retiring a little earlier, increasing spending on health and experiences now while you can enjoy them, or confirming this is an intentional inheritance/legacy goal rather than an accident of over-caution. Being needlessly frugal for 30 years is its own kind of cost.");
    if (!g.length) g.push("Your current inputs pass both the base case and the stress test with no structural flags. Re-run this whenever something material changes — a new job, a new child, a mortgage payoff, an insurance renewal, or a big move — since this is a living plan, not a one-time answer.");
    return g;
  }

  /* buildRoadmap(): the year-by-year table (section 15) is complete but
     dense — every year, whether or not anything actually changed. Most
     people can't act on 40+ identical-looking rows. This instead scans the
     simulated years for the handful that actually matter: a five-year
     checkpoint for a general sense of trajectory, and any year something
     concrete changes (tuition starting/ending, a debt paid off, a modeled
     shock beginning or ending, a survivor event, a home sale, long-term
     care starting, or the money running out). Each checkpoint gets one or
     two plain, achievable notes — never a countdown to a number nobody can
     actually feel day to day. */
  function buildRoadmap(rows, ctx) {
    const { ccy, ageR, homeOn, homeAge, ltcOn, ltcAge } = ctx;
    const out = [];
    let prev = null;
    rows.forEach((r) => {
      const notes = [];
      if (r.t > 0 && r.t % 5 === 0) {
        const emergTarget = ((r.core + r.house + r.health) / 12) * emergencyMonths(r.age, ageR);
        const range = !r.youWork && !r.pWork ? " (worst ≈ " + fmt(r.portStress, ccy) + " · best ≈ " + fmt(r.portBest, ccy) + ")" : "";
        notes.push("Checkpoint: projected accounts ≈ " + fmt(r.port, ccy) + range + ". If your real balance is well below this, the fix is usually a small, steady increase in savings now rather than a big change later — the earlier a correction happens, the smaller it needs to be. Age-based emergency fund target around now: ≈" + fmt(emergTarget, ccy) + ".");
      }
      if (r.age === ageR) {
        notes.push("This is your planned stop-work age. In the year or two before it: confirm pension start dates, drop insurance you won't need once you've stopped earning (e.g. disability insurance), and double check the debt/tuition/eldercare items above are actually finishing on the schedule you assumed.");
      }
      if (prev && Math.abs(r.kidNet - prev.kidNet) > 2000) {
        notes.push(r.kidNet > prev.kidNet
          ? "A child's costs just rose by about " + fmt(r.kidNet - prev.kidNet, ccy) + "/yr (tuition or after-help starting) — already counted in this plan, but worth re-checking your cash buffer around this age."
          : "A child's costs just dropped by about " + fmt(prev.kidNet - r.kidNet, ccy) + "/yr (tuition or help ending) — consider redirecting that amount straight into savings before it quietly becomes lifestyle spending.");
      }
      if (prev && prev.debtPay > 0 && r.debtPay === 0) {
        notes.push("A debt looks fully paid off by this age. Redirecting its old payment amount straight into savings, even for a few years, meaningfully strengthens the rest of this plan.");
      }
      if (prev && !prev.shockHit && r.shockHit) notes.push("Modeled job-loss shock begins this year (a deliberate stress test, not a prediction).");
      if (prev && prev.shockHit && !r.shockHit) notes.push("Modeled job-loss shock ends this year — if this really happened, rebuilding your cash buffer is the priority before anything else.");
      if (prev && !prev.disHit && r.disHit) notes.push("Modeled disability/reduced-hours period begins this year.");
      if (prev && prev.disHit && !r.disHit) notes.push("Modeled disability/reduced-hours period ends this year.");
      if (prev && !prev.widowed && r.widowed) notes.push("Survivor scenario: this is the age your plan assumes one partner has passed away. Worth checking, in the year-by-year table, whether the survivor's accounts hold up — and whether the life insurance in section 9 is actually sized to bridge the pension gap.");
      if (homeOn && r.age === homeAge) notes.push("Planned home sale/downsize this year.");
      if (ltcOn && r.age === ltcAge) notes.push("Planned long-term-care period begins this year — this is usually the single largest and least predictable cost in the whole plan; revisit the LTC cost figure against real local facility rates a few years before this age.");
      if (r.port <= 0 && !(prev && prev.port <= 0) && !r.youWork && !r.pWork) notes.push("⚠ Base-case accounts reach zero this year.");
      if (r.portStress <= 0 && !(prev && prev.portStress <= 0) && !r.youWork && !r.pWork) notes.push("⚠ Stress-case accounts reach zero this year.");
      if (notes.length) out.push({ age: r.age, notes });
      prev = r;
    });
    return out;
  }

  /* collectPlanRecord(): walks every module in the "Plan" tab and pulls out
     a plain "label → current value" line for each input, plus a compact
     readable line per row of the kids/debts/gifts/pets tables. This is what
     lets the printed report show EVERY input that produced the result,
     section by section, without a second hard-coded list that could drift
     out of sync with the form — it reads the same DOM the person just
     filled in. Result/Year-by-year sections are skipped since those are
     outputs, not inputs. */
  function collectPlanRecord() {
    const sections = Array.from(document.querySelectorAll("#panelPlan > section.module"));
    let html = "";
    sections.forEach((sec) => {
      if (sec.id === "report") return;
      const h2 = sec.querySelector("h2");
      if (!h2) return;
      const heading = h2.textContent;
      if (/^(0|14|15|16)\./.test(heading)) return; // intro / result / year-by-year / roadmap are not "inputs"

      const rows = [];
      sec.querySelectorAll(".grid").forEach((grid) => {
        Array.from(grid.children).forEach((div) => {
          const lbl = div.querySelector("label");
          const ctrl = div.querySelector("input,select,textarea");
          if (!lbl || !ctrl) return;
          const val = ctrl.tagName === "SELECT" && ctrl.selectedIndex >= 0
            ? ctrl.options[ctrl.selectedIndex].text
            : ctrl.value;
          rows.push(`<tr><td>${esc(lbl.textContent)}</td><td>${esc(String(val))}</td></tr>`);
        });
      });

      let rowLines = "";
      const tbody = sec.querySelector("tbody[id]");
      if (tbody) {
        if (tbody.id === "kidsBody") {
          rowLines = kids.map((k) => `${esc(k.name)} — now ${k.age}, independent at ${k.indep}; living $${k.cost}/yr; education: ${esc(k.program || "custom")}, $${k.tuition}/yr, ages ${k.tStart}–${k.tEnd}; after-help $${k.afterHelp}/yr until ${k.helpUntil}; pays you back $${k.payback}/yr.`).join("<br>");
        } else if (tbody.id === "debtBody") {
          rowLines = debts.map((d) => `${esc(d.name)} (${d.type}) — balance $${d.balance}, APR ${pct(d.rate)}, payment $${d.payment}/yr.`).join("<br>");
        } else if (tbody.id === "giftBody") {
          rowLines = gifts.map((gft) => `${esc(gft.name)} — $${gft.amount} at your age ${gft.ageAt}.`).join("<br>");
        } else if (tbody.id === "petsBody") {
          rowLines = pets.map((p) => `${esc(p.name)} — $${p.cost}/yr + vet $${p.vet}/yr, until your age ${p.untilAge}.`).join("<br>");
        }
        if (!rowLines) rowLines = "<i>None entered.</i>";
      }

      if (!rows.length && !rowLines) return;
      html += `<div class="report-section"><h4>${esc(heading)}</h4>`;
      if (rows.length) html += `<table class="report-table"><tbody>${rows.join("")}</tbody></table>`;
      if (rowLines) html += `<p class="report-rows">${rowLines}</p>`;
      html += `</div>`;
    });
    return html;
  }

  /* buildBalanceChart(): a small, dependency-free SVG line chart plotting
     the base-case and stress-case account balance against age, with a
     dashed marker at the stop-work age. No chart library is used —
     RetireCompass has no network access by design, so every chart here is
     plain inline SVG built from the same `rows` the year-by-year table
     uses, which also means it's guaranteed to always agree with that
     table. */
  function buildBalanceChart(rows, ageR, ccy) {
    const W = 760, H = 260, padL = 64, padR = 16, padT = 22, padB = 30;
    const ages = rows.map((r) => r.age);
    const minAge = ages[0], maxAge = ages[ages.length - 1];
    const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.port, r.portStress, r.portBest)));
    const xScale = (a) => padL + ((a - minAge) / Math.max(1, maxAge - minAge)) * (W - padL - padR);
    const yScale = (v) => padT + (1 - v / maxVal) * (H - padT - padB);
    const pathFor = (key) => rows.map((r, i) => (i === 0 ? "M" : "L") + xScale(r.age).toFixed(1) + "," + yScale(r[key]).toFixed(1)).join(" ");

    // Compact axis labels with the real currency symbol (e.g. $1.2M, £850K,
    // ₹1.2Cr) so long amounts — up to billions — never overflow the left margin.
    const fmtK = (v) => {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency", currency: ccy === "XXX" ? "USD" : ccy,
          notation: "compact", maximumFractionDigits: 1,
        }).format(v);
      } catch (e) {
        return String(Math.round(v));
      }
    };
    let grid = "";
    for (let p = 0; p <= 4; p++) {
      const v = (maxVal * p) / 4;
      const y = yScale(v);
      grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>` +
              `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="var(--muted)">${fmtK(v)}</text>`;
    }
    let xlabels = "";
    const range = maxAge - minAge;
    const step = range > 60 ? 10 : range > 30 ? 5 : 2;
    for (let a = minAge; a <= maxAge; a += step) {
      const x = xScale(a);
      xlabels += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="2,2"/>` +
                 `<text x="${x.toFixed(1)}" y="${H - padB + 14}" font-size="10" text-anchor="middle" fill="var(--muted)">${a}</text>`;
    }
    const retX = xScale(Math.max(minAge, Math.min(maxAge, ageR)));

    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Account balance over time — worst case, base case, and best case">
        ${grid}${xlabels}
        <line x1="${retX.toFixed(1)}" y1="${padT}" x2="${retX.toFixed(1)}" y2="${H - padB}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4,3"/>
        <text x="${Math.max(padL, Math.min(W - padR, retX)).toFixed(1)}" y="${padT - 8}" font-size="11" text-anchor="${retX > W - 70 ? "end" : retX < padL + 30 ? "start" : "middle"}" fill="var(--gold)">Stop work</text>
        <path d="${pathFor("portBest")}" fill="none" stroke="var(--ok)" stroke-width="2" stroke-dasharray="1,3"/>
        <path d="${pathFor("port")}" fill="none" stroke="var(--teal)" stroke-width="2.4"/>
        <path d="${pathFor("portStress")}" fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5,3"/>
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1"/>
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1"/>
      </svg>
      <div class="chart-legend">
        <span><i style="background:var(--ok)"></i>Best case (better returns + slower healthcare inflation)</span>
        <span><i style="background:var(--teal)"></i>Base case</span>
        <span><i style="background:var(--warn)"></i>Worst case (worse first-decade returns + faster healthcare inflation)</span>
      </div>`;
  }

  /* buildMixBars(): the stop-work-year expense mix as horizontal bars
     (relative width = relative size) instead of a bare number table — the
     same underlying numbers as the old table, just faster to actually
     read at a glance. */
  function buildMixBars(atRet, ccy) {
    const items = [
      ["Kids, net", atRet.kidNet],
      ["Pets", atRet.petCost],
      ["Eldercare", atRet.parentCost],
      ["Debt service", atRet.debtPay],
      ["Housing carry", atRet.house],
      ["Healthcare", atRet.health],
      ["Work income (expected, after hazard)", atRet.workGross],
      ["Public + DB + partner public + passive", atRet.fixed],
      ["Tax that year", atRet.taxPaid]
    ];
    const max = Math.max(1, ...items.map((i) => i[1]));
    return items.map(([label, val]) => `<div class="bar-row">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(val > 0 ? 1.5 : 0, (val / max) * 100).toFixed(1)}%"></div></div>
        <span class="bar-val">${fmt(val, ccy)}</span>
      </div>`).join("");
  }

  /* ===========================================================================
     7. THE MAIN ENGINE — run()
     ===========================================================================
     This is the heart of the tool. It:
       (a) reads every input on the page into a local, readable variable,
       (b) simulates the household one year at a time from today's age to
           the "plan-to" age, recomputing every cost/income/tax/withdrawal
           for that specific year, and
       (c) writes the results back into the KPI boxes, the flags list, the
           expense-mix table, the year-by-year table and the plain-English
           report at the bottom of the page.

     The section numbers in the comments below (// --- 1. ... ---) match the
     module numbers in index.html, so it's easy to find which part of the
     form a given block of code is reading. */
  function run() {
    // --- 1. Household, city, currency ---
    const country = $("country").value;
    const cinfo = COUNTRIES[country] || COUNTRIES["Custom / Other"];
    const ccy = (has("ccy") && $("ccy").value) || cinfo.ccy;
    const cityMult = CITY_BANDS[sel("city", "Typical metro")] || 1;

    const age0 = num("ageNow", 49);
    const ageR = num("ageRet", 65);
    const ageE = num("ageEnd", 95);
    const lifeInf = num("lifeInf", 0.05);
    const cityExtra = num("cityExtra", 0.01);
    const needRule = sel("needRule", "spend");

    // Currency conversion: everything the person types under "spending"
    // (core living, housing, health, kids, etc.) is assumed to be typed in
    // the "spend currency" if one is given (e.g. retiring somewhere that
    // uses a different currency from where the accounts are held); the
    // portfolio itself always stays in the account currency. fx0 is today's
    // rate (spend-currency units per 1 account-currency unit) and fxDrift
    // lets that rate drift over time (positive = the spend currency
    // strengthens, so fewer of it are needed per account-currency unit).
    const spendCcy = (sel("spendCcy", "") || "").trim();
    const fx0 = num("fx", 1) || 1;
    const fxDrift = num("fxDrift", 0);
    const useFx = spendCcy.length > 0;

    // --- 2. Profession: pay, cost-of-living, job-loss/disability hazard ---
    const youInc = num("youInc", 110000);
    const colMult = num("colMult", 1);
    const wageReal = num("wageReal", 0.005);
    const h0 = num("h0", 0.03);
    const hk = num("hk", 0.12);
    const aStar = num("aStar", 52);
    const hCap = num("hCap", 0.28);
    const outFrac = num("outFrac", 0.4);
    const shockOn = sel("shockOn", "NO") === "YES";
    const shockAge = num("shockAge", 58);
    const shockYrs = num("shockYrs", 2);
    const disOn = sel("disOn", "NO") === "YES";
    const disAge = num("disAge", 57);
    const disYrs = num("disYrs", 3);
    const disFactor = num("disFactor", 0.4);

    // --- 3. Partner + survivor path ---
    const partnerOn = sel("partnerOn", "NO") === "YES";
    const pAge0 = num("pAge", age0);
    const pRet = num("pRet", 65);
    const pInc = num("pInc", 0);
    const pPub = num("pPub", 0);
    const pPubAge = num("pPubAge", 65);
    const pColStay = num("pColStay", 0.85);
    const survOn0 = sel("survOn", "NO") === "YES";
    // Survivor path only means anything if there's actually a partner to
    // lose (or to be lost by) — if "Partner?" is NO, this entire module is
    // inert regardless of what's left in its fields, so nothing about a
    // solo household's numbers can be affected by stale survivor inputs.
    const survOn = survOn0 && partnerOn;
    const survWho = sel("survWho", "partner");
    const survAge = num("survAge", 999);
    const survPen = num("survPen", 0.6);
    const survCol = num("survCol", 0.75);

    // --- 5. Eldercare ---
    const parOn = sel("parOn", "NO") === "YES";
    const parAge0 = num("parAge", 76);
    const parCost = num("parCost", 0);
    const parUntil = num("parUntil", 92);

    // --- 8. Upskilling ---
    const upskill = num("upskill", 0);
    const upskillUntil = num("upskillUntil", ageR);

    // --- 9. Insurance ---
    const lifePrem = num("lifePrem", 0);
    const lifeUntil = num("lifeUntil", 70);
    const diPrem = num("diPrem", 0);
    const diUntil = num("diUntil", ageR);
    const diBen = num("diBen", 0);
    const ciPrem = num("ciPrem", 0);
    const ciUntil = num("ciUntil", ageR);

    // --- 10. Home sale / downsize ---
    const homeOn = sel("homeOn", "NO") === "YES";
    const homeAge = num("homeAge", 72);
    const homeNet = num("homeNet", 0);
    const homeCarryDelta = num("homeCarryDelta", 0);

    // --- 4. Kids + education pot ---
    const eduPot0 = num("eduPot", 0);
    const eduRet = num("eduRet", 0.04);
    const eduRegistered = sel("eduRegistered", "NO") === "YES";

    // --- 10. Accounts ---
    const nest = num("nest", 0);
    const emergFund = num("emergFund", 0);
    const save = num("save", 0);
    const pSave = num("pSave", 0);
    const usingShelter = sel("usingShelter", "YES") === "YES";

    // --- 11. Accounts ---
    const retAcc0 = num("retAcc", 0.065);
    const retRet0 = num("retRet", 0.05);
    const mer = num("mer", 0.005);
    const passive = num("passive", 0);

    // --- 12. Tax ---
    const taxMode = sel("taxMode", "brackets");
    const taxFlat = num("taxFlat", 0.10);
    const clawOn = sel("clawOn", "YES") === "YES";

    // --- 13. Everyday living, pensions, LTC ---
    const core = num("core", 0) * colMult * cityMult;
    const workOnly = num("workOnly", 0);
    const house = num("house", 0);
    const health = num("health", 0);
    const disc = num("disc", 0) * colMult * cityMult;
    const fadeAge = num("fadeAge", 80);
    const fade = num("fade", 0.6);
    const capex = num("capex", 0);
    const infG = num("infG", cinfo.infG);
    const infH = num("infH", cinfo.infH);
    const infHouse = num("infHouse", cinfo.infHouse);
    const pub = num("pub", 0);
    const pubAge = num("pubAge", 65);
    const db = num("db", 0);
    const dbAge = num("dbAge", pubAge);
    const other = num("other", 0);
    const ltcOn = sel("ltcOn", "NO") === "YES";
    const ltcAge = num("ltcAge", 88);
    const ltcYrs = num("ltcYrs", 3);
    const ltcCost = num("ltcCost", 0);
    const hair = num("hair", 0.03);   // stress test: extra return cut in the first decade of retirement
    const hcAdd = num("hcAdd", 0.02); // stress test: extra healthcare inflation on top of infH

    // --- Simulation setup ---
    const years = Math.max(1, ageE - age0);
    // Work on a *copy* of the debts array so repeated Calculate clicks don't
    // permanently amortize the person's actual entered balances — the
    // editable table should always reflect what they typed, not last run's
    // ending balance.
    const debtState = debts.map((d) => ({ ...d, balance: Math.max(0, d.balance) }));
    let eduPotBal = eduPot0;

    const rows = [];               // one entry per simulated year, for the year-by-year table
    let port = nest;                // base-case account balance, rolled forward year by year
    let portStress = nest;          // stress-case account balance (worse returns + faster healthcare inflation)
    let portBest = nest;            // best-case account balance (better returns + slower healthcare inflation) — the same magnitude of swing as the stress case, in the opposite direction
    let anchorSalaryNeed = null;    // see "needRule === 'salary'" below

    // Flags are collected as the simulation runs, then turned into the
    // colored "flag" pills under the Result section. Each one represents a
    // structural risk the base numbers alone might not make obvious.
    const flags = {
      ccExplode: false, kidsOverlapRetire: false, mortgageIntoRetire: false,
      parentsStillPay: false, partnerGap: false, lateHazard: false,
      eduExhausted: false, eldercareIntoRetire: false, overRoom: false,
      badAgeOrder: (ageE <= ageR) || (ageR <= age0)
    };

    // Invalid ages make every other number in this tool meaningless — a
    // portfolio can appear to grow from a later age to an earlier one,
    // depletion ages stop meaning anything, and so on. Rather than compute
    // and display that nonsense next to a small warning easy to miss while
    // skimming results, stop here entirely: blank every result, show only
    // the error, and wait for the ages to be fixed.
    if (flags.badAgeOrder) {
      const v = $("verdict");
      if (v) { v.className = "verdict bad"; v.textContent = "Check your ages — current age, stop-work age and plan-to age must be strictly increasing (e.g. 45 → 65 → 95). No results are calculated until this is fixed."; }
      ["kpiNeed", "kpiNeed100", "kpiNest", "kpiEnd", "kpiBroke", "kpiTax", "kpiEmerg"].forEach((id) => setText(id, "—"));
      if (has("flags")) $("flags").innerHTML = `<span class="flag red">Age order is invalid — fix current/stop-work/plan-to ages (section 1) before anything else here can be trusted.</span>`;
      if (has("balanceChart")) $("balanceChart").innerHTML = "";
      if (has("mixBars")) $("mixBars").innerHTML = "";
      if (has("yearBody")) $("yearBody").innerHTML = "";
      if (has("roadmap")) $("roadmap").innerHTML = "";
      if (has("report")) $("report").innerHTML = `<p class="lead">Fix the age order in section 1 (current age &lt; stop-work age &lt; plan-to age) and click Calculate again — no report is generated from invalid ages.</p>`;
      return;
    }

    // -------------------------------------------------------------------
    // YEAR-BY-YEAR SIMULATION
    // For every year from today (t=0) to the plan-to age, work out exactly
    // what the household earns, owes, spends and either saves or withdraws.
    // -------------------------------------------------------------------
    for (let t = 0; t <= years; t++) {
      const age = age0 + t;
      const pAge = pAge0 + t;

      // Is each partner still alive this year, given the survivor-path
      // setting? (If survivor modeling is off, both are always "alive" for
      // the purposes of this calculation — we're not otherwise modeling
      // mortality.)
      const aliveYou = !(survOn && survWho === "you" && age >= survAge);
      const alivePartner = !partnerOn || !(survOn && survWho === "partner" && pAge >= survAge);
      const justWidowedYou = survOn && survWho === "partner" && pAge === survAge;
      const justWidowedPartner = survOn && survWho === "you" && age === survAge;
      const widowed = survOn && ((survWho === "partner" && !alivePartner) || (survWho === "you" && !aliveYou));

      const youWork = aliveYou && age < ageR;
      const pWork = partnerOn && alivePartner && pAge < pRet;

      // Growth factors for this year, each compounding from today (t=0):
      //   g       — general CPI: salaries, pensions, kids, parents, gifts, debt
      //   gLife   — "lifestyle inflation" + city-specific extra inflation:
      //             applied only to core living + discretionary spending,
      //             because these tend to creep faster than official CPI
      //   gh/ghs  — healthcare inflation (base case / stress case)
      //   ghouse  — housing-carry inflation
      const g = Math.pow(1 + infG, t);
      const gLife = Math.pow(1 + lifeInf + cityExtra, t);
      const gh = Math.pow(1 + infH, t);
      const ghs = Math.pow(1 + infH + hcAdd, t);
      const ghouse = Math.pow(1 + infHouse, t);

      // FX: convert this year's "need" (typed in spend currency, if any)
      // into the account currency the portfolio actually lives in.
      const fxT = useFx ? fx0 / Math.pow(1 + fxDrift, t) : 1;
      const toAcct = useFx ? 1 / fxT : 1;

      // --- Kids (section 4) ---
      let kidLiving = 0, kidTuitionRaw = 0, kidAfter = 0, kidPayback = 0;
      kids.forEach((k) => {
        const b = kidBill(k, t, g);
        kidLiving += b.living;
        kidTuitionRaw += b.tuition;
        kidAfter += b.after;
        kidPayback += b.payback;
        if (b.total > 0 && !youWork && !pWork) flags.kidsOverlapRetire = true;
        if (b.after > 0) flags.parentsStillPay = true;
      });
      // Tuition is paid from the education pot first; anything the pot
      // can't cover falls through to household cashflow. The pot itself
      // grows at its own return rate on whatever's left after this year's
      // draw.
      const tuitionFromPot = Math.min(kidTuitionRaw, Math.max(0, eduPotBal));
      const tuitionCash = kidTuitionRaw - tuitionFromPot;
      eduPotBal = Math.max(0, eduPotBal - tuitionFromPot) * (1 + eduRet);
      if (kidTuitionRaw > 0 && tuitionCash > 0) flags.eduExhausted = true;
      const kidNet = kidLiving + tuitionCash + kidAfter - kidPayback;

      // --- Debt (section 8) ---
      let debtPay = 0;
      debtState.forEach((d) => {
        const step = amortizeYear(d);
        debtPay += step.pay;
        d.balance = step.end;
        if (d.type === "Credit card" && step.exploded) flags.ccExplode = true;
        if (d.type === "Mortgage" && !youWork && step.pay > 0) flags.mortgageIntoRetire = true;
      });

      // --- Eldercare (section 5) ---
      const parentAge = parAge0 + t;
      // Eldercare is treated as a healthcare-like cost — it tends to track
      // healthcare inflation more closely than general CPI.
      const parentCost = parOn && parentAge < parUntil ? parCost * gh : 0;
      if (parentCost > 0 && !youWork && !pWork) flags.eldercareIntoRetire = true;

      // --- One-off gifts (section 6) ---
      // Each gift fires exactly once, in the year the person's age matches
      // the gift's target age, inflated from today's dollars to that year.
      let giftHit = 0;
      gifts.forEach((gft) => {
        if (gft.ageAt === age) giftHit += (gft.amount || 0) * Math.pow(1 + infG, gft.ageAt - age0 >= 0 ? t : 0);
      });

      // --- Pets (section 7) ---
      // Food/grooming/insurance plus a routine-and-unplanned vet-cost line,
      // per pet, running until the age the person expects that cost to end
      // (i.e. roughly the pet's expected lifespan). Grown at general CPI —
      // vet care inflates faster than that in reality, but there isn't a
      // dedicated "vet inflation" input, so this is a deliberate
      // simplification rather than a missing feature.
      let petCost = 0;
      pets.forEach((p) => {
        if (age < (p.untilAge || 0)) petCost += ((p.cost || 0) + (p.vet || 0)) * g;
      });

      // --- Upskilling + insurance (sections 7 & 8) ---
      const upskillCost = (youWork && age <= upskillUntil) ? upskill * g : 0;
      const lifeCost = age < lifeUntil ? lifePrem * g : 0;
      const diCost = age < diUntil ? diPrem * g : 0;
      const ciCost = age < ciUntil ? ciPrem * g : 0;

      // --- Job-loss / shock / disability hazard on YOUR working income ---
      // The partner gets a flatter default hazard (60% of yours, kink one
      // year later) unless the person edits it directly — this is just a
      // sane starting assumption, not a claim about any specific couple.
      const hYou = youWork ? hazard(age, h0, hk, aStar, hCap) : 0;
      const hPart = pWork ? hazard(pAge, h0 * 0.6, hk * 0.85, aStar + 1, hCap) : 0;
      if (youWork && hYou >= 0.12) flags.lateHazard = true;

      const shockHit = shockOn && youWork && age >= shockAge && age < shockAge + shockYrs;
      const disHit = disOn && youWork && age >= disAge && age < disAge + disYrs;

      // Expected-value income haircut: `hazard × outFrac` approximates
      // "the fraction of a full year's pay you'd expect to lose, averaged
      // over the chance it happens and how long you'd likely be out."  A
      // deterministic shock (shockOn) simply zeroes income for its window
      // instead of just haircutting it — it's a "this definitely happens"
      // scenario rather than a probability-weighted one. A disability hit
      // caps your pay at the disability pay-factor if that's lower than
      // what the ordinary hazard haircut would leave you with.
      let youEarnFactor = shockHit ? 0 : 1 - hYou * outFrac;
      if (disHit) youEarnFactor = Math.min(youEarnFactor, disFactor);
      const pEarnFactor = 1 - hPart * outFrac;

      const youEarn = youWork ? youInc * g * Math.pow(1 + wageReal, t) * youEarnFactor : 0;
      const pEarn = pWork ? pInc * g * Math.pow(1 + wageReal, t) * pEarnFactor : 0;

      // Disability insurance pays out only while the disability shock is
      // active AND the policy hasn't already lapsed by age.
      const diIncome = disHit && age < diUntil ? diBen * g : 0;

      // --- Pensions, with survivor keep-factors once widowed ---
      let incPub = age >= pubAge ? pub * g : 0;
      let incDb = age >= dbAge ? db * g : 0;
      let incPPub = partnerOn && pAge >= pPubAge ? pPub * g : 0;
      if (widowed) {
        // Once one partner has passed away, the survivor keeps only a
        // fraction of *that person's* pensions (their own pensions are
        // untouched).
        if (survWho === "you") { incPub *= survPen; incDb *= survPen; }
        if (survWho === "partner") { incPPub *= survPen; }
      }
      const incOth = (!youWork || !pWork) ? other * g : 0;
      const incPassive = passive * g;

      const fixedGross = incPub + incDb + incPPub + incOth + incPassive + diIncome;
      const workGross = youEarn + pEarn;
      const totalIncome = fixedGross + workGross;

      // --- Tax (section 11) ---
      // "brackets" mode computes a progressive tax on total household
      // income for the year using this country's stylized bands, expressed
      // as an *average* effective rate (total tax ÷ total income), then
      // adds the flat "add-on" rate on top (representing something like a
      // state/provincial tax layered on top of a federal-style band table).
      // "flat" mode skips the bracket calculation entirely and just uses
      // the flat rate as the whole tax rate. Either way we cap the result
      // at 65% as a sanity ceiling.
      let effRate;
      if (taxMode === "flat") {
        effRate = taxFlat;
      } else {
        const bt = bracketTax(totalIncome, cinfo.brackets);
        effRate = totalIncome > 0 ? (bt / totalIncome) + taxFlat : taxFlat;
      }
      effRate = Math.min(0.65, Math.max(0, effRate));

      // OAS-style clawback (Canada): above an inflated income threshold,
      // public pension income is reduced by a clawback rate on the amount
      // over that threshold (never below zero).
      if (clawOn && cinfo.oas && incPub > 0) {
        const over = Math.max(0, totalIncome - cinfo.oas.threshold * g);
        incPub = Math.max(0, incPub - over * cinfo.oas.rate);
      }
      // IRMAA-style healthcare surcharge (US): once income crosses a
      // threshold, a healthcare surcharge is added; each further multiple
      // of that threshold crossed adds another surcharge "step."
      let irmaaAdd = 0;
      if (clawOn && cinfo.irmaa && totalIncome > cinfo.irmaa.threshold * g) {
        const steps = Math.floor((totalIncome - cinfo.irmaa.threshold * g) / (cinfo.irmaa.step * g)) + 1;
        irmaaAdd = cinfo.irmaa.surcharge * steps * g;
      }

      const fixed = incPub + incDb + incPPub + incOth + incPassive + diIncome;

      // --- Household lifestyle cost-of-living factor ---
      // The household's *lifestyle* spending doesn't fall to zero just
      // because one income stops — most fixed costs of "the house" remain.
      // colStay models that: 1.0 while both work, the "stay factor" input
      // when only one works or neither does, and further reduced to the
      // survivor's own keep-factor once widowed. This entire mechanism is
      // about a TWO-EARNER household losing one earner — it must not fire
      // for a single/no-partner household, which never had a second income
      // to lose in the first place (that was a real bug in an earlier
      // version: "oneWork" below was true for a solo working person too,
      // silently discounting their living costs for no reason).
      let colStay = 1;
      if (partnerOn) {
        const bothWork = youWork && pWork;
        const oneWork = (youWork && !pWork) || (!youWork && pWork);
        colStay = bothWork ? 1 : oneWork ? pColStay : Math.min(pColStay, 0.9);
        if (widowed) colStay = Math.min(colStay, survCol);
        if (oneWork && !justWidowedYou && !justWidowedPartner) flags.partnerGap = true;
      }

      const discNow = disc * gLife * (age >= fadeAge ? fade : 1) * colStay;
      const coreNow = core * gLife * colStay;
      // "Work-only" costs (commuting, work clothes, lunches out) exist only
      // because someone in the household is still working — they should
      // stop the moment both of you have stopped, not linger forever as a
      // typed number nobody ever removes. Grown at general inflation, not
      // lifestyle inflation, since it's a mechanical cost rather than a
      // lifestyle-creep one. (This input existed on the form but was never
      // wired into the calculation in an earlier version — that silent gap
      // is exactly the kind of bug this audit was for.)
      const workOnlyNow = (youWork || pWork) ? workOnly * g : 0;
      const houseCarryDelta = homeOn && age >= homeAge ? homeCarryDelta : 0;
      const houseNow = Math.max(0, house + houseCarryDelta) * ghouse;
      const healthNow = health * gh + irmaaAdd;
      const healthNowS = health * ghs + irmaaAdd;
      // Best case mirrors the stress case in the opposite direction: the
      // same "hcAdd" magnitude as a healthcare-inflation reduction instead
      // of an increase (floored at zero — inflation doesn't usefully go
      // negative for this purpose), reusing the existing stress-test inputs
      // rather than asking for a whole second set of "optimistic" numbers.
      const ghBest = Math.pow(1 + Math.max(0, infH - hcAdd), t);
      const healthNowBest = health * ghBest + irmaaAdd;
      const ltc = ltcOn && age >= ltcAge && age < ltcAge + ltcYrs ? ltcCost * gh : 0;
      const ltcS = ltcOn && age >= ltcAge && age < ltcAge + ltcYrs ? ltcCost * ghs : 0;
      const ltcBest = ltcOn && age >= ltcAge && age < ltcAge + ltcYrs ? ltcCost * ghBest : 0;

      // "bucketsNeed" is the sum of every specific, typed cost category —
      // this is the literal, itemized answer to "what does this household's
      // life cost this year".
      const bucketsNeed = coreNow + houseNow + healthNow + discNow + capex * g + kidNet
        + debtPay + ltc + parentCost + giftHit + petCost + upskillCost + lifeCost + diCost + ciCost + workOnlyNow;
      const bucketsNeedS = coreNow + houseNow + healthNowS + discNow + capex * g + kidNet
        + debtPay + ltcS + parentCost + giftHit + petCost + upskillCost + lifeCost + diCost + ciCost + workOnlyNow;
      const bucketsNeedBest = coreNow + houseNow + healthNowBest + discNow + capex * g + kidNet
        + debtPay + ltcBest + parentCost + giftHit + petCost + upskillCost + lifeCost + diCost + ciCost + workOnlyNow;

      // "Salary path" need: an alternative way of estimating what a
      // household needs, based on the idea that people tend to just keep
      // spending near what they're used to living on. We freeze the LAST
      // working year's net-of-savings household income (today's-dollar
      // terms) as an "anchor," then grow that anchor by lifestyle inflation
      // for every year after — whether the person is still working or not.
      // Anchoring only updates while at least one partner is still working;
      // once both have stopped, whatever anchor was last set keeps being
      // grown forward.
      const plannedSaveRaw = (youWork ? save : 0) + (pWork ? pSave : 0);
      if (youWork || pWork) {
        const netNow = totalIncome * (1 - effRate) - plannedSaveRaw * g;
        anchorSalaryNeed = Math.max(0, netNow) / gLife; // store in "today" terms, regrow below
      }
      const salaryNeed = anchorSalaryNeed == null ? bucketsNeed : anchorSalaryNeed * gLife;

      // The "needRule" dropdown (section 1) picks which of these two
      // estimates — or the larger of the two — actually drives the
      // withdrawal math below.
      let need = bucketsNeed, needS = bucketsNeedS, needBest = bucketsNeedBest;
      if (needRule === "salary") { need = salaryNeed; needS = salaryNeed; needBest = salaryNeed; }
      else if (needRule === "max") { need = Math.max(bucketsNeed, salaryNeed); needS = Math.max(bucketsNeedS, salaryNeed); needBest = Math.max(bucketsNeedBest, salaryNeed); }

      const needAcct = need * toAcct;
      const needAcctS = needS * toAcct;
      const needAcctBest = needBest * toAcct;

      const netFixed = fixed * (1 - effRate);
      const netWork = workGross * (1 - effRate);

      // Planned savings also get haircut by the same job-loss/disability
      // earn-factor as income itself — you can't fully fund your intended
      // contribution in a year your pay was effectively cut.
      const plannedSave = (youWork ? save : 0) * Math.pow(1 + infG + wageReal, t) * youEarnFactor
        + (pWork ? pSave : 0) * Math.pow(1 + infG + wageReal, t) * pEarnFactor;

      // --- Contribute or withdraw? (base case) ---
      // While working: if after-tax income covers the need with room to
      // spare, contribute up to the planned savings amount (or whatever's
      // left over, if less than planned); if income falls short of the
      // need, the shortfall becomes a withdrawal, grossed up by (1 - tax
      // rate) so the withdrawal covers both the shortfall AND the tax on
      // withdrawing it.
      // Once retired: the entire need beyond fixed income becomes a
      // grossed-up withdrawal.
      let contrib = 0, draw = 0, taxPaid = 0;
      const residual = netWork + netFixed - needAcct;
      if (youWork || pWork) {
        if (residual >= plannedSave) contrib = plannedSave;
        else if (residual > 0) contrib = residual;
        else draw = (-residual) / Math.max(0.05, 1 - effRate);
      } else {
        const gap = needAcct - netFixed;
        draw = gap <= 0 ? 0 : gap / Math.max(0.05, 1 - effRate);
      }
      taxPaid = 0; // computed below, once the draw is capped to what's actually available

      // --- Same logic again, but for the stress-tested need (needAcctS) ---
      let contribS = 0, drawS = 0;
      const residualS = netWork + netFixed - needAcctS;
      if (youWork || pWork) {
        if (residualS >= plannedSave) contribS = plannedSave;
        else if (residualS > 0) contribS = residualS;
        else drawS = (-residualS) / Math.max(0.05, 1 - effRate);
      } else {
        const gapS = needAcctS - netFixed;
        drawS = gapS <= 0 ? 0 : gapS / Math.max(0.05, 1 - effRate);
      }

      // --- And once more for the best-case need (needAcctBest) ---
      let contribBest = 0, drawBest = 0;
      const residualBest = netWork + netFixed - needAcctBest;
      if (youWork || pWork) {
        if (residualBest >= plannedSave) contribBest = plannedSave;
        else if (residualBest > 0) contribBest = residualBest;
        else drawBest = (-residualBest) / Math.max(0.05, 1 - effRate);
      } else {
        const gapBest = needAcctBest - netFixed;
        drawBest = gapBest <= 0 ? 0 : gapBest / Math.max(0.05, 1 - effRate);
      }

      // --- Investment growth (base case vs. stress case vs. best case) ---
      // While either partner still works, we assume the "accumulation"
      // return rate; once both have stopped, the more conservative
      // "drawdown" return rate. The stress case additionally cuts returns
      // further for the first 10 years of retirement (a "bad first
      // decade" scenario — the single biggest real-world risk to a
      // withdrawal plan, known as sequence-of-returns risk); the best case
      // mirrors that same cut in the opposite direction, for the same
      // first 10 years, as an equally-plausible "things go right instead"
      // scenario. Fees (MER) are subtracted from all three — fees don't
      // care whether markets were kind that decade.
      const r = (youWork || pWork) ? (retAcc0 - mer) : (retRet0 - mer);
      const yearsIntoRet = age - Math.min(ageR, partnerOn ? pRet : ageR);
      const rS = (youWork || pWork) ? (retAcc0 - mer) : (yearsIntoRet < 10 ? (retRet0 - mer - hair) : (retRet0 - mer));
      const rBest = (youWork || pWork) ? (retAcc0 - mer) : (yearsIntoRet < 10 ? (retRet0 - mer + hair) : (retRet0 - mer));

      // --- Home sale lump sum (section 9) ---
      const homeLump = homeOn && age === homeAge ? homeNet * ghouse : 0;

      // --- Cap each draw at what the account can actually supply ---
      // "draw" above is the THEORETICAL grossed-up withdrawal that would be
      // needed to fully cover this year's need — it is not automatically
      // limited by whether the account actually holds that much. Once an
      // account is exhausted, the uncapped number keeps climbing forever
      // (it's tracking an ever-growing unmet shortfall, not real cash
      // leaving a real account). Left uncapped, that phantom number
      // corrupted every downstream reconstruction that assumed "draw" was
      // real money taken from a real balance — including the "accounts at
      // stop-work" KPI, which could show a large positive figure years
      // after the account had actually hit zero. Capping here makes "draw"
      // mean what it says: money that actually came out of the account
      // this year. "shortfall" tracks whatever the capped draw couldn't
      // cover, so a plan that's already broken says so honestly instead of
      // reporting an ever-larger number as if it were still being funded.
      const availBase = Math.max(0, port);
      const availS = Math.max(0, portStress);
      const availBest = Math.max(0, portBest);
      const actualDraw = Math.min(draw, availBase);
      const actualDrawS = Math.min(drawS, availS);
      const actualDrawBest = Math.min(drawBest, availBest);
      const shortfall = draw - actualDraw;
      const shortfallS = drawS - actualDrawS;
      const shortfallBest = drawBest - actualDrawBest;
      taxPaid = (workGross + fixed) * effRate + actualDraw * effRate;

      // --- Roll the portfolio forward one year, in all three scenarios ---
      port = Math.max(0, (port - actualDraw) * (1 + r) + contrib + homeLump);
      portStress = Math.max(0, (portStress - actualDrawS) * (1 + rS) + contribS + homeLump);
      portBest = Math.max(0, (portBest - actualDrawBest) * (1 + rBest) + contribBest + homeLump);

      rows.push({
        t, age, youWork, pWork, need: needAcct, needS: needAcctS, needBest: needAcctBest, kidNet, petCost, parentCost, debtPay,
        taxPaid, health: healthNow, house: houseNow, core: coreNow, draw: actualDraw, drawS: actualDrawS, drawBest: actualDrawBest,
        shortfall, shortfallS, shortfallBest, contrib, port, portStress, portBest,
        fixed, workGross, hYou, shockHit, disHit, eduPotBal, widowed
      });
    }

    /* ---------------------------------------------------------------------
       RESULTS: KPIs, verdict, flags, expense mix, year-by-year table, report
       --------------------------------------------------------------------- */

    const atRet = rows.find((r) => r.age === ageR) || rows[0];
    // "Accounts at stop-work" should mean exactly that — the real balance
    // the moment you stop working, i.e. the ending balance of the LAST
    // working year. Reconstructing it as "this year's ending balance plus
    // this year's draw" (the previous approach) quietly broke the moment a
    // plan ran out of money before retirement even started: once an
    // account has been at zero for years, "draw" no longer represents real
    // money coming out of a real balance (see the draw-capping fix above),
    // so adding it back invented a number that could look healthy years
    // after the account was actually empty — exactly the kind of
    // contradiction between the summary card, the chart and the
    // year-by-year table that erodes trust in the whole tool. Reading the
    // prior year's real ending balance instead is always correct, whether
    // the plan is thriving or already broken.
    const priorRet = rows.find((r) => r.age === ageR - 1) || atRet;
    const stopWorkPort = priorRet.port, stopWorkPortS = priorRet.portStress, stopWorkPortBest = priorRet.portBest;
    const atEnd = rows.find((r) => r.age === ageE) || rows[rows.length - 1];
    const bothDone = (r) => !r.youWork && !r.pWork;
    // "broke" = the first year, after both partners have stopped working,
    // that the base-case portfolio hits zero.
    const broke = rows.find((r) => bothDone(r) && r.port <= 0);
    // Total money the plan needed but genuinely couldn't supply, across the
    // whole simulation — the honest number behind a "broke" verdict. Once
    // an account is empty, the household's real-world need doesn't stop
    // existing; this is what's left unfunded.
    const totalShortfall = rows.reduce((sum, r) => sum + (r.shortfall || 0), 0);
    // "brokeS" = the same, but for the stress-tested portfolio.
    const brokeS = rows.find((r) => bothDone(r) && r.portStress <= 0);
    // "brokeBest" = same, for the best-case portfolio — included for
    // symmetry; this essentially never fires unless the plan is already
    // broken even under favorable conditions, which is itself worth
    // knowing.
    const brokeBest = rows.find((r) => bothDone(r) && r.portBest <= 0);
    // "preBroke" = a portfolio hitting zero WHILE someone is still working —
    // this is a much bigger red flag than running out after retirement,
    // because it usually means the household needed to borrow or draw down
    // savings even before their planned stop-work date.
    const preBroke = rows.find((r) => (r.youWork || r.pWork) && r.port <= 0 && r.draw > 0);
    const drawPct = stopWorkPort > 0 ? atRet.draw / stopWorkPort : 0;

    // --- Balance check: are we telling this household to over-save? ---
    // A tool with no product to sell has no reason to only warn about
    // shortfalls. If the base case is fully funded AND the plan-to-age
    // balance is still many, many years' worth of spending, that's just as
    // worth flagging as a shortfall — it may mean room to retire earlier,
    // spend more on health/experiences now, or that some of this is an
    // intentional inheritance/legacy goal (which is fine, but worth being a
    // deliberate choice rather than an accident of over-caution).
    const overSaving = !flags.badAgeOrder && !broke && !preBroke && atEnd.need > 0 && atEnd.port > 15 * atEnd.need;

    // --- Investing safety as retirement approaches ---
    // If retirement is within 10 years and the person hasn't modeled a
    // materially safer drawdown return than their accumulation return, flag
    // it — this usually means the glide-path conversation (shifting toward
    // bonds/dividends/cash) hasn't happened yet, not that their numbers are
    // wrong. See the Guide tab's "Investing basics" for the full context.
    const yearsToRet = ageR - age0;
    const approachingRetire = yearsToRet > 0 && yearsToRet <= 10;
    const noGlidePath = approachingRetire && (retRet0 >= retAcc0 - 0.005);

    // --- Emergency fund: is it big enough for the person's current age? ---
    const row0 = rows[0];
    const recommendedEmergFund = row0 ? ((row0.core + row0.house + row0.health) / 12) * emergencyMonths(age0, ageR) : 0;
    const emergShort = recommendedEmergFund > 0 && emergFund < recommendedEmergFund * 0.9;
    updateEmergNote();

    // --- Recurring/discretionary spending: worth a subscription audit? ---
    const discRatio = (youInc + pInc) > 0 ? (num("disc", 0)) / (youInc + pInc) : 0;
    const highDisc = discRatio > 0.15;

    // --- Turning "$/year" into something a person actually budgets against ---
    const totalIntendedSave = save + pSave;
    const saveWeekly = totalIntendedSave / 52;
    const saveMonthly = totalIntendedSave / 12;

    // A rough, clearly-labeled planning anchor for "how much more per week
    // would close the gap": use a simple 4%-of-need reference point for the
    // nest egg a fully-funded stop-work year would want, compare that to
    // the actual projected accounts at that age, and spread the difference
    // across the working years left using a standard future-value-of-a-
    // series calculation at the person's own stated accumulation return.
    // This is intentionally a rough anchor, not the plan's real engine —
    // the real engine is the year-by-year simulation above.
    let extraWeekly = 0;
    if ((broke || preBroke) && yearsToRet > 0) {
      const roughTargetNest = atRet.need / 0.04;
      const shortfallAtRet = Math.max(0, roughTargetNest - stopWorkPort);
      const rr = Math.max(0.001, retAcc0 - mer);
      const fvFactor = (Math.pow(1 + rr, yearsToRet) - 1) / rr;
      const extraAnnual = fvFactor > 0 ? shortfallAtRet / fvFactor : 0;
      extraWeekly = extraAnnual / 52;
    }

    setText("kpiNeed", fmt(atRet.need, ccy));
    setText("kpiNeed100", fmt(atEnd.need, ccy));
    // Keep the KPI label honest even if the person changes the plan-to age
    // away from the default of 100.
    if ($("kpiNeed100") && $("kpiNeed100").previousElementSibling) {
      $("kpiNeed100").previousElementSibling.textContent = "What you'll need per year, at age " + ageE;
    }
    setText("kpiNest", fmt(stopWorkPort, ccy) + " (worst " + fmt(stopWorkPortS, ccy) + " · best " + fmt(stopWorkPortBest, ccy) + ")");
    setText("kpiEnd", fmt(atEnd.port, ccy) + " (worst " + fmt(atEnd.portStress, ccy) + " · best " + fmt(atEnd.portBest, ccy) + ")");
    // "Money runs out" should always report the single, honest, earliest
    // age the account actually hit zero — whether that happens before or
    // after retirement — not prioritize the post-retirement check over an
    // earlier pre-retirement one just because of which variable happened
    // to be checked first. Reporting a later age when an earlier one is
    // real is exactly the kind of contradiction that erodes trust in the
    // rest of the numbers.
    const trueBroke = rows.find((r) => r.port <= 0 && (r.draw > 0 || r.need > 0));
    setText("kpiBroke", trueBroke ? (trueBroke.youWork || trueBroke.pWork ? "Pre-retire hole @ " + trueBroke.age : String(trueBroke.age)) : "Still funded");
    setText("kpiTax", fmt(atRet.taxPaid, ccy));
    setText("kpiEmerg", fmt(recommendedEmergFund, ccy) + (recommendedEmergFund > 0 ? " (" + emergencyMonths(age0, ageR) + " mo.)" : ""));

    // The verdict is deliberately written in plain language and prioritizes
    // the most actionable/urgent finding: invalid ages first (nothing else
    // can be trusted until that's fixed), then a pre-retirement funding
    // hole (usually the most fixable/urgent), then base-case depletion,
    // then a stress-only failure (survives the base case but not a bad
    // decade), then a clean pass.
    let verdictCls = "ok";
    let verdict = "Base case funds the plan-to age. Read the flags below before you believe it.";
    if (flags.badAgeOrder) {
      verdictCls = "bad";
      verdict = "Check your ages — stop-work age and plan-to age must be strictly after your current age, in that order.";
    } else if (preBroke && !broke) {
      verdictCls = "warn";
      verdict = "The household draws the portfolio before both people have retired (age " + preBroke.age + ") — usually kids + debt + a job-loss haircut, not a market problem.";
    }
    if (!flags.badAgeOrder && broke) {
      verdictCls = "bad";
      verdict = "Base case depletes at age " + broke.age + ". Usual levers: delay, cut parent-paid kid lines, kill high-APR debt, or do not spend a high-COL lifestyle on a lower-COL income.";
    } else if (!flags.badAgeOrder && !preBroke && brokeS) {
      verdictCls = "warn";
      verdict = "Base survives; stress (bad first decade + faster healthcare inflation) breaks at age " + brokeS.age + ".";
    }
    const v = $("verdict");
    if (v) { v.className = "verdict " + verdictCls; v.textContent = verdict; }

    updateRoomNote();
    if (has("roomNote") && $("roomNote").textContent.indexOf("exceed") > -1) flags.overRoom = true;

    // Turn every tripped flag into a colored pill. Red = urgent/structural
    // problem, amber = worth knowing but not necessarily broken, green =
    // "nothing structurally flagged" (shown only when the list is empty).
    const fl = [];
    if (flags.badAgeOrder) fl.push({ c: "red", t: "Age order is invalid — fix current/stop-work/plan-to ages before trusting any other number here." });
    if (flags.ccExplode) fl.push({ c: "red", t: "Credit card is not amortizing — payment ≤ interest." });
    if (flags.kidsOverlapRetire) fl.push({ c: "amber", t: "A child still costs money after both adults have stopped working." });
    if (flags.parentsStillPay) fl.push({ c: "amber", t: "Parents-still-pay is on: tuition and/or post-independence help is in the cashflow." });
    if (flags.eduExhausted) fl.push({ c: "amber", t: "Education pot runs out before tuition is fully covered — the rest hits cashflow." });
    if (kids.length && kids.some((k) => k.tuition > 0) && !eduRegistered) fl.push({ c: "amber", t: "Tuition is expected but you're not using a registered education plan — many countries match contributions with free grant money (see \"What to do next\")." });
    if (flags.mortgageIntoRetire) fl.push({ c: "amber", t: "Mortgage continues after you retire." });
    if (flags.eldercareIntoRetire) fl.push({ c: "amber", t: "Eldercare cost continues after both adults have stopped working." });
    if (flags.lateHazard) fl.push({ c: "red", t: "Your profession hazard is already ≥12% a year before the stated retirement age. That is not a 6.5% return problem." });
    if (flags.partnerGap) fl.push({ c: "amber", t: "Partner stops first; household COL only falls to the stay-factor — one income gone, most of the house remains." });
    if (shockOn) fl.push({ c: "red", t: "Deterministic job-loss shock is ON at age " + shockAge + " for " + shockYrs + " year(s)." });
    if (disOn) fl.push({ c: "amber", t: "Disability / hours-cut shock is ON at age " + disAge + " for " + disYrs + " year(s), pay factor " + pct(disFactor) + "." });
    if (survOn) fl.push({ c: "amber", t: "Survivor path modeled: " + survWho + " dies at age " + survAge + "; pension keep-factor " + pct(survPen) + ", COL keep-factor " + pct(survCol) + "." });
    if (flags.overRoom) fl.push({ c: "amber", t: "Intended contributions exceed the stylized tax-sheltered room for " + country + " — excess is taxable-account savings." });
    if (!usingShelter && (save + pSave) > 0) fl.push({ c: "amber", t: "Your savings aren't going into a tax-sheltered account — you're likely paying more tax on growth than you need to." });
    if (debts.some((d) => d.type === "Credit card" && d.rate >= 0.15 && d.balance > 0))
      fl.push({ c: "red", t: "Unsecured debt ≥15% APR is a negative-return asset." });
    if (overSaving) fl.push({ c: "green", t: "You appear to be saving well beyond what this plan needs — see \"What to do next\" for what that might mean." });
    if (totalShortfall > 0) fl.push({ c: "red", t: "Once the accounts run out, this plan is short " + fmt(totalShortfall, ccy) + " in total, across every remaining year — that gap doesn't disappear, it has to come from somewhere else (working longer, family support, or a lower standard of living)." });
    if (noGlidePath) fl.push({ c: "amber", t: "Retirement is within 10 years and your drawdown return assumption isn't meaningfully safer than your accumulation return — see \"Investing basics\" in the Guide tab." });
    if (emergShort) fl.push({ c: "amber", t: "Emergency fund (" + fmt(emergFund, ccy) + ") is below the age-based target (≈" + fmt(recommendedEmergFund, ccy) + ") — see \"What to do next\"." });
    if (highDisc) fl.push({ c: "amber", t: "Discretionary spending is a large share of income (" + pct(discRatio) + ") — a recurring-subscription audit is likely to find real money here." });
    if (!fl.length) fl.push({ c: "green", t: "No structural flags on the current inputs." });
    if (has("flags")) $("flags").innerHTML = fl.map((f) => `<span class="flag ${f.c}">${f.t}</span>`).join(" ");

    // Charts: account balance over time (base vs. stress) and the
    // stop-work-year expense mix as bars. Built once, reused verbatim in
    // the printed report below so the two never disagree.
    const balanceChartHtml = buildBalanceChart(rows, ageR, ccy);
    const mixBarsHtml = buildMixBars(atRet, ccy);
    if (has("balanceChart")) $("balanceChart").innerHTML = balanceChartHtml;
    if (has("mixBars")) $("mixBars").innerHTML = mixBarsHtml;

    // Full year-by-year table — the "show your work" section. Every number
    // elsewhere on the page can be traced back to a row here.
    if (has("yearBody")) {
      $("yearBody").innerHTML = rows.map((r) => `<tr>
        <td>${r.age}</td>
        <td>${r.widowed ? "Widowed" : r.youWork && r.pWork ? "Both work" : r.youWork ? "You work" : r.pWork ? "Partner works" : "Retired"}${r.shockHit ? " · SHOCK" : ""}${r.disHit ? " · DISABLED" : ""}</td>
        <td>${Math.round(r.need).toLocaleString()}</td>
        <td>${Math.round(r.kidNet).toLocaleString()}</td>
        <td>${Math.round(r.petCost).toLocaleString()}</td>
        <td>${Math.round(r.parentCost).toLocaleString()}</td>
        <td>${Math.round(r.debtPay).toLocaleString()}</td>
        <td>${Math.round(r.taxPaid).toLocaleString()}</td>
        <td>${Math.round(r.draw).toLocaleString()}</td>
        <td>${Math.round(r.port).toLocaleString()}</td>
        <td>${Math.round(r.eduPotBal).toLocaleString()}</td>
      </tr>`).join("");
    }

    // Roadmap (section 16): the same checkpoint logic feeds both the
    // on-page roadmap panel and the printed report, so they never drift
    // apart from each other.
    const roadmap = buildRoadmap(rows, { ccy, ageR, homeOn, homeAge, ltcOn, ltcAge });
    const roadmapHtml = roadmap.length
      ? roadmap.map((c) => `<div class="roadmap-item"><b>Age ${c.age}</b><ul>${c.notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>`).join("")
      : "<p class=\"lead\">No specific checkpoints on the current inputs — calculate to build your roadmap.</p>";
    if (has("roadmap")) $("roadmap").innerHTML = roadmapHtml;

    // Comprehensive, self-contained report: verdict, guidance, KPI recap,
    // flags, and then a full section-by-section record of every input that
    // produced this result — meant to be readable on its own, on paper,
    // without needing the tool open next to it.
    if (has("report")) {
      const now = new Date();
      const eduNotRegistered = kids.length > 0 && kids.some((k) => k.tuition > 0) && !eduRegistered;
      const sheltersNotUsed = !usingShelter && (save + pSave) > 0;
      const guidance = buildGuidance(flags, broke, preBroke, brokeS, survOn, ageR, overSaving, noGlidePath, extraWeekly, ccy, emergShort, recommendedEmergFund, emergFund, highDisc, discRatio, eduNotRegistered, sheltersNotUsed);
      const householdLabel = (has("label") && $("label").value) || "Household";
      $("report").innerHTML = `
        <h3>Summary report — ${esc(householdLabel)}</h3>
        <p>${country} (${ccy}) · ${$("profession") ? $("profession").value : ""} · ${sel("city", "")}
           · age ${age0} → you stop work ${ageR}${partnerOn ? " · partner stops " + pRet : ""} → plan to ${ageE}</p>
        <p class="verdict ${flags.badAgeOrder ? "bad" : broke ? "bad" : (preBroke || brokeS) ? "warn" : "ok"}" style="margin:0 0 1rem">${verdict}</p>

        <h4>What to do next</h4>
        <ol class="guide-list">${guidance.map((x) => `<li>${x}</li>`).join("")}</ol>

        <h4>Your roadmap — checkpoints between now and age ${ageE}</h4>
        ${roadmapHtml}

        <h4>Results at a glance</h4>
        <table class="report-table"><tbody>
          <tr><td>What you'll need per year, when you stop working</td><td>${fmt(atRet.need, ccy)}</td></tr>
          <tr><td>What you'll need per year, at age ${ageE}</td><td>${fmt(atEnd.need, ccy)}</td></tr>
          <tr><td>What your accounts will hold when you stop working</td><td>${fmt(stopWorkPort, ccy)} (worst ${fmt(stopWorkPortS, ccy)} · best ${fmt(stopWorkPortBest, ccy)})</td></tr>
          <tr><td>What your accounts will hold at age ${ageE}</td><td>${fmt(atEnd.port, ccy)} (worst ${fmt(atEnd.portStress, ccy)} · best ${fmt(atEnd.portBest, ccy)})</td></tr>
          <tr><td>Age your money runs out (base case)</td><td>${trueBroke ? (trueBroke.youWork || trueBroke.pWork ? "Pre-retire hole @ " + trueBroke.age : String(trueBroke.age)) : "Still funded"}</td></tr>
          <tr><td>Age your money runs out (worst case)</td><td>${brokeS ? String(brokeS.age) : "Still funded"}</td></tr>
          <tr><td>Age your money runs out (best case)</td><td>${brokeBest ? String(brokeBest.age) : "Still funded"}</td></tr>
          <tr><td>Tax you'd pay in your first retirement year</td><td>${fmt(atRet.taxPaid, ccy)}</td></tr>
          <tr><td>Recommended emergency fund today (${emergencyMonths(age0, ageR)} months of essentials, separate from investments)</td><td>${fmt(recommendedEmergFund, ccy)} — you have ${fmt(emergFund, ccy)}</td></tr>
          <tr><td>Your intended savings, made concrete</td><td>${fmt(totalIntendedSave, ccy)}/yr ≈ ${fmt(saveMonthly, ccy)}/month ≈ ${fmt(saveWeekly, ccy)}/week</td></tr>
        </tbody></table>

        <h4>Account balance over time</h4>
        ${balanceChartHtml}

        <h4>Where the money goes, the year you stop working</h4>
        ${mixBarsHtml}

        <h4>Flags on this run</h4>
        <p>${fl.map((f) => `<span class="flag ${f.c}">${f.t}</span>`).join(" ")}</p>

        <h4>Every input used to produce this result</h4>
        ${collectPlanRecord()}

        <p class="lead" style="margin-top:1rem">Generated ${now.toLocaleDateString()} ${now.toLocaleTimeString()} by RetireCompass v${APP_VERSION}. Decision-support only — not tax, legal or investment advice. Tax brackets, pension clawback and healthcare-surcharge rules are simplified planning estimates, not a real tax filing. Rules live in js/app.js. © ${now.getFullYear()} Rajeev Yadav.</p>`;
    }
  }

  /* ===========================================================================
     8. BOOT — wire up the page once it has loaded
     =========================================================================== */

  /* fillSelects(): populates the three data-driven dropdowns (country,
     profession, city) from the reference tables in section 1, and sets a
     sensible default selection for each so the very first calculation
     isn't run against an empty dropdown. */
  function fillSelects() {
    if (has("country")) {
      $("country").innerHTML = Object.keys(COUNTRIES).map((k) => `<option>${k}</option>`).join("");
      $("country").value = "Canada";
    }
    if (has("profession")) {
      $("profession").innerHTML = Object.keys(PROFESSIONS).map((k) => `<option>${k}</option>`).join("");
      $("profession").value = "MedTech / regulatory / RA-QA";
    }
    if (has("city")) {
      $("city").innerHTML = Object.keys(CITY_BANDS).map((k) => `<option>${k}</option>`).join("");
      $("city").value = "Typical metro";
    }
  }

  /* safeOn(): attach an event listener only if the target element actually
     exists — same defensive philosophy as has()/num()/sel() above. */
  function safeOn(id, evt, fn) { if (has(id)) $(id).addEventListener(evt, fn); }

  /* Scroll-to-top control: a floating button that appears once the person
     has scrolled down (this is a long, 14-section form), and smoothly
     scrolls back to the top when clicked. Purely a navigation convenience —
     it doesn't touch any calculation. */
  function setupScrollTop() {
    const btn = $("scrollTopBtn");
    if (!btn) return;
    const toggle = () => {
      if (window.scrollY > 400) btn.classList.add("show");
      else btn.classList.remove("show");
    };
    window.addEventListener("scroll", toggle, { passive: true });
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    toggle();
  }

  /* Show the engine version in the on-page badge next to the title, and
     stamp every copyright/version/date placeholder used both on-screen and
     in the print-only header/footer, so the visible UI, a printed copy, and
     this source file always agree on which version produced a given
     result. */
  function paintVersion() {
    const year = String(new Date().getFullYear());
    setText("versionBadge", "v" + APP_VERSION);
    setText("versionBadgeFooter", "v" + APP_VERSION);
    setText("copyrightYear", year);
    setText("copyrightYearFooter", year);
    setText("printVersion", APP_VERSION);
  }

  /* Refresh the print-only header/footer's live fields (label + date) right
     before printing, so a PDF always shows the household label currently on
     screen and the actual date it was produced. */
  function paintPrintMeta() {
    setText("printLabel", (has("label") && $("label").value) || "Household");
    setText("printDate", new Date().toLocaleDateString());
  }

  /* setupTabs(): wires up the two-level tab UI — the top-level Plan/Guide
     switch, and the Guide panel's own Why/Manual/Glossary sub-switch. Both
     use the same simple pattern: toggle a "shown" panel by data attribute,
     toggle the ".on" class on whichever button is active. Printing always
     shows the Plan tab regardless of what's on screen (see the @media
     print rule in styles.css hiding #panelGuide outright), so switching
     tabs never affects what a saved PDF contains. */
  function setupTabs() {
    if (has("mainTabs")) {
      $("mainTabs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-tab]");
        if (!btn) return;
        const tab = btn.getAttribute("data-tab");
        $("mainTabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
        if (has("panelPlan")) $("panelPlan").style.display = tab === "plan" ? "" : "none";
        if (has("panelGuide")) $("panelGuide").style.display = tab === "guide" ? "" : "none";
        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      });
    }
    if (has("guideTabs")) {
      $("guideTabs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-guide]");
        if (!btn) return;
        const which = btn.getAttribute("data-guide");
        $("guideTabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
        ["why", "manual", "investing", "glossary"].forEach((k) => {
          const el = $("guide" + k[0].toUpperCase() + k.slice(1));
          if (el) el.style.display = k === which ? "" : "none";
        });
      });
    }
  }

  /* toggleDependentFields(): shows/hides a group of fields based on a
     controlling YES/NO select's current value. Used for partner-dependent
     fields (no point asking someone's partner's salary if they said they
     don't have one), the survivor sub-fields (only meaningful once
     survivor modeling itself is on), and LTC detail fields (start age/
     duration/cost only matter if LTC is modeled at all). Hiding rather
     than just ignoring avoids the confusion of an editable field sitting
     there with no visible effect. */
  function toggleDependentFields(selectId, selectorForFields, showWhen) {
    if (!has(selectId)) return;
    const show = sel(selectId, "") === showWhen;
    document.querySelectorAll(selectorForFields).forEach((el) => {
      el.style.display = show ? "" : "none";
    });
  }

  function refreshFieldVisibility() {
    toggleDependentFields("partnerOn", "#partnerFields", "YES");
    if (has("noPartnerNote")) $("noPartnerNote").style.display = sel("partnerOn", "YES") === "NO" ? "" : "none";
    // Survivor sub-fields only matter once BOTH a partner exists AND
    // survivor modeling is turned on.
    const partnerYes = sel("partnerOn", "YES") === "YES";
    const survYes = sel("survOn", "NO") === "YES";
    document.querySelectorAll(".surv-dep").forEach((el) => {
      el.style.display = (partnerYes && survYes) ? "" : "none";
    });
    toggleDependentFields("ltcOn", ".ltc-dep", "YES");
  }

  /* updateEmergNote(): live in-form callout under the emergency-fund input
     (section 11) — shows the age-based target and the gap immediately,
     rather than only surfacing it as a flag after Calculate. Runs both on
     every edit to the relevant fields and at the end of every full
     calculation, so it never goes stale. */
  function updateEmergNote() {
    if (!has("emergNote")) return;
    const age0 = num("ageNow", 49);
    const ageR = num("ageRet", 65);
    const fund = num("emergFund", 0);
    const core = num("core", 0);
    const house = num("house", 0);
    const health = num("health", 0);
    const target = ((core + house + health) / 12) * emergencyMonths(age0, ageR);
    const ccyNow = (has("ccy") && $("ccy").value) || "USD";
    if (target <= 0) { setText("emergNote", ""); return; }
    if (fund < target * 0.9) {
      setText("emergNote", "Age-based target ≈ " + fmt(target, ccyNow) + " (" + emergencyMonths(age0, ageR) + " months of essentials). You're " + fmt(target - fund, ccyNow) + " short — see \"What to do next\" after calculating.");
    } else {
      setText("emergNote", "Age-based target ≈ " + fmt(target, ccyNow) + " (" + emergencyMonths(age0, ageR) + " months of essentials) — you're at or above it.");
    }
  }

  /* boot(): the single entry point that wires up the whole page. Runs once
     the DOM is ready (or immediately, if this script happens to load after
     the DOM is already ready — e.g. if it's ever injected dynamically).
     paintVersion() runs FIRST, before anything else that could plausibly
     throw — the version badge/footer should never depend on every other
     boot step having succeeded. Each remaining step is wrapped so one
     failing step (a missing element after a future edit, a typo) can't
     silently take down every step after it — the previous version of this
     function ran everything in one unguarded sequence, so a single early
     exception could leave the whole page inert with no visible error. */
  function boot() {
    paintVersion();
    const steps = [
      fillSelects, renderKids, renderDebts, renderGifts, renderPets, bindTables,
      countryApply, professionApply, cityApply, paintPrintMeta,
      setupScrollTop, setupTabs, refreshFieldVisibility, updateEmergNote
    ];
    steps.forEach((step) => {
      try { step(); } catch (e) { console.error("RetireCompass boot step failed:", step.name, e); }
    });
    // Also catch Ctrl/Cmd+P or the browser's native print menu, not just
    // our own Print button, so the print header/footer are always current.
    window.addEventListener("beforeprint", paintPrintMeta);

    safeOn("country", "change", () => { countryApply(); run(); });
    safeOn("profession", "change", () => { professionApply(); run(); });
    safeOn("city", "change", () => { cityApply(); run(); });
    safeOn("partnerOn", "change", () => { refreshFieldVisibility(); run(); });
    safeOn("survOn", "change", () => { refreshFieldVisibility(); run(); });
    safeOn("ltcOn", "change", () => { refreshFieldVisibility(); run(); });
    ["ageNow", "h0", "hk", "aStar", "hCap"].forEach((id) => safeOn(id, "input", paintHazardPreview));
    ["save", "pSave"].forEach((id) => safeOn(id, "input", updateRoomNote));
    ["emergFund", "ageNow", "ageRet", "core", "house", "health"].forEach((id) => safeOn(id, "input", updateEmergNote));

    safeOn("addKid", "click", () => {
      kids.push({ name: "Child " + (kids.length + 1), age: 8, indep: 22, cost: 10000, program: "— pick a program (or edit tuition directly) —", tuition: 15000, tStart: 18, tEnd: 22, afterHelp: 4000, helpUntil: 26, payback: 0 });
      renderKids();
    });
    safeOn("addDebt", "click", () => {
      debts.push({ name: "Debt", type: "Other", balance: 5000, rate: 0.08, payment: 1200 });
      renderDebts();
    });
    safeOn("addGift", "click", () => {
      gifts.push({ name: "Gift", ageAt: num("ageRet", 65), amount: 5000 });
      renderGifts();
    });
    safeOn("addPet", "click", () => {
      pets.push({ name: "Pet", cost: 1200, vet: 600, untilAge: num("ageNow", 49) + 12 });
      renderPets();
    });

    safeOn("run", "click", run);
    safeOn("floatingCalc", "click", run);
    // Also fire on Ctrl/Cmd+Enter from anywhere in the form, so a person
    // deep in section 12 doesn't have to scroll back to the top just to
    // recalculate — the floating button below covers the rest.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { run(); }
    });
    // Always recalculate right before printing, so a printed/PDF copy can
    // never show stale numbers from before the person's last edit.
    safeOn("print", "click", () => { run(); paintPrintMeta(); window.print(); });
    safeOn("reset", "click", () => {
      if (window.confirm("Reset clears every field back to the starting example — this can't be undone. Continue?")) {
        location.reload();
      }
    });

    try { run(); } catch (e) { console.error("RetireCompass initial calculation failed:", e); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
