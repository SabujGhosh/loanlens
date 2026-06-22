"use strict";

/* ============================================================
   Home Loan Repayment & Prepayment Calculator
   - Month-by-month amortization on a reducing balance
   - Prepayment strategies: reduce TENURE or reduce EMI
   - Extra options: monthly extra, yearly extra, step-up EMI, lump sums
   ============================================================ */

/* ---------- currency / formatting ---------- */
let CUR = "₹";
let LOCALE = "en-IN";

function fmtMoney(n, withSym = true) {
  if (!isFinite(n)) n = 0;
  const s = Math.round(n).toLocaleString(LOCALE);
  return (withSym ? CUR : "") + s;
}
function fmtCompact(n) {
  // short axis labels: 12.5L / 1.2Cr or 1.2M etc.
  const abs = Math.abs(n);
  if (LOCALE === "en-IN") {
    if (abs >= 1e7) return CUR + (n / 1e7).toFixed(2).replace(/\.00$/, "") + "Cr";
    if (abs >= 1e5) return CUR + (n / 1e5).toFixed(1).replace(/\.0$/, "") + "L";
    if (abs >= 1e3) return CUR + Math.round(n / 1e3) + "K";
  } else {
    if (abs >= 1e6) return CUR + (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
    if (abs >= 1e3) return CUR + Math.round(n / 1e3) + "K";
  }
  return CUR + Math.round(n);
}
function fmtDuration(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(y + (y === 1 ? " yr" : " yrs"));
  if (m) parts.push(m + (m === 1 ? " mo" : " mos"));
  return parts.join(" ") || "0 mo";
}

/* ---------- date helper ---------- */
// actual days in a given calendar month (handles leap-year February)
function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate();
}

