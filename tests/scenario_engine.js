/* =============================================================================
   tests/scenario_engine.js
   =============================================================================
   Regression harness for RetireCompass's calculation engine.

   WHY THIS EXISTS
   ----------------
   An external QA review (NR Koka / Tyche LLC, Sept 2026 — see
   RetireCompass_QA_Report.docx) found that the chart, the KPI summary
   cards, and the year-by-year table could disagree with each other by up
   to 14 years on the same plan — even though each one, read in isolation,
   looked plausible. The root cause was a withdrawal figure that wasn't
   capped at the account's real balance, so it kept "reporting" money that
   didn't exist once an account was already empty.

   That bug was invisible to a syntax check and invisible to a test that
   only asserts on one number in isolation — it only shows up when you
   compare what two DIFFERENT parts of the UI say about the SAME plan.
   This script exists to make that comparison automatic and permanent, so
   the next change to js/app.js can't reintroduce this class of bug without
   a test failing on the same commit.

   HOW IT WORKS
   ------------
   Loads the real index.html + js/app.js into a headless DOM (jsdom — no
   browser, no network, matches the project's offline-only design), drives
   it exactly like a person would (setting fields, dispatching real input/
   change events, clicking buttons), and asserts that the different parts
   of the UI that describe the same underlying numbers actually agree.

   It is intentionally NOT a pixel-level visual regression tool — it can't
   catch a chart rendering the right numbers in the wrong place on screen.
   For that class of bug, an occasional live-browser QA pass (the kind that
   found this one) is still worth commissioning. This script is the
   permanent, free, every-commit floor underneath that.

   HOW TO RUN
   -----------
     npm install jsdom --no-save     (one-time / CI step)
     node tests/scenario_engine.js

   Exits 0 with a summary if everything passes, exits 1 and prints exactly
   which check failed and why if not. tests/test_scenarios.py calls this
   from pytest so it runs as part of the normal CI suite.
   ========================================================================= */
"use strict";
const path = require("path");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || "" });
}

