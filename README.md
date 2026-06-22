# LoanLens

A fast, private, **fully client-side** home-loan calculator. Model your EMI, see the
full amortization schedule, and compare every prepayment and interest-rate scenario
with interactive charts. Nothing you type ever leaves your browser.

🔗 **Live:** https://sabujghosh.github.io/loanlens/

## Why this exists

Most online loan calculators — including the ones banks provide — fall short in two
frustrating ways: they **demand a lot of personal information** (logins, phone numbers,
email, sometimes ID) just to run a few numbers, and they **leave out the adjustments
that actually matter** when you're managing a real loan.

LoanLens is the opposite by design:

- **Nothing personal, ever.** It runs entirely in your browser — no account, no tracking,
  no server. Your figures never leave the page. Save and reload scenarios as a local file
  that only you hold.
- **All the levers, in one place.** Prepayments (reduce tenure *or* reduce EMI, lump sums,
  monthly/yearly extra, step-up EMI), floating interest-rate revisions, an EMI fixed on a
  higher *sanctioned* amount than you actually drew, true daily-reducing-balance interest,
  and a full exportable schedule — the things bank tools usually skip.

## Features

- **EMI & amortization** on a **daily reducing-balance** basis (actual days per month ÷ 365),
  so a 28-day February accrues less interest than a 31-day March.
- **Prepayment options**, combinable:
  - Extra every month
  - Extra once a year (choose the month)
  - One-time lump sums (any number, on any date)
  - Step-up EMI (raise EMI by *x*% every year)
  - Strategy toggle: **reduce tenure** (keep EMI) or **reduce EMI** (keep tenure)
- **Floating / variable interest rate**: add rate revisions effective from any month,
  and choose how the lender handles each — keep EMI (tenure flexes) or reset EMI.
- **Fixed / custom EMI**: model the case where your EMI was fixed on a higher
  *sanctioned* amount than you actually drew (the surplus acts as an auto-prepayment).
- **Charts**: outstanding balance, interest-vs-payment, EMI over time (with rate-change
  markers), and yearly principal/interest split.
- **Save / Load**: download your scenario as a `.json` file and reload it later — no
  accounts, no cloud.
- **CSV export** of the full schedule (including the day count per instalment).
- Multi-currency formatting (₹ / $ / £ / €).

## Usage

It's a static site — no build step, no dependencies to install. Just open it:

```bash
xdg-open index.html      # Linux
open index.html          # macOS
```

Charts use [Chart.js](https://www.chartjs.org/), loaded from the jsDelivr CDN, so an
internet connection is needed the first time for charts to appear. The calculator
itself (numbers, schedule, CSV export) works fully offline — only the charts need the
CDN.

### Optional: fully offline / no third-party requests

If you prefer zero external requests, download Chart.js once and switch the script tag
in `index.html` from the CDN URL to a local path:

```bash
mkdir -p vendor
curl -fsSL https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js \
  -o vendor/chart.umd.min.js
# then in index.html, replace the cdn.jsdelivr.net <script src> with: vendor/chart.umd.min.js
```

The app already degrades gracefully: if Chart.js fails to load, every chart box shows a
short note and the rest keeps working.

## Deploy to GitHub Pages

1. Create a repo and push these files (including `vendor/chart.umd.min.js`).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick `main` / `root`, save. Your site goes live at the URL above.

## Privacy & security

- 100% client-side: no backend, no cookies, no `localStorage`, no analytics. Your loan
  details stay in the page (and in any file you choose to save) — they are never sent
  anywhere.
- The only external request is loading the Chart.js library from the jsDelivr CDN; no
  data is transmitted with it. (Vendor it locally — see above — for zero external
  requests.)
- A `Content-Security-Policy` is set in the page, restricting scripts to this site plus
  the Chart.js CDN and blocking framing, plugins, and other origins.
- Uploaded scenario files are parsed as data and inserted via DOM properties (never as
  HTML), so a malformed/malicious file cannot inject scripts.

## Disclaimer

All figures are estimates for planning only. EMI uses the standard monthly formula;
real lenders vary in rounding, day-count conventions, and broken-period interest.
Always confirm exact numbers with your lender.

## License

[MIT](LICENSE)