/* ---------- EMI formula ---------- */
function calcEmi(principal, annualRate, months) {
  if (months <= 0) return 0;
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/* ---------- core amortization simulator ----------
   opts = {
     principal, annualRate, months,        // base loan
     startYear, startMonth,                 // for date labels (month 1-12)
     strategy: "tenure" | "emi",
     extraMonthly, extraYearly, yearlyMonth (1-12, calendar month),
     stepupPct,                             // % increase to EMI every 12 instalments
     lumps: [{ amount, month }]             // month = instalment number (1-based)
   }
   Returns { rows, totalInterest, totalPaid, totalPrepaid, months, baseEmi }
*/
function simulate(opts) {
  let curRate = opts.annualRate;          // current ANNUAL rate (changes on revisions)
  const baseEmi = calcEmi(opts.principal, opts.annualRate, opts.months);
  // a fixed/custom EMI (e.g. fixed on a higher sanctioned amount) overrides the natural one
  let emi = (opts.customEmi && opts.customEmi > 0) ? opts.customEmi : baseEmi;
  let balance = opts.principal;

  const lumpMap = new Map();
  (opts.lumps || []).forEach((l) => {
    if (l.amount > 0 && l.month >= 1) {
      lumpMap.set(l.month, (lumpMap.get(l.month) || 0) + l.amount);
    }
  });

  // interest-rate revisions: instalment month -> new annual rate
  const rateMap = new Map();
  (opts.rateChanges || []).forEach((c) => {
    if (c.rate > 0 && c.month >= 1) rateMap.set(c.month, c.rate);
  });
  // behavior on a rate revision: "tenure" = keep EMI (term flexes),
  //                              "emi"    = recompute EMI to keep original term
  const rateBehavior = opts.rateBehavior || "tenure";

  const rows = [];
  let totalInterest = 0, totalPaid = 0, totalPrepaid = 0;
  let n = 0;
  const HARD_CAP = opts.months + 1200; // safety against runaway loops

  // calendar tracking: each instalment maps to a real calendar month
  let calMonth = opts.startMonth; // 1-12
  let calYear = opts.startYear;

  while (balance > 0.5 && n < HARD_CAP) {
    n++;

    // ---- interest-rate revision effective this instalment ----
    if (rateMap.has(n)) {
      curRate = rateMap.get(n);
      if (rateBehavior === "emi") {
        const remaining = opts.months - (n - 1); // keep original end date
        if (remaining > 0 && balance > 0.5) emi = calcEmi(balance, curRate, remaining);
      }
      // "tenure": EMI unchanged, the loan term flexes naturally
    }

    // step-up: bump EMI every 12 instalments (after the first year)
    if (opts.stepupPct > 0 && n > 1 && (n - 1) % 12 === 0) {
      emi = emi * (1 + opts.stepupPct / 100);
    }

    // ---- DAILY-reducing-balance interest for THIS calendar month ----
    // interest = balance × annualRate × (days in this month / 365)
    // so a 28-day February accrues less than a 31-day March on the same balance.
    const days = daysInMonth(calYear, calMonth);
    const interest = balance * (curRate / 100) * (days / 365);
    let principalPart = emi - interest;

    // guard: if EMI can't even cover interest, force progress
    if (principalPart <= 0) {
      principalPart = balance * 0.0; // no principal reduction
    }
    if (principalPart > balance) principalPart = balance;

    balance -= principalPart;

    // ---- prepayments this instalment ----
    let prepay = 0;
    if (opts.extraMonthly > 0) prepay += opts.extraMonthly;
    if (opts.extraYearly > 0 && calMonth === opts.yearlyMonth) prepay += opts.extraYearly;
    if (lumpMap.has(n)) prepay += lumpMap.get(n);

    if (prepay > 0) {
      if (prepay > balance) prepay = balance;
      balance -= prepay;

      // strategy: reduce EMI -> recompute EMI over the REMAINING original term
      if (opts.strategy === "emi") {
        const remaining = opts.months - n;
        if (remaining > 0 && balance > 0.5) {
          emi = calcEmi(balance, curRate, remaining);
        }
      }
      // strategy: reduce tenure -> keep EMI, loop simply ends earlier
    }

    const payment = interest + principalPart + prepay;
    totalInterest += interest;
    totalPaid += payment;
    totalPrepaid += prepay;

    rows.push({
      n,
      calMonth,
      calYear,
      days,
      emi,
      interest,
      principal: principalPart,
      prepay,
      payment,
      balance: balance < 0.5 ? 0 : balance,
    });

    // advance to next calendar month
    if (calMonth === 12) { calMonth = 1; calYear++; } else { calMonth++; }
    if (balance <= 0.5) break;
  }

  return {
    rows,
    totalInterest,
    totalPaid,
    totalPrepaid,
    months: rows.length,
    baseEmi,
  };
}

/* ---------- read inputs ---------- */
function readInputs() {
  const sd = document.getElementById("startDate").value; // "YYYY-MM"
  let startYear = new Date().getFullYear();
  let startMonth = new Date().getMonth() + 1;
  if (sd) {
    const [y, m] = sd.split("-").map(Number);
    startYear = y; startMonth = m;
  }

  const lumps = [...document.querySelectorAll("#lumpList .lump-row")].map((row) => {
    const amount = parseFloat(row.querySelector(".lump-amount").value) || 0;
    const md = row.querySelector(".lump-month").value; // "YYYY-MM"
    let month = 1;
    if (md) {
      const [ly, lm] = md.split("-").map(Number);
      month = (ly - startYear) * 12 + (lm - startMonth) + 1;
    }
    return { amount, month: Math.max(1, month) };
  });

  const rateChanges = [...document.querySelectorAll("#rateList .rate-row")].map((row) => {
    const rate = parseFloat(row.querySelector(".rate-value").value) || 0;
    const md = row.querySelector(".rate-month").value; // "YYYY-MM"
    let month = 1;
    if (md) {
      const [ly, lm] = md.split("-").map(Number);
      month = (ly - startYear) * 12 + (lm - startMonth) + 1;
    }
    return { rate, month: Math.max(1, month) };
  });

  const annualRate = parseFloat(document.getElementById("rate").value) || 0;
  const months = (parseInt(document.getElementById("tenure").value, 10) || 1) * 12;

  // fixed/custom EMI: explicit override wins; else derive from a sanctioned amount
  const manualEmi = parseFloat(document.getElementById("customEmi").value) || 0;
  const sanctioned = parseFloat(document.getElementById("sanctioned").value) || 0;
  const customEmi = manualEmi > 0
    ? manualEmi
    : (sanctioned > 0 ? calcEmi(sanctioned, annualRate, months) : 0);

  return {
    principal: parseFloat(document.getElementById("principal").value) || 0,
    annualRate,
    months,
    customEmi,
    sanctioned,
    startYear, startMonth,
    strategy: document.querySelector('input[name="strategy"]:checked').value,
    extraMonthly: parseFloat(document.getElementById("extraMonthly").value) || 0,
    extraYearly: parseFloat(document.getElementById("extraYearly").value) || 0,
    yearlyMonth: parseInt(document.getElementById("yearlyMonth").value, 10) || 1,
    stepupPct: parseFloat(document.getElementById("stepup").value) || 0,
    rateChanges,
    rateBehavior: document.querySelector('input[name="rateBehavior"]:checked').value,
    lumps,
  };
}

/* ---------- charts ---------- */
let charts = {};
const monthName = (m) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];