function freshDom() {
  const dom = new JSDOM(HTML, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
  dom.__errors = [];
  dom.window.addEventListener("error", (e) => {
    dom.__errors.push((e.error && e.error.stack) || e.message);
  });
  const s = dom.window.document.createElement("script");
  s.textContent = JS;
  dom.window.document.body.appendChild(s);
  return dom;
}
/* app.js's boot() attaches on DOMContentLoaded, which jsdom fires
   asynchronously — a script immediately after appendChild() would run
   before boot() has wired anything up. Waiting a tick (matching how the
   app behaves in a real browser on page load) avoids a wall of false
   failures that are a test-harness timing issue, not a real app bug. */
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function set(d, id, val) {
  const el = d.getElementById(id);
  if (!el) throw new Error("set(): no element #" + id);
  el.value = val;
  el.dispatchEvent(new d.defaultView.Event("input", { bubbles: true }));
  el.dispatchEvent(new d.defaultView.Event("change", { bubbles: true }));
}
function clearRows(d, bodyId, delAttr) {
  const body = d.getElementById(bodyId);
  if (!body) return;
  while (body.children.length) body.querySelector(`button[${delAttr}]`).click();
}
function num(str) { return parseFloat(String(str).replace(/[^0-9.\-]/g, "")) || 0; }

function tableRows(d) {
  return Array.from(d.getElementById("yearBody").querySelectorAll("tr")).map((tr) => {
    const c = Array.from(tr.children).map((td) => td.textContent);
    return { age: num(c[0]), status: c[1], need: num(c[2]), draw: num(c[8]), balance: num(c[9]) };
  });
}

/* A run() invocation is internally consistent if the "at stop-work" and
   "at plan-to-age" KPI figures never exceed the true peak balance the
   year-by-year table actually shows (with a small tolerance for the
   worst/best-case parenthetical splitting differently than the base
   number). This is the exact shape of the B-01/B-02/B-03 bug: a KPI
   reconstructing a number instead of reading the real simulated balance
   can drift arbitrarily far from what the table and chart agree on. */
function assertKpiMatchesTable(d, label) {
  const rows = tableRows(d);
  if (!rows.length) { check(label + ": has year-by-year rows", false, "table was empty"); return; }
  const trueMax = Math.max(0, ...rows.map((r) => r.balance));
  const kpiNestNum = num(d.getElementById("kpiNest").textContent);
  const kpiEndNum = num(d.getElementById("kpiEnd").textContent);
  const tolerance = Math.max(1000, trueMax * 0.02); // small numeric slack, not a loophole
  check(label + ": kpiNest does not exceed the table's true peak balance",
    kpiNestNum <= trueMax + tolerance,
    `kpiNest=${kpiNestNum}, true peak in table=${trueMax}`);
  check(label + ": kpiEnd does not exceed the table's true peak balance",
    kpiEndNum <= trueMax + tolerance,
    `kpiEnd=${kpiEndNum}, true peak in table=${trueMax}`);

  // If the KPI names a "money runs out" age, that age's own table row must
  // actually show the balance at or below zero — the KPI is not allowed
  // to name an age the table itself doesn't back up.
  const brokeText = d.getElementById("kpiBroke").textContent;
  const brokeAgeMatch = brokeText.match(/(\d+)/);
  if (brokeAgeMatch) {
    const age = parseInt(brokeAgeMatch[1], 10);
    const row = rows.find((r) => r.age === age);
    check(label + ": kpiBroke's named age is actually zero (or below) in the table",
      !!row && row.balance <= 0,
      `kpiBroke says age ${age}, table balance there = ${row ? row.balance : "no such row"}`);
  }

  // Directly targets the root-cause bug (uncapped draw): once the balance
  // has been at zero for a full year already (i.e. it was already zero
  // LAST year too, so there's nothing left to draw from and no fresh
  // contribution could have arrived yet this same row), this year's "Draw"
  // column must also be ~0. An uncapped draw instead keeps climbing every
  // year forever, tracking a phantom shortfall instead of real cash
  // leaving a real account — this is the exact shape of the original bug,
  // checked at its source rather than through a downstream KPI that a
  // different fix could coincidentally paper over.
  let sawPhantomDraw = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].balance <= 0 && rows[i].balance <= 0 && rows[i].draw > 1000) {
      sawPhantomDraw = true;
      break;
    }
  }
  check(label + ": Draw column does not keep climbing after the account is already empty",
    !sawPhantomDraw, "found a year with balance already at 0 the year before, yet Draw > $1,000 that year");
}

