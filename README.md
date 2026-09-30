# Expense Tracker & FIRE Planner

A private expense tracker and FIRE (Financial Independence, Retire Early) calculator. It runs in the browser,
on a Mac or as an app on your iPhone. Your data stays on the device you use it on. Statements are read there,
nothing is uploaded, and there are no accounts or outside scripts.

## Start it

**Easiest:** double-click `start.command` in this folder. A Terminal window opens and the app opens in your browser.
Keep that Terminal window open while you use the app. Close it when you're done.

(The first time, macOS may say it can't verify the file. If so, right-click `start.command` → **Open** → **Open**.)

**Or from Terminal:**

```bash
cd ~/Documents/expense-tracker
python3 serve.py
```

Then open <http://localhost:8000>.

> Always use `http://localhost:8000`, not `127.0.0.1:8000` or a different port.
> The browser stores your data per address, so a different address shows an empty app.

## Using it

1. **Import:** choose a statement on the Import tab.
   - **Revolut** (CSV) and **OTP Bank** (Excel .xlsx) are read automatically. Currency exchanges and moves
     between your own accounts are kept but not counted as spending. Pending rows are skipped until they go through.
   - **Other banks:** export CSV, check the column guesses and the preview, then import. The app remembers the settings.
   - Re-importing an overlapping file skips transactions you already have.
   - Cash and anything else not in a statement: **Transactions → + Add cash**.
2. **Transactions:** fix any categories. When you change one, the app offers to make a rule so similar
   transactions (and future imports) get the same category. After an import, **Review them →** shows the ones
   that need a category, and new people's names are listed so you can make a rule for them.
   Tap **✎** on a transaction to:
   - **Split** it between categories (e.g. a cash withdrawal: part poker, part fee, the rest cash).
   - Mark it (or one part) **one-off**: a bonus, a big purchase. It stays in the totals but is left out of
     averages, budgets, warnings and FIRE, so one unusual month doesn't skew them.
   - Link money someone paid you back to what it **pays back** (spending from the two months before).
     It then reduces that spending, in the month it was spent, instead of counting as income.
   - Add a **note**.
3. **Dashboard:**
   - **Overview:** spending by category, income vs spending, savings rate, net worth and your **goals** (like an
     emergency fund: how far along, and how many months to go at your recent saving). A **Heads up** card
     warns when a category is over budget, heading over it, or heading at least 30% and €25 above your usual
     (the last three months, without one-offs). Categories you don't pay every month, like bills every two
     months, are compared with your biggest recent month instead.
   - **Budgets:** a monthly amount per category. **Use suggestions** fills them from your last three months;
     change any of them. "Heading for" takes into account what's usually paid later in the month, so rent on the 1st
     doesn't look like overspending.
   - **Regular:** payments found automatically: the same payee charging about the same amount about once a
     month (subscriptions, phone, the mortgage). Shows the monthly total, when each is next due and price rises.
   - **Your flat** (shown when your setup has a property): rent received against its costs, in its own currency.
     Mortgage payments are split into interest and fees (a cost) and principal (paid off the loan, not a cost).
     Two-month periods line up bills that come every two months. The flat's result also counts in your
     overall totals and FIRE.
4. **Accounts:** what you have and owe. Bank balances come from your latest statement plus later transactions.
   Type in what statements don't show: cash in hand (**Count my cash**), investment values (profit is
   value + withdrawals − deposits − value at the start), the flat's value. Loans are estimated from the rate
   and payments. Bank, cash and investments are your FIRE savings; the flat and its loan are only in net worth.
   **Goals** are set here: an amount, and which accounts count towards it (bank accounts and cash unless you choose).
5. **FIRE:** savings come from Accounts, spending and income from your transactions (without one-offs), unless
   you type your own. With a flat, its rent keeps paying part of your spending after you retire (untick it if you'd
   sell it or move in), so you need less invested. The mortgage comes out of your income until it ends, then that
   money is invested too; if it isn't paid off by then, the FIRE number includes enough to pay it off.
   Use the sliders to try "what if" changes. This is a calculator based on your assumptions, not financial advice.

**Cash:** a withdrawal counts as spending in the Cash category. If you log what you spent it on (**+ Add cash**,
account "Cash"), it moves from Cash to that category, so nothing is counted twice.

**Currencies:** totals are in your main currency (Settings). Foreign amounts are converted with the rate from
your own nearest currency exchange, or the rate you type in Settings when there isn't one close by.
The switch at the top shows amounts in another currency, or **Original** for each transaction as the bank showed it.