// Chart.js is vendored locally; guard so the calculator (numbers/table/CSV) still
// works even if the chart library failed to load for any reason.
const HAS_CHART = typeof Chart !== "undefined";
if (HAS_CHART) {
  Chart.defaults.color = "#94a3c0";
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.borderColor = "rgba(44,56,84,.6)";
}

function destroyCharts() {
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};
}

// Shown once if Chart.js failed to load (e.g. vendor/chart.umd.min.js is missing).
let chartFallbackShown = false;
function showChartFallback() {
  if (chartFallbackShown) return;
  chartFallbackShown = true;
  document.querySelectorAll(".chart-box canvas").forEach((cv) => {
    const note = document.createElement("div");
    note.className = "chart-missing";
    note.innerHTML =
      "📊 Charts need <code>vendor/chart.umd.min.js</code>.<br>" +
      "Download it once, then refresh — see the README. " +
      "All numbers, the schedule and CSV export still work.";
    cv.replaceWith(note);
  });
}

// Draws dashed vertical lines (e.g. rate-change events) on a category x-axis.
// Reads chart.options.plugins.vlines.list = [{ pos, label, color }]  (pos = fractional index)
const vlinePlugin = {
  id: "vlines",
  afterDatasetsDraw(chart) {
    const cfg = chart.options.plugins.vlines;
    if (!cfg || !cfg.list || !cfg.list.length) return;
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
    cfg.list.forEach((mk) => {
      const i0 = Math.floor(mk.pos);
      const i1 = i0 + 1;
      const p0 = x.getPixelForValue(i0);
      const p1 = x.getPixelForValue(i1);
      const px = isFinite(p1) ? p0 + (p1 - p0) * (mk.pos - i0) : p0;
      if (!isFinite(px)) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = mk.color || "#fbbf24";
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = mk.color || "#fbbf24";
      ctx.font = "600 10px Inter, sans-serif";
      ctx.textAlign = px > (x.left + x.right) / 2 ? "right" : "left";
      ctx.fillText(" " + mk.label + " ", px, top + 10);
      ctx.restore();
    });
  },
};

function yearLabels(rows) {
  // one label per 12 instalments (loan year)
  const labels = [];
  for (let i = 0; i < rows.length; i += 12) {
    const yr = Math.floor(i / 12) + 1;
    labels.push("Yr " + yr);
  }
  return labels;
}

function sampleBalanceByYear(rows) {
  // balance at end of each loan-year
  const out = [];
  for (let i = 11; i < rows.length; i += 12) out.push(rows[i].balance);
  if ((rows.length - 1) % 12 !== 11) out.push(rows[rows.length - 1].balance);
  return out;
}

function aggregateYearly(rows) {
  // returns [{year, interest, principal, prepay, emiAvg}]
  const buckets = [];
  for (let i = 0; i < rows.length; i += 12) {
    const slice = rows.slice(i, i + 12);
    buckets.push({
      label: "Yr " + (Math.floor(i / 12) + 1),
      interest: slice.reduce((a, r) => a + r.interest, 0),
      principal: slice.reduce((a, r) => a + r.principal, 0),
      prepay: slice.reduce((a, r) => a + r.prepay, 0),
      emi: slice[slice.length - 1].emi,
    });
  }
  return buckets;
}