async function run() {
  // ---- Scenario 1: solo US earner ----
  {
    const dom = freshDom();
    await wait(50);
    const d = dom.window.document;
    set(d, "country", "United States"); set(d, "needRule", "spend");
    set(d, "ageNow", "38"); set(d, "ageRet", "65"); set(d, "ageEnd", "90");
    set(d, "youInc", "120000"); set(d, "partnerOn", "NO");
    set(d, "nest", "160900"); set(d, "save", "18000"); set(d, "pSave", "0");
    clearRows(d, "debtBody", "data-deld"); clearRows(d, "giftBody", "data-delg"); clearRows(d, "petsBody", "data-delp");
    d.getElementById("run").click();
    check("Scenario 1: no JS runtime errors", dom.__errors.length === 0, dom.__errors.join(" | "));
    assertKpiMatchesTable(d, "Scenario 1");
  }

  // ---- Scenario 2: Canadian couple, kids, LTC, survivor path ----
  {
    const dom = freshDom();
    await wait(50);
    const d = dom.window.document;
    set(d, "country", "Canada"); set(d, "needRule", "spend");
    set(d, "ageNow", "44"); set(d, "ageRet", "62"); set(d, "ageEnd", "92");
    set(d, "youInc", "95000"); set(d, "partnerOn", "YES"); set(d, "pAge", "42"); set(d, "pInc", "72000"); set(d, "pRet", "62");
    set(d, "nest", "310000");
    set(d, "survOn", "YES"); set(d, "survWho", "partner"); set(d, "survAge", "78");
    set(d, "ltcOn", "YES"); set(d, "ltcAge", "82"); set(d, "ltcYrs", "4"); set(d, "ltcCost", "48000");
    d.getElementById("addKid").click();
    d.getElementById("addKid").click();
    d.getElementById("run").click();
    check("Scenario 2: no JS runtime errors", dom.__errors.length === 0, dom.__errors.join(" | "));
    assertKpiMatchesTable(d, "Scenario 2");
  }

  // ---- Scenario 3: illogical ages must BLOCK, not compute nonsense ----
  {
    const dom = freshDom();
    await wait(50);
    const d = dom.window.document;
    set(d, "ageNow", "55"); set(d, "ageRet", "50"); set(d, "ageEnd", "45");
    d.getElementById("run").click();
    check("Scenario 3: no JS runtime errors", dom.__errors.length === 0, dom.__errors.join(" | "));
    check("Scenario 3: invalid age order produces zero table rows",
      d.getElementById("yearBody").children.length === 0,
      "rows=" + d.getElementById("yearBody").children.length);
    check("Scenario 3: verdict names the age-order problem",
      d.getElementById("verdict").textContent.toLowerCase().includes("check your ages"),
      d.getElementById("verdict").textContent);
    check("Scenario 3: kpiNest is blanked, not a computed number",
      d.getElementById("kpiNest").textContent.trim() === "—",
      d.getElementById("kpiNest").textContent);

    // Recovering with valid ages afterward must produce a normal result —
    // guards against the bad-age path leaving stale state behind.
    set(d, "ageNow", "55"); set(d, "ageRet", "63"); set(d, "ageEnd", "88");
    d.getElementById("run").click();
    check("Scenario 3: recovers to a normal result once ages are fixed",
      d.getElementById("yearBody").children.length > 0 && !d.getElementById("verdict").textContent.toLowerCase().includes("check your ages"),
      d.getElementById("verdict").textContent);
  }

  // ---- Scenario 4: complex household (kids, pets, multiple debts) ----
  {
    const dom = freshDom();
    await wait(50);
    const d = dom.window.document;
    set(d, "country", "United States"); set(d, "needRule", "spend");
    set(d, "ageNow", "40"); set(d, "ageRet", "65"); set(d, "ageEnd", "90");
    set(d, "youInc", "150000"); set(d, "partnerOn", "NO");
    d.getElementById("addKid").click();
    d.getElementById("addKid").click();
    d.getElementById("addKid").click();
    d.getElementById("run").click();
    check("Scenario 4: no JS runtime errors", dom.__errors.length === 0, dom.__errors.join(" | "));
    assertKpiMatchesTable(d, "Scenario 4");
  }

  // ---- UI behavior checks (B-04 through B-11 territory) ----
  {
    const dom = freshDom();
    await wait(50);
    const d = dom.window.document;

    set(d, "partnerOn", "NO");
    check("Partner fields hide when Partner = NO",
      d.getElementById("partnerFields").style.display === "none",
      d.getElementById("partnerFields").style.display);
    set(d, "partnerOn", "YES");
    check("Partner fields show when Partner = YES",
      d.getElementById("partnerFields").style.display === "",
      d.getElementById("partnerFields").style.display);

    set(d, "ltcOn", "NO");
    check("LTC detail fields hide when LTC = NO",
      Array.from(d.querySelectorAll(".ltc-dep")).every((el) => el.style.display === "none"),
      "");
    set(d, "ltcOn", "YES");
    check("LTC detail fields show when LTC = YES",
      Array.from(d.querySelectorAll(".ltc-dep")).every((el) => el.style.display === ""),
      "");

    let confirmed = false;
    dom.window.confirm = () => { confirmed = true; return false; };
    d.getElementById("reset").click();
    check("Reset asks for confirmation before clearing the form", confirmed, "");

    check("Version badge is populated on load", d.getElementById("versionBadge").textContent.trim().length > 0, "");
    check("Footer version is populated on load", d.getElementById("versionBadgeFooter").textContent.trim().length > 0, "");
    check("Print-footer version is populated on load", d.getElementById("printVersion").textContent.trim().length > 0, "");

    check("Floating Calculate button exists", !!d.getElementById("floatingCalc"), "");
  }
}

run().then(() => {
  finish();
});

function finish() {
const failed = results.filter((r) => !r.pass);
console.log(`\nRetireCompass scenario engine — ${results.length - failed.length}/${results.length} checks passed.\n`);
results.forEach((r) => {
  console.log((r.pass ? "  PASS  " : "  FAIL  ") + r.name + (r.pass ? "" : `\n          -> ${r.detail}`));
});
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
}