**Personal setup:** your own categories, rules (people, local places), rates and accounts can live in a separate
file instead of the app's code. **Settings → Load setup file** adds them; **Download my setup** saves a fresh copy.
Keep that file outside this folder so it's never published with the app. Besides categories and rules it can have:

```json
{
  "format": "expense-tracker-setup",
  "accounts": [
    { "name": "My flat", "type": "property", "currency": "HUF", "value": 30000000, "group": "My flat" },
    { "name": "Mortgage", "type": "loan", "currency": "HUF", "principal": 10000000, "ratePercent": 3, "years": 25,
      "payment": 48000, "firstPayment": "2026-01-10", "balance": -9977578, "asOf": "2026-01-10", "category": "My flat / Mortgage" },
    { "name": "Broker", "type": "investment", "currency": "USD", "match": "BROKER", "initial": 1000, "initialDate": "2026-01-01" }
  ],
  "budgets": { "Groceries": 300 },
  "goals": [{ "name": "Emergency fund", "target": 5000 }]
}
```

The flat's categories are the ones whose group (`parent`) is the property's `group`. The loan's `balance` is what
was owed right after the payment on `asOf`; payments in its `category` are split into interest and principal.
Values you type on the Accounts tab are kept when you load the file again.

`sample-data/` has fake bank files for practising. To start fresh before importing your real files:
**Settings → Delete all data**.

## Back up your data

Your data lives in this browser's storage. Clearing browser data, or using a different browser, means it won't be there.
Use **Settings → Download backup** now and then. Keep the file somewhere safe, since it contains your transactions.
**Restore from backup** brings it all back.

## On your iPhone

The app needs to be on a web address your phone can reach. The code is published, but your data isn't:
it stays in the phone's browser storage, and statements are read on the phone.

1. **Publish the app** (once, and again after changes) with a free GitHub account:
   - On github.com: **+** → **New repository**, name it `expense-tracker`, **Public**, **Create repository**.
   - Click **uploading an existing file** and drag in the contents of this folder: `index.html`, `tests.html`,
     `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md` and the `js`, `icons` and `sample-data` folders.
     Not your personal setup file, statements or backups. **Commit changes**.
   - **Settings → Pages**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**, **Save**.
     After a minute or two it's at `https://<your-username>.github.io/expense-tracker/`.
   - To update later: **Add file → Upload files** and drag in the changed files; they replace the old ones.
   - Or with **GitHub Desktop**: **File → Add Local Repository**, choose this folder, then **create a repository**
     here. Commit, **Publish repository** with **Keep this code private** unticked, then turn on Pages as above.
     Later changes: commit, then **Push origin**. `.gitignore` keeps statements, backups, setup files and other
     `.json`/`.csv`/`.xlsx` files out (only the fake files in `sample-data/` are included).
   A free GitHub Pages site and its repository are public, so nothing personal belongs in the repository.
2. **On the iPhone**, open that address in **Safari** → **Share** → **Add to Home Screen**. It opens like an app
   and works offline.
3. **Load your setup:** save your setup file to the Files app (AirDrop, iCloud Drive), then
   **Settings → Load setup file**.
4. **Import statements:** download them in the Revolut / OTP apps or websites, save to Files, then **Import**.

Data in the Home Screen app is separate from Safari's, so import there. Download a backup to Files now and then.
iOS can remove data of web apps you haven't opened for weeks. The app asks it not to, but a backup is the safe copy.

## Tests

With the app running, open <http://localhost:8000/tests.html>. It should say "All tests passed".

## What's inside

| File | What it does |
|---|---|
| `index.html`, `styles.css` | The page and its look (dark mode, phone layout) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable on a phone and work offline |
| `js/app.js` | Switches between tabs, the currency switch |
| `js/storage.js` | Saves data in the browser, backups |
| `js/csv.js`, `js/xlsx.js`, `js/importer.js` | Reads CSV and Excel files, guesses columns, skips duplicates |
| `js/banks.js` | Reads Revolut and OTP statements without any setup |
| `js/currency.js` | Exchange rates and showing amounts in other currencies |
| `js/setup.js` | Loads and saves your personal setup file |
| `js/categorize.js` | Categories and keyword rules |
| `js/ledger.js` | Splits, paybacks, cash and loan payments: turns transactions into the parts that are counted |
| `js/stats.js` | Monthly totals and savings rate |
| `js/budgets.js` | Budget suggestions and warnings |
| `js/accounts.js` | Account balances, investment profit, net worth, goals |
| `js/recurring.js` | Finds regular monthly payments |
| `js/fire.js` | FIRE maths |
| `js/charts.js` | The charts |
| `js/*-view.js` | One file per tab or section |
| `serve.py`, `start.command` | Run the app locally |