const tooltipMoney = {
  callbacks: {
    label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`,
  },
};
const moneyAxis = {
  ticks: { callback: (v) => fmtCompact(v) },
  grid: { color: "rgba(44,56,84,.4)" },
};

function renderCharts(base, prep, opts) {
  if (!HAS_CHART) { showChartFallback(); return; } // numbers/table/CSV still work
  destroyCharts();

  // rate-change markers: map each revision's instalment month to a chart position.
  // balance chart is sampled yearly (÷12); EMI chart every 6 months (÷6).
  const changes = (opts && opts.rateChanges ? opts.rateChanges : []).filter((c) => c.rate > 0);
  const balMarkers = changes.map((c) => ({ pos: (c.month - 1) / 12, label: c.rate + "%" }));
  const emiMarkers = changes.map((c) => ({ pos: (c.month - 1) / 6, label: c.rate + "%" }));

  /* 1) Outstanding balance over time */
  const baseBal = sampleBalanceByYear(base.rows);
  const prepBal = sampleBalanceByYear(prep.rows);
  const maxLen = Math.max(baseBal.length, prepBal.length);
  const balLabels = Array.from({ length: maxLen }, (_, i) => "Yr " + (i + 1));

  charts.balance = new Chart(document.getElementById("balanceChart"), {
    type: "line",
    plugins: [vlinePlugin],
    data: {
      labels: balLabels,
      datasets: [
        {
          label: "Original",
          data: baseBal,
          borderColor: "#94a3c0",
          backgroundColor: "rgba(148,163,192,.08)",
          borderWidth: 2, tension: .25, pointRadius: 0, fill: true,
        },
        {
          label: "With prepayments",
          data: prepBal,
          borderColor: "#34d399",
          backgroundColor: "rgba(52,211,153,.12)",
          borderWidth: 2.5, tension: .25, pointRadius: 0, fill: true,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: tooltipMoney, legend: { labels: { boxWidth: 12 } },
        vlines: { list: balMarkers },
      },
      scales: { y: { ...moneyAxis, beginAtZero: true }, x: { grid: { display: false } } },
    },
  });

  /* 2) Interest vs principal comparison (bar) */
  charts.compare = new Chart(document.getElementById("compareChart"), {
    type: "bar",
    data: {
      labels: ["Total interest", "Total payment"],
      datasets: [
        {
          label: "Original",
          data: [base.totalInterest, base.totalPaid],
          backgroundColor: "rgba(148,163,192,.6)",
          borderRadius: 6,
        },
        {
          label: "With prepayments",
          data: [prep.totalInterest, prep.totalPaid],
          backgroundColor: "rgba(52,211,153,.75)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: tooltipMoney, legend: { labels: { boxWidth: 12 } } },
      scales: { y: { ...moneyAxis, beginAtZero: true }, x: { grid: { display: false } } },
    },
  });

  /* 3) EMI over time */
  const baseEmiSeries = base.rows.filter((_, i) => i % 6 === 0).map((r) => r.emi);
  const prepEmiSeries = prep.rows.filter((_, i) => i % 6 === 0).map((r) => r.emi);
  const emiLen = Math.max(baseEmiSeries.length, prepEmiSeries.length);
  const emiLabels = Array.from({ length: emiLen }, (_, i) => "Mo " + (i * 6 + 1));

  charts.emi = new Chart(document.getElementById("emiChart"), {
    type: "line",
    plugins: [vlinePlugin],
    data: {
      labels: emiLabels,
      datasets: [
        {
          label: "Standard EMI",
          data: baseEmiSeries,
          borderColor: "#94a3c0", borderWidth: 2, pointRadius: 0,
          stepped: true,
        },
        {
          label: "Your EMI",
          data: prepEmiSeries,
          borderColor: "#5b8cff", borderWidth: 2.5, pointRadius: 0,
          stepped: true, backgroundColor: "rgba(91,140,255,.1)", fill: true,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: tooltipMoney, legend: { labels: { boxWidth: 12 } },
        vlines: { list: emiMarkers },
      },
      scales: { y: { ...moneyAxis, beginAtZero: false }, x: { grid: { display: false } } },
    },
  });

  /* 4) Yearly principal vs interest (stacked) */
  const agg = aggregateYearly(prep.rows);
  charts.split = new Chart(document.getElementById("splitChart"), {
    type: "bar",
    data: {
      labels: agg.map((a) => a.label),
      datasets: [
        {
          label: "Principal",
          data: agg.map((a) => a.principal),
          backgroundColor: "rgba(91,140,255,.8)", borderRadius: 4, stack: "s",
        },
        {
          label: "Prepayment",
          data: agg.map((a) => a.prepay),
          backgroundColor: "rgba(52,211,153,.85)", borderRadius: 4, stack: "s",
        },
        {
          label: "Interest",
          data: agg.map((a) => a.interest),
          backgroundColor: "rgba(251,191,36,.8)", borderRadius: 4, stack: "s",
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: tooltipMoney, legend: { labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ...moneyAxis, beginAtZero: true },
      },
    },
  });
}

/* ---------- table ---------- */
let lastPrep = null;

function renderTable(prep) {
  const yearly = document.getElementById("yearlyView").checked;
  const thead = document.querySelector("#amortTable thead");
  const tbody = document.querySelector("#amortTable tbody");

  const cols = yearly
    ? ["Year", "Days", "EMI", "Principal", "Interest", "Prepaid", "Balance"]
    : ["#", "Month", "Days", "EMI", "Principal", "Interest", "Prepaid", "Balance"];
  thead.innerHTML = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";

  let html = "";
  if (yearly) {
    const buckets = [];
    prep.rows.forEach((r) => {
      const yi = Math.floor((r.n - 1) / 12);
      if (!buckets[yi]) buckets[yi] = { principal: 0, interest: 0, prepay: 0, days: 0, emi: 0, balance: 0, label: "Yr " + (yi + 1) };
      buckets[yi].principal += r.principal;
      buckets[yi].interest += r.interest;
      buckets[yi].prepay += r.prepay;
      buckets[yi].days += r.days;
      buckets[yi].emi = r.emi;
      buckets[yi].balance = r.balance;
    });
    buckets.forEach((b) => {
      html += `<tr class="year-row">
        <td>${b.label}</td>
        <td>${b.days}</td>
        <td>${fmtMoney(b.emi)}</td>
        <td>${fmtMoney(b.principal)}</td>
        <td>${fmtMoney(b.interest)}</td>
        <td class="${b.prepay ? "prepay-cell" : ""}">${b.prepay ? fmtMoney(b.prepay) : "—"}</td>
        <td>${fmtMoney(b.balance)}</td></tr>`;
    });
  } else {
    prep.rows.forEach((r) => {
      html += `<tr>
        <td>${r.n}</td>
        <td>${monthName(r.calMonth)} ${r.calYear}</td>
        <td>${r.days}</td>
        <td>${fmtMoney(r.emi)}</td>
        <td>${fmtMoney(r.principal)}</td>
        <td>${fmtMoney(r.interest)}</td>
        <td class="${r.prepay ? "prepay-cell" : ""}">${r.prepay ? fmtMoney(r.prepay) : "—"}</td>
        <td>${fmtMoney(r.balance)}</td></tr>`;
    });
  }
  tbody.innerHTML = html;
}

function exportCsv() {
  if (!lastPrep) return;
  const head = ["Instalment", "Month", "Year", "Days", "EMI", "Principal", "Interest", "Prepayment", "Balance"];
  const lines = [head.join(",")];
  lastPrep.rows.forEach((r) => {
    lines.push([
      r.n, monthName(r.calMonth), r.calYear, r.days,
      Math.round(r.emi), Math.round(r.principal), Math.round(r.interest),
      Math.round(r.prepay), Math.round(r.balance),
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "amortization-schedule.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- main recompute ---------- */
function recompute() {
  const opts = readInputs();
  if (opts.principal <= 0 || opts.months <= 0) return;

  // baseline = the standard loan: starting rate, natural EMI, no prepayments, no revisions
  const base = simulate({
    ...opts,
    strategy: "tenure", customEmi: 0,
    extraMonthly: 0, extraYearly: 0, stepupPct: 0, lumps: [], rateChanges: [],
  });

  const prep = simulate(opts);
  lastPrep = prep;

  const hasPrepay =
    opts.extraMonthly > 0 || opts.extraYearly > 0 || opts.stepupPct > 0 ||
    opts.lumps.some((l) => l.amount > 0);
  const hasRateChange = opts.rateChanges.some((c) => c.rate > 0);
  const hasCustomEmi = opts.customEmi > 0;
  const hasChange = hasPrepay || hasRateChange || hasCustomEmi;

  // ---- KPI cards ----
  const startEmi = hasCustomEmi ? opts.customEmi : base.baseEmi;
  document.getElementById("kpiEmi").textContent = fmtMoney(startEmi);
  document.getElementById("kpiEmiSub").textContent = hasCustomEmi
    ? `standard would be ${fmtMoney(base.baseEmi)}`
    : "";

  const interestSaved = base.totalInterest - prep.totalInterest;
  const pct = base.totalInterest > 0 ? (interestSaved / base.totalInterest) * 100 : 0;
  document.getElementById("kpiInterestSaved").textContent = fmtMoney(interestSaved);
  document.getElementById("kpiInterestSavedPct").textContent =
    hasChange ? `${pct.toFixed(1)}% vs original` : "add a change →";

  const monthsSaved = base.months - prep.months;
  document.getElementById("kpiTimeSaved").textContent =
    monthsSaved > 0 ? fmtDuration(monthsSaved)
    : monthsSaved < 0 ? "+" + fmtDuration(-monthsSaved) + " longer"
    : "—";
  document.getElementById("kpiNewTenure").textContent =
    `new tenure ${fmtDuration(prep.months)}`;

  document.getElementById("kpiPrepaid").textContent = fmtMoney(prep.totalPrepaid);
  const lastEmi = prep.rows.length ? prep.rows[prep.rows.length - 1].emi : base.baseEmi;
  document.getElementById("kpiNewEmi").textContent =
    opts.strategy === "emi" && hasPrepay
      ? `final EMI ${fmtMoney(lastEmi)}`
      : (opts.stepupPct > 0 ? `final EMI ${fmtMoney(lastEmi)}` : "");

  // ---- summary table ----
  const set = (id, v) => (document.getElementById(id).textContent = v);
  set("sOrigPrincipal", fmtMoney(opts.principal));
  set("sOrigInterest", fmtMoney(base.totalInterest));
  set("sOrigTotal", fmtMoney(base.totalPaid));
  set("sOrigTenure", fmtDuration(base.months));
  set("sNewPrincipal", fmtMoney(opts.principal));
  set("sNewInterest", fmtMoney(prep.totalInterest));
  set("sNewTotal", fmtMoney(prep.totalPaid));
  set("sNewTenure", fmtDuration(prep.months));

  renderCharts(base, prep, opts);
  renderTable(prep);
}

/* ---------- lump-sum rows ---------- */
function addMonths(ym, n) {
  // ym = "YYYY-MM" -> shifted by n months, returns "YYYY-MM"
  const [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function addLumpRow(amount = "", monthStr = "") {
  const list = document.getElementById("lumpList");
  const empty = list.querySelector(".lump-empty");
  if (empty) empty.remove();

  const start = document.getElementById("startDate").value ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  // default a new lump to one year after the first EMI so it's never ambiguous/out of range
  if (!monthStr) monthStr = addMonths(start, 12);

  const row = document.createElement("div");
  row.className = "lump-row";
  // Static skeleton only — NO untrusted interpolation (values may come from an
  // uploaded scenario file). Dynamic values are assigned via DOM properties below,
  // which never parse HTML, so a malicious file cannot inject markup/scripts.
  row.innerHTML =
    '<div class="input-wrap"><span class="prefix" data-cur></span>' +
    '<input type="number" class="lump-amount" min="0" step="10000" placeholder="amount" /></div>' +
    '<div class="month-in"><input type="month" class="lump-month" /></div>' +
    '<button type="button" class="lump-del" title="Remove">✕</button>';
  row.querySelector(".prefix").textContent = CUR;
  row.querySelector(".lump-amount").value = amount;
  const mInput = row.querySelector(".lump-month");
  mInput.min = start;
  mInput.value = monthStr;
  list.appendChild(row);

  row.querySelector(".lump-del").addEventListener("click", () => {
    row.remove();
    if (!list.querySelector(".lump-row")) showLumpEmpty();
    recompute();
  });
  // listen for BOTH input (typing the amount) and change (native month picker)
  const onEdit = debounce(recompute, 250);
  row.querySelectorAll("input").forEach((i) => {
    i.addEventListener("input", onEdit);
    i.addEventListener("change", onEdit);
  });
  recompute();
}
function showLumpEmpty() {
  document.getElementById("lumpList").innerHTML =
    '<span class="lump-empty">No lump sums yet — click “+ Add”.</span>';
}

/* ---------- interest-rate revision rows ---------- */
function addRateRow(rate = "", monthStr = "") {
  const list = document.getElementById("rateList");
  const empty = list.querySelector(".lump-empty");
  if (empty) empty.remove();

  const start = document.getElementById("startDate").value ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  if (!monthStr) monthStr = addMonths(start, 12);

  const row = document.createElement("div");
  row.className = "lump-row rate-row";
  // Static skeleton only — dynamic values assigned via properties (injection-safe).
  row.innerHTML =
    '<div class="input-wrap">' +
    '<input type="number" class="rate-value" min="0" max="30" step="0.05" placeholder="new %" />' +
    '<span class="suffix">%</span></div>' +
    '<div class="month-in"><input type="month" class="rate-month" /></div>' +
    '<button type="button" class="lump-del" title="Remove">✕</button>';
  row.querySelector(".rate-value").value = rate;
  const mInput = row.querySelector(".rate-month");
  mInput.min = start;
  mInput.value = monthStr;
  list.appendChild(row);

  row.querySelector(".lump-del").addEventListener("click", () => {
    row.remove();
    if (!list.querySelector(".rate-row")) showRateEmpty();
    recompute();
  });
  const onEdit = debounce(recompute, 250);
  row.querySelectorAll("input").forEach((i) => {
    i.addEventListener("input", onEdit);
    i.addEventListener("change", onEdit);
  });
  recompute();
}
function showRateEmpty() {
  document.getElementById("rateList").innerHTML =
    '<span class="lump-empty">No revisions — loan stays at the rate above.</span>';
}

/* ---------- utils ---------- */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function syncPair(numId, rangeId) {
  const num = document.getElementById(numId);
  const rng = document.getElementById(rangeId);
  num.addEventListener("input", () => { rng.value = num.value; recompute(); });
  rng.addEventListener("input", () => { num.value = rng.value; recompute(); });
}

/* ---------- shareable scenarios (encoded in URL hash) ---------- */
const v = (id) => document.getElementById(id).value;

function serializeState() {
  const lumps = [...document.querySelectorAll("#lumpList .lump-row")].map((r) => ({
    a: r.querySelector(".lump-amount").value, m: r.querySelector(".lump-month").value,
  }));
  const rates = [...document.querySelectorAll("#rateList .rate-row")].map((r) => ({
    v: r.querySelector(".rate-value").value, m: r.querySelector(".rate-month").value,
  }));
  return {
    p: v("principal"), r: v("rate"), t: v("tenure"), sd: v("startDate"),
    ce: v("customEmi"), sa: v("sanctioned"),
    em: v("extraMonthly"), ey: v("extraYearly"), ym: v("yearlyMonth"), su: v("stepup"),
    st: document.querySelector('input[name="strategy"]:checked').value,
    rb: document.querySelector('input[name="rateBehavior"]:checked').value,
    cur: document.getElementById("currency").value,
    lumps, rates,
  };
}

function applyState(s) {
  const set = (id, val) => { if (val !== undefined && val !== null) document.getElementById(id).value = val; };
  set("principal", s.p); set("principal_r", s.p);
  set("rate", s.r); set("rate_r", s.r);
  set("tenure", s.t); set("tenure_r", s.t);
  set("startDate", s.sd); set("customEmi", s.ce); set("sanctioned", s.sa);
  set("extraMonthly", s.em); set("extraYearly", s.ey); set("yearlyMonth", s.ym); set("stepup", s.su);

  const radio = (name, val) => {
    const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  };
  if (s.st) radio("strategy", s.st);
  if (s.rb) radio("rateBehavior", s.rb);
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.classList.toggle("active", seg.querySelector("input").checked));

  if (s.cur !== undefined) {
    const sel = document.getElementById("currency");
    sel.value = s.cur;
    const opt = sel.selectedOptions[0];
    if (opt) { CUR = opt.value; LOCALE = opt.dataset.locale; }
    document.querySelectorAll("[data-cur]").forEach((el) => (el.textContent = CUR));
  }

  document.getElementById("lumpList").innerHTML = "";
  (s.lumps || []).forEach((l) => addLumpRow(l.a, l.m));
  if (!(s.lumps && s.lumps.length)) showLumpEmpty();

  document.getElementById("rateList").innerHTML = "";
  (s.rates || []).forEach((rc) => addRateRow(rc.v, rc.m));
  if (!(s.rates && s.rates.length)) showRateEmpty();

  recompute();
}

function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2400);
}

// Save the whole scenario to a downloadable .json file.
function saveScenario() {
  const data = JSON.stringify({ _app: "home-loan-calculator", _v: 1, ...serializeState() }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `home-loan-scenario-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("💾 Scenario saved to your downloads");
}

// Restore a scenario from an uploaded .json file.
function loadScenarioFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyState(JSON.parse(reader.result));
      toast("📂 Scenario loaded — “" + file.name + "”");
    } catch (e) {
      console.warn("Could not read scenario file:", e);
      toast("⚠️ That file isn’t a valid scenario");
    }
  };
  reader.readAsText(file);
}

/* ---------- init ---------- */
function init() {
  // default start month = current month
  const now = new Date();
  document.getElementById("startDate").value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  syncPair("principal", "principal_r");
  syncPair("rate", "rate_r");
  syncPair("tenure", "tenure_r");

  ["extraMonthly", "extraYearly", "stepup", "customEmi", "sanctioned"].forEach((id) =>
    document.getElementById(id).addEventListener("input", debounce(recompute, 250)));
  ["yearlyMonth", "startDate"].forEach((id) =>
    document.getElementById(id).addEventListener("change", recompute));

  // segmented controls (prepayment strategy + rate-revision behavior)
  document.querySelectorAll('input[name="strategy"], input[name="rateBehavior"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      document.querySelectorAll(".seg").forEach((s) =>
        s.classList.toggle("active", s.querySelector("input").checked));
      recompute();
    });
  });

  document.getElementById("addLump").addEventListener("click", () => addLumpRow());
  document.getElementById("addRate").addEventListener("click", () => addRateRow());
  document.getElementById("yearlyView").addEventListener("change", () => renderTable(lastPrep));
  document.getElementById("exportCsv").addEventListener("click", exportCsv);
  document.getElementById("saveBtn").addEventListener("click", saveScenario);
  document.getElementById("loadBtn").addEventListener("click", () =>
    document.getElementById("loadFile").click());
  document.getElementById("loadFile").addEventListener("change", (e) => {
    if (e.target.files[0]) loadScenarioFile(e.target.files[0]);
    e.target.value = ""; // allow re-loading the same file
  });

  // currency
  const curSel = document.getElementById("currency");
  curSel.addEventListener("change", () => {
    const opt = curSel.selectedOptions[0];
    CUR = opt.value;
    LOCALE = opt.dataset.locale;
    document.querySelectorAll("[data-cur]").forEach((el) => (el.textContent = CUR));
    recompute();
  });

  // reset
  document.getElementById("reset").addEventListener("click", () => {
    document.getElementById("principal").value = "";
    document.getElementById("principal_r").value = document.getElementById("principal_r").min;
    document.getElementById("rate").value = "";
    document.getElementById("rate_r").value = document.getElementById("rate_r").min;
    document.getElementById("tenure").value = "";
    document.getElementById("tenure_r").value = document.getElementById("tenure_r").min;
    document.getElementById("extraMonthly").value = 0;
    document.getElementById("extraYearly").value = 0;
    document.getElementById("stepup").value = 0;
    document.getElementById("customEmi").value = "";
    document.getElementById("sanctioned").value = "";
    document.querySelector('input[name="strategy"][value="tenure"]').checked = true;
    document.querySelector('input[name="rateBehavior"][value="tenure"]').checked = true;
    document.querySelectorAll(".seg").forEach((s) =>
      s.classList.toggle("active", s.querySelector("input").checked));
    showLumpEmpty();
    showRateEmpty();
    recompute();
  });

  showLumpEmpty();
  showRateEmpty();
  recompute();
}

document.addEventListener("DOMContentLoaded", init);
