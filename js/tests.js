// Tests for the logic modules. Open tests.html to run them.

import { detectDelimiter, parseCSV } from './csv.js';
import { guessDateFormat, guessMapping, mapRows, mergeTransactions, parseAmount, parseDate, withKeys } from './importer.js';
import { applyAllRules, applyRule, categorize, DEFAULT_RULES, groupCategories, matchesKeyword, shortName, suggestKeyword } from './categorize.js';
import { parseOtp, parseRevolut, parseStatement } from './banks.js';
import { moneyFormatter, rateFor, reconvert, transactionDisplay } from './currency.js';
import { importStatement } from './importer.js';
import { applySetup, exportSetup, parseSetup } from './setup.js';
import { defaultState } from './storage.js';
import { excelSerialToDate, readXlsx } from './xlsx.js';
import { describeMonths, fireNumber, monthsToTarget, projectBalances, runScenario, savingsRate } from './fire.js';
import { flatAverages, monthlySummary, recentAverages } from './stats.js';
import { regularPayments } from './recurring.js';
import { DEFAULT_CATEGORIES, needsReview, personName } from './categorize.js';
import { annuity, loanPayment, loanStatus, paybackCandidates, repaidAmounts, transactionParts } from './ledger.js';
import { monthStatus, suggestBudgets } from './budgets.js';
import { accountList, flatSetup, goalProgress, investmentFlows, netWorth } from './accounts.js';

const results = [];
const running = [];
function test(name, fn) {
  const record = (ok, err) => results.push({ name, ok, error: err?.message });
  try {
    const out = fn();
    if (out instanceof Promise) running.push(out.then(() => record(true), (err) => record(false, err)));
    else record(true);
  } catch (err) {
    record(false, err);
  }
}
const load = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error(`Couldn't load ${path}`);
  return r;
});
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}
function close(actual, expected, tolerance, label = '') {
  if (!(Math.abs(actual - expected) <= tolerance)) throw new Error(`${label} expected ≈${expected}, got ${actual}`);
}

// ---- CSV ----
test('CSV: simple rows', () => eq(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]));
test('CSV: quoted comma, escaped quote, newline in quotes', () =>
  eq(parseCSV('x,"a, b","say ""hi""","two\nlines"'), [['x', 'a, b', 'say "hi"', 'two\nlines']]));
test('CSV: CRLF, BOM and blank lines', () => eq(parseCSV('\uFEFFa,b\r\n\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]));
test('CSV: semicolon detected', () => {
  eq(detectDelimiter('Date;Details;Amount'), ';');
  eq(parseCSV('a;"b;c"\n1;2'), [['a', 'b;c'], ['1', '2']]);
});
test('CSV: tab detected', () => eq(detectDelimiter('a\tb\tc'), '\t'));

// ---- amounts & dates ----
test('Amount: US formats', () => {
  eq(parseAmount('$1,234.56'), 1234.56);
  eq(parseAmount('-12.30'), -12.3);
  eq(parseAmount('(45.00)'), -45);
  eq(parseAmount('12.30-'), -12.3);
  eq(parseAmount('-$5'), -5);
  eq(parseAmount('1,234'), 1234);
});
test('Amount: European formats', () => {
  eq(parseAmount('1.234,56'), 1234.56);
  eq(parseAmount('12,5'), 12.5);
  eq(parseAmount('-3.250,00 €'), -3250);
});
test('Amount: empty or text is NaN', () => {
  eq(Number.isNaN(parseAmount('')), true);
  eq(Number.isNaN(parseAmount('n/a')), true);
});
test('Date: formats and validation', () => {
  eq(parseDate('2026-09-27', 'YMD'), '2026-09-27');
  eq(parseDate('09/27/2026', 'MDY'), '2026-09-27');
  eq(parseDate('27.09.2026', 'DMY'), '2026-09-27');
  eq(parseDate('27/09/26', 'DMY'), '2026-09-27');
  eq(parseDate('2026-09-27 10:15:00', 'YMD'), '2026-09-27');
  eq(parseDate('02/30/2026', 'MDY'), null);
  eq(parseDate('13/27/2026', 'MDY'), null);
});

test('Date: guesses ambiguous formats from how close the dates are', () => {
  eq(guessDateFormat(['09/03/2026', '09/05/2026', '09/12/2026']), 'MDY');
  eq(guessDateFormat(['03/09/2026', '05/09/2026', '12/09/2026']), 'DMY');
  eq(guessDateFormat(['03.09.2026']), 'DMY');
  eq(guessDateFormat(['2026-09-03']), 'YMD');
});

// ---- column mapping ----
const usRows = parseCSV('Date,Description,Amount,Balance\n09/25/2026,SHELL OIL,-39.02,100\n09/15/2026,ACME PAYROLL,2650.00,139.02\n09/13/2026,"AMAZON.COM, SEATTLE",-20.00,-');
test('Mapping: guesses a US bank file', () => {
  const m = guessMapping(usRows);
  eq([m.hasHeader, m.date, m.description, m.amountMode, m.amount, m.dateFormat], [true, 0, 1, 'single', 2, 'MDY']);
});
test('Mapping: guesses split money out / money in columns', () => {
  const rows = parseCSV('Booking date;Details;Money out;Money in\n03.09.2026;LIDL;23,45;\n05.09.2026;Salary;;3.250,00');
  const m = guessMapping(rows);
  eq([m.amountMode, m.debit, m.credit, m.dateFormat], ['split', 2, 3, 'DMY']);
  eq(mapRows(rows, m).rows.map((r) => r.amount), [-23.45, 3250]);
});
test('Mapping: prefers "Description" over "Details"', () => {
  const m = guessMapping(parseCSV('Details,Posting Date,Description,Amount\nDEBIT,09/25/2026,SHELL,-3.00'));
  eq([m.description, m.date], [2, 1]);
});
test('Mapping: flip signs', () => {
  const m = { ...guessMapping(usRows), invert: true };
  eq(mapRows(usRows, m).rows[0].amount, 39.02);
});
test('Mapping: positive amounts with a Type column', () => {
  const rows = parseCSV('Date,Description,Category,Type,Amount\n2026-04-01,Rent,Housing,Expense,1400.00\n2026-04-01,Salary,Income,Income,4000.00\n2026-04-02,Refund,Other,Credit,5');
  const m = guessMapping(rows);
  eq([m.amountMode, m.amount, m.type], ['typed', 4, 3]);
  eq(mapRows(rows, m).rows.map((r) => r.amount), [-1400, 4000, 5]);
});
test('Mapping: signed amounts ignore a DEBIT/CREDIT column', () => {
  const rows = parseCSV('Details,Posting Date,Description,Amount\nDEBIT,09/25/2026,SHELL,-3.00\nCREDIT,09/26/2026,PAYROLL,100');
  eq(guessMapping(rows).amountMode, 'single');
});
test('Mapping: unknown money in/out value is reported', () => {
  const rows = parseCSV('Date,Description,Type,Amount\n2026-04-01,Rent,Expense,1400\n2026-04-02,Move,Transfer,50');
  const r = mapRows(rows, { hasHeader: true, date: 0, description: 1, amount: 3, type: 2, amountMode: 'typed', dateFormat: 'YMD' });
  eq(r.rows.map((x) => x.amount), [-1400]);
  eq(r.errors.map((e) => e.line), [3]);
});
test('Mapping: bad rows are reported, not imported', () => {
  const rows = parseCSV('Date,Description,Amount\n2026-09-01,OK,-1\nnot a date,X,-2\n2026-09-02,Y,abc');
  const r = mapRows(rows, { hasHeader: true, date: 0, description: 1, amount: 2, amountMode: 'single', dateFormat: 'YMD' });
  eq(r.rows.length, 1);
  eq(r.errors.map((e) => e.line), [3, 4]);
});

// ---- duplicates ----
test('Duplicates: re-importing the same rows adds nothing', () => {
  const rows = [
    { date: '2026-05-11', description: 'STARBUCKS', amount: -4.85 },
    { date: '2026-05-11', description: 'STARBUCKS', amount: -4.85 },
    { date: '2026-05-12', description: 'LIDL', amount: -20 },
  ];
  const existing = [];
  eq(mergeTransactions(existing, rows, DEFAULT_RULES), { added: 3, skipped: 0 }, 'first import');
  eq(mergeTransactions(existing, rows, DEFAULT_RULES), { added: 0, skipped: 3 }, 'second import');
  eq(existing.length, 3);
});
test('Duplicates: overlapping export only adds the new ones', () => {
  const existing = [];
  mergeTransactions(existing, [{ date: '2026-05-11', description: 'A', amount: -1 }], DEFAULT_RULES);
  eq(mergeTransactions(existing, [
    { date: '2026-05-11', description: 'A', amount: -1 },
    { date: '2026-05-12', description: 'B', amount: -2 },
  ], DEFAULT_RULES), { added: 1, skipped: 1 });
});
test('Duplicates: two identical same-day purchases get different keys', () => {
  const [a, b] = withKeys([{ date: '2026-01-01', description: 'X', amount: -1 }, { date: '2026-01-01', description: 'X', amount: -1 }]);
  eq(a.key === b.key, false);
});

// ---- categories ----
test('Categorize: default rules', () => {
  eq(categorize('NETFLIX.COM 866-579-7172 CA', -15.49, DEFAULT_RULES), 'Subscriptions');
  eq(categorize('UBER EATS', -20, DEFAULT_RULES), 'Dining Out');
  eq(categorize('UBER TRIP', -20, DEFAULT_RULES), 'Transport');
  eq(categorize('ACME CORP PAYROLL', 2650, DEFAULT_RULES), 'Salary');
  eq(categorize('PLANET FITNESS', -24.99, DEFAULT_RULES), 'Uncategorized');
  eq(categorize('IRS TAX REF', 100, DEFAULT_RULES), 'Other Income');
  eq(categorize('TESCO STORES 3321', -30, DEFAULT_RULES), 'Groceries');
  eq(categorize('eToro Money', -500, DEFAULT_RULES), 'Investments');
});
test('Rules: amount and direction beat a plain keyword', () => {
  const rules = [
    { match: 'LANDLORD SAMPLE', category: 'Utilities' },
    { match: 'LANDLORD SAMPLE', category: 'Housing', amount: 1350, sign: 'out' },
    { match: 'ALEX', category: 'Other Income', sign: 'in' },
    { match: 'ALEX', category: 'Dining Out', sign: 'out' },
  ];
  eq(categorize('To Landlord Sample', -1350, rules), 'Housing');
  eq(categorize('To Landlord Sample', -80.4, rules), 'Utilities');
  eq(categorize('To Landlord Sample', 1350, rules), 'Utilities', 'money in');
  eq(categorize('From Alex Example', 20, rules), 'Other Income');
  eq(categorize('To Alex Example', -12, rules), 'Dining Out');
});
test('Rules: re-applying leaves hand-set and bank-set categories', () => {
  const list = [
    { description: 'CORNER CAFE', amount: -4, category: 'Uncategorized' },
    { description: 'CORNER CAFE', amount: -4, category: 'Gifts', manual: true },
    { description: 'CORNER CAFE fee', amount: -1, category: 'Bank fees', fromBank: true },
  ];
  eq(applyAllRules(list, [{ match: 'CORNER CAFE', category: 'Dining Out' }]), 1);
  eq(list.map((t) => t.category), ['Dining Out', 'Gifts', 'Bank fees']);
});
test('Categories: grouped under their parent', () => {
  const cats = [{ name: 'Food', type: 'expense' }, { name: 'Flat', type: 'expense' }, { name: 'Flat / Repairs', type: 'expense', parent: 'Flat' }];
  eq(groupCategories(cats).map((g) => [g.label, g.categories.map((c) => c.name)]), [[null, ['Food']], ['Flat', ['Flat', 'Flat / Repairs']]]);
  eq(shortName(cats[2]), 'Repairs');
});
test('Categorize: keyword matches at word start only', () => {
  eq(matchesKeyword('RENT PAYMENT', 'RENT'), true);
  eq(matchesKeyword('CURRENT ACCOUNT FEE', 'RENT'), false);
  eq(matchesKeyword("TRADER JOE'S #552", 'TRADER JOE'), true);
});
test('Categorize: suggested keyword', () => {
  eq(suggestKeyword('NETFLIX.COM 866-579-7172 CA'), 'NETFLIX.COM');
  eq(suggestKeyword('PLANET FITNESS'), 'PLANET FITNESS');
});
test('Rules: applying skips hand-set categories', () => {
  const list = [
    { description: 'PLANET FITNESS', category: 'Uncategorized', manual: false },
    { description: 'PLANET FITNESS', category: 'Entertainment', manual: true },
  ];
  eq(applyRule(list, { match: 'PLANET FITNESS', category: 'Health' }), 1);
  eq(list.map((t) => t.category), ['Health', 'Entertainment']);
});

// ---- monthly stats ----
test('Stats: monthly income, spending, transfers ignored, refunds reduce spending', () => {
  const tx = [
    { date: '2026-01-05', amount: 3000, category: 'Salary' },
    { date: '2026-01-06', amount: -1000, category: 'Housing' },
    { date: '2026-01-07', amount: -500, category: 'Transfers' },
    { date: '2026-01-08', amount: -100, category: 'Shopping' },
    { date: '2026-01-09', amount: 40, category: 'Shopping' },
    { date: '2026-03-01', amount: -60, category: 'Groceries' },
  ];
  const s = monthlySummary(tx, DEFAULT_CATEGORIES);
  eq(s.map((m) => m.month), ['2026-01', '2026-02', '2026-03'], 'empty February filled in');
  eq([s[0].income, s[0].spending, s[0].byCategory.Shopping], [3000, 1060, 60]);
  close(s[0].savingsRate, (3000 - 1060) / 3000, 1e-9);
  eq(s[1].savingsRate, null, 'no income');
});
test('Stats: averages skip the month in progress', () => {
  const s = [
    { month: '2026-07', income: 5000, spending: 3000 },
    { month: '2026-08', income: 5000, spending: 4000 },
    { month: '2026-09', income: 0, spending: 100 },
  ];
  eq(recentAverages(s, new Date(2026, 8, 27)), { monthlyIncome: 5000, monthlySpending: 3500, monthsUsed: 2 });
});

// ---- FIRE ----
test('FIRE number: $40k/yr at 4% is $1,000,000', () => eq(fireNumber(40000, 4), 1000000));
test('FIRE number: 3.5% is ~28.6×', () => close(fireNumber(40000, 3.5), 1142857.14, 0.01));
test('Savings rate', () => {
  eq(savingsRate(5000, 3000), 0.4);
  eq(savingsRate(0, 100), null);
});
test('Months to target: no growth is simple division', () =>
  eq(monthsToTarget({ savings: 0, monthlyContribution: 1000, annualReturnPct: 0, target: 12000 }), 12));
test('Months to target: already there', () =>
  eq(monthsToTarget({ savings: 1e6, monthlyContribution: 0, annualReturnPct: 5, target: 5e5 }), 0));
test('Months to target: never when not saving', () =>
  eq(monthsToTarget({ savings: 1000, monthlyContribution: -10, annualReturnPct: 0, target: 1e6 }), null));
test('Projection matches the compound-interest formula', () => {
  const r = Math.pow(1.05, 1 / 12) - 1;
  const expected = 1000 * (Math.pow(1 + r, 120) - 1) / r;
  const points = projectBalances({ savings: 0, monthlyContribution: 1000, annualReturnPct: 5, years: 10 });
  eq(points.length, 11);
  close(points[10], expected, 0.01);
  close(points[10], 154000, 1000, 'sanity');
});
test('Scenario: $60k income, $40k spend, $100k saved, 5%, 4%', () => {
  const s = runScenario({ annualIncome: 60000, annualSpending: 40000, savings: 100000, annualReturnPct: 5, withdrawalRatePct: 4 });
  eq(s.target, 1000000);
  close(s.monthlyContribution, 1666.67, 0.01);
  close(s.savingsRate, 1 / 3, 1e-9);
  // Check against the projection: reached in that month, not the month before.
  const before = projectBalances({ savings: 100000, monthlyContribution: s.monthlyContribution, annualReturnPct: 5, years: Math.ceil(s.months / 12) });
  eq(s.months > 12 * 18 && s.months < 12 * 22, true, `${s.months} months`);
  eq(before[before.length - 1] >= 1000000, true);
});
test('Describe months', () => {
  eq(describeMonths(150), '12 years 6 months');
  eq(describeMonths(12), '1 year');
  eq(describeMonths(0), 'Already there');
  eq(describeMonths(null), 'Not reachable');
});

// ---- bank statements (fake sample files in sample-data/) ----
const revolut = load('sample-data/sample-revolut.csv').then((r) => r.text()).then((text) => parseRevolut(parseCSV(text), 'EUR'));
const byDescription = (parsed, d) => parsed.rows.filter((r) => r.description === d);

test('Revolut: completed rows only, pending and reverted counted', async () => {
  const parsed = await revolut;
  eq(parsed.bank, 'Revolut');
  eq(parsed.rows.length, 13);
  eq(parsed.skipped, { pending: 1, other: 1 });
  eq(parsed.errors, []);
});
test('Revolut: fee comes off the amount; ATM is Cash, plan fee is Bank fees', async () => {
  const parsed = await revolut;
  const [atm] = byDescription(parsed, 'Cash at Example ATM');
  eq([atm.originalAmount, atm.category, atm.date], [-51, 'Cash', '2026-07-12']);
  eq(byDescription(parsed, 'Metal plan fee')[0].category, 'Bank fees');
});
test('Revolut: exchanges and savings moves are internal; exchange fee is its own row', async () => {
  const parsed = await revolut;
  for (const d of ['Exchanged to HUF', 'Exchanged from EUR', 'To EUR Savings', 'From EUR Current']) eq(byDescription(parsed, d)[0].category, 'Transfers', d);
  eq(byDescription(parsed, 'Exchanged to HUF (fee)').map((r) => [r.originalAmount, r.category]), [[-0.5, 'Bank fees']]);
  eq(byDescription(parsed, 'To Alex Example')[0].category, undefined, 'a payment to a person follows your rules');
});
test('Revolut: interest is net of tax; a refund with no rule stays a refund', async () => {
  const parsed = await revolut;
  const [interest] = byDescription(parsed, 'Net Interest Paid');
  eq([interest.originalAmount, interest.category, interest.account], [0.96, 'Interest', 'Revolut Savings EUR']);
  const refund = byDescription(parsed, 'Corner Cafe').find((r) => r.originalAmount > 0);
  eq(refund.fallbackCategory, 'Uncategorized');
});
test('Revolut: exchange rate and latest balances', async () => {
  const parsed = await revolut;
  eq(parsed.exchanges, [{ key: 'revolut|2026-07-05 10:00:00', date: '2026-07-05', currency: 'HUF', amount: 40000, baseAmount: 100 }]);
  const balances = Object.fromEntries(parsed.balances.map((b) => [b.account, b.balance]));
  eq(balances, { 'Revolut EUR': 3320.51, 'Revolut HUF': 38000, 'Revolut Savings EUR': 500.96 });
});
test('Revolut: not mistaken for OTP, other CSVs not mistaken for Revolut', async () => {
  eq((await revolut).bank, 'Revolut');
  eq(parseStatement([['Date', 'Description', 'Amount'], ['2026-01-01', 'X', '-1']], 'EUR'), null);
});

const otp = load('sample-data/sample-otp.xlsx').then((r) => r.arrayBuffer()).then(readXlsx);
test('xlsx: reads the sheet the workbook points to, skips empty rows', async () => {
  const rows = await otp;
  eq(rows.length, 10);
  eq(rows[0], ['Transaction history']);
  eq(rows[5][5], 'Transaction identifier');
  eq(rows[7][0], '', 'empty first cell keeps later columns in place');
  eq(rows[7][8], '-200000');
});
test('xlsx: Excel date numbers', () => eq(excelSerialToDate(46204), '2026-07-01'));
test('OTP: finds the table, skips pending, keys on the transaction id', async () => {
  const parsed = parseStatement(await otp, 'EUR');
  eq(parsed.bank, 'OTP');
  eq(parsed.skipped.pending, 1);
  eq(parsed.rows.map((r) => [r.date, r.description, r.originalAmount, r.account, r.key]), [
    ['2026-07-02', 'Sample Tenant – Incoming transfer – July rent', 250000, 'OTP HUF', 'otp|ID-0001'],
    ['2026-07-23', 'Example Bank – Loan repayment', -200000, 'OTP HUF', 'otp|ID-0002'],
    ['2026-07-28', 'Water Utility – Direct debit', -8500.5, 'OTP HUF', 'otp|ID-0004'],
  ]);
  eq(parseOtp([['a', 'b']]), null);
});
test('Import: foreign amounts converted with your own exchange rate; re-import adds nothing', async () => {
  const state = defaultState();
  const parsed = await revolut;
  const first = importStatement(state, parsed);
  eq([first.added, first.skipped, first.missingRates], [13, 0, []]);
  const bakery = state.transactions.find((t) => t.description === 'Budapest Bakery');
  eq([bakery.amount, bakery.originalAmount, bakery.currency, bakery.account], [-5, -2000, 'HUF', 'Revolut HUF']);
  eq(state.transactions.find((t) => t.description === 'Exchanged to HUF').fromBank, true);
  eq(state.balances['Revolut HUF'].balance, 38000);
  eq(first.newPeople, ['Alex Example']);
  const again = importStatement(state, parsed);
  eq([again.added, again.skipped, state.exchanges.length], [0, 13, 1]);
});
test('Import: a currency with no rate is flagged, then fixed by a manual rate', async () => {
  const state = defaultState();
  const result = importStatement(state, parseStatement(await otp, 'EUR'));
  eq(result.missingRates, ['HUF']);
  const water = state.transactions.find((t) => t.key === 'otp|ID-0004');
  eq([water.amount, water.unconverted], [0, true]);
  state.settings.fallbackRates.HUF = 400;
  eq(reconvert(state), []);
  eq([water.amount, water.unconverted], [-21.25, undefined]);
});

// ---- currencies ----
const context = (exchanges, fallbackRates = {}) => ({ base: 'EUR', exchanges, fallbackRates });
test('Rates: same-day exchanges weighted by size', () => {
  const x = [
    { date: '2026-08-10', currency: 'HUF', amount: 120000, baseAmount: 330.13 },
    { date: '2026-08-10', currency: 'HUF', amount: 679.21, baseAmount: 1.85 },
    { date: '2026-06-01', currency: 'HUF', amount: 100, baseAmount: 1 },
  ];
  close(rateFor('HUF', '2026-08-12', context(x)), 120679.21 / 331.98, 1e-9);
  eq(rateFor('EUR', '2026-08-12', context(x)), 1);
});
test('Rates: your manual rate beats an exchange months away', () => {
  const x = [{ date: '2026-01-01', currency: 'HUF', amount: 39000, baseAmount: 100 }];
  eq(rateFor('HUF', '2026-07-01', context(x, { HUF: 360 })), 360);
  eq(rateFor('HUF', '2026-07-01', context(x)), 390, 'no manual rate: use the old one');
  eq(rateFor('HUF', '2026-01-20', context(x, { HUF: 360 })), 390, 'close by: use the exchange');
  eq(rateFor('USD', '2026-07-01', context(x)), null);
});
test('Display: original, main and other currency', () => {
  const state = defaultState();
  state.settings.fallbackRates = { HUF: 400 };
  const t = { date: '2026-07-01', amount: -5, originalAmount: -2000, currency: 'HUF' };
  const eur = { date: '2026-07-01', amount: -10 };
  eq(transactionDisplay(state, t, 'original'), { amount: -2000, currency: 'HUF' });
  eq(transactionDisplay(state, t, 'EUR'), { amount: -5, currency: 'EUR' });
  eq(transactionDisplay(state, t, 'HUF'), { amount: -2000, currency: 'HUF' });
  eq(transactionDisplay(state, eur, 'HUF'), { amount: -4000, currency: 'HUF' });
  eq(moneyFormatter(state, 'original').currency, 'EUR', 'totals stay in the main currency');
  eq(moneyFormatter(state, 'HUF').money(10).replace(/\D/g, ''), '4000');
});

// ---- personal setup ----
test('Setup: merges categories, rules, rates and accounts; keeps transactions', () => {
  const state = defaultState();
  state.transactions.push({ id: '1', date: '2026-07-01', description: 'To Alex Example', amount: -12, category: 'Uncategorized', key: 'k1', manual: false });
  const setup = parseSetup(JSON.stringify({
    format: 'expense-tracker-setup',
    settings: { fallbackRates: { HUF: 360 } },
    categories: [{ name: 'Flat', type: 'expense' }, { name: 'Flat / Repairs', type: 'expense', parent: 'Flat' }],
    rules: [{ match: 'alex example', category: 'Dining Out', sign: 'out' }, { match: 'NOWHERE', category: 'No such category' }],
    removeRules: ['BOLT'],
    accounts: [{ name: 'Cash', currency: 'EUR', opening: 100 }],
  }));
  const counts = applySetup(state, setup);
  eq(counts, { categories: 2, rules: 1, accounts: 1, recategorised: 1 });
  eq([state.settings.currency, state.settings.fallbackRates], ['EUR', { HUF: 360 }]);
  eq(state.transactions[0].category, 'Dining Out');
  eq(state.rules.some((r) => r.match === 'BOLT'), false);
  eq(applySetup(state, setup).categories, 0, 'loading twice adds nothing new');
  eq(state.rules.filter((r) => r.match === 'ALEX EXAMPLE').length, 1);
});
test('Setup: download has no transactions and loads back', () => {
  const state = defaultState();
  state.transactions.push({ id: '1', date: '2026-07-01', description: 'X', amount: -1, category: 'Other', key: 'k' });
  const back = parseSetup(exportSetup(state));
  eq(back.transactions, undefined);
  eq(back.rules.length, state.rules.length);
  let threw = false;
  try { parseSetup('{"transactions": []}'); } catch { threw = true; }
  eq(threw, true);
});

// ---- splits, one-offs, paybacks ----
const cats = [...DEFAULT_CATEGORIES, { name: 'Poker', type: 'expense' }, { name: 'Flat', type: 'expense' },
  { name: 'Flat / Rent received', type: 'income', parent: 'Flat' }, { name: 'Flat / Mortgage', type: 'expense', parent: 'Flat' },
  { name: 'Flat / Bills', type: 'expense', parent: 'Flat' }];
const tx = (id, date, amount, category, extra = {}) => ({ id, date, description: extra.description ?? id, amount, category, key: id, manual: false, ...extra });
test('Split: parts count in their own categories, the rest stays', () => {
  const atm = tx('atm', '2026-08-02', -411.9, 'Cash', { splits: [{ amount: -150, category: 'Poker' }, { amount: -11.9, category: 'Bank fees' }] });
  const [m] = monthlySummary([atm], cats);
  eq([m.spending, m.byCategory.Cash, m.byCategory.Poker, m.byCategory['Bank fees']], [411.9, 250, 150, 11.9]);
});
test('Split: a foreign transaction splits in its own currency', () => {
  const t = tx('huf', '2026-08-02', -50, 'Shopping', { currency: 'HUF', originalAmount: -20000, splits: [{ amount: -5000, category: 'Groceries' }] });
  const [m] = monthlySummary([t], cats);
  eq([m.byCategory.Groceries, m.byCategory.Shopping], [12.5, 37.5]);
});
test('One-off: in the totals, not in averages', () => {
  const list = [
    tx('s1', '2026-07-25', 7137.54, 'Salary', { splits: [{ amount: 1700, category: 'Salary', oneOff: true }] }),
    tx('s2', '2026-08-25', 5437.54, 'Salary'),
    tx('tv', '2026-08-03', -900, 'Tech', { oneOff: true }),
    tx('food', '2026-08-04', -100, 'Groceries'),
  ];
  const summary = monthlySummary(list, cats);
  eq([summary[0].income, summary[0].regular.income], [7137.54, 5437.54]);
  eq([summary[1].spending, summary[1].regular.spending], [1000, 100]);
  const avg = recentAverages(summary, new Date(2026, 8, 15));
  eq([avg.monthlyIncome, avg.monthlySpending], [5437.54, 50]);
});
test('Payback: cancels spending in the month it was spent, the rest stays', () => {
  const dinner = tx('dinner', '2026-08-20', -80.9, 'Dining Out');
  const back = tx('back', '2026-09-02', 46, 'Other Income', { repays: ['dinner'] });
  const gadget = tx('gadget', '2026-08-10', -300, 'Sport');
  const over = tx('over', '2026-09-05', 500, 'Other Income', { repays: ['gadget'] });
  const parts = transactionParts([dinner, back, gadget, over], { categories: cats, base: 'EUR' });
  const [aug, sep] = monthlySummary(parts);
  eq([aug.byCategory['Dining Out'], aug.byCategory.Sport, aug.spending], [34.9, 0, 34.9]);
  eq(sep.income, 200);
  eq([repaidAmounts(parts).get('dinner'), repaidAmounts(parts).get('gadget')], [46, 300]);
});
test('Payback: candidates are earlier spending within two months, closest amount first', () => {
  const back = tx('back', '2026-09-02', 46, 'Other Income');
  const list = [back, tx('a', '2026-08-20', -80.9, 'Dining Out'), tx('b', '2026-08-25', -45, 'Groceries'), tx('old', '2026-06-01', -46, 'Groceries'),
    tx('later', '2026-09-10', -46, 'Groceries'), tx('move', '2026-08-30', -46, 'Transfers')];
  eq(paybackCandidates(back, list, cats).map((t) => t.id), ['b', 'a']);
});

// ---- loans ----
const loan = { name: 'Flat loan', type: 'loan', currency: 'HUF', principal: 10000000, ratePercent: 3, years: 25, firstPayment: '2026-01-10', payment: 48000, category: 'Flat / Mortgage' };
test('Loan: annuity and the first payment split', () => {
  close(annuity(100000, 4, 30), 477.42, 0.01);
  const first = loanPayment(loan, '2026-01-10');
  eq(first.interest, 25000);
  close(first.principal, 22421.5, 0.5);
  close(first.fee, 578.5, 0.5);
});
test('Loan: status from a known balance', () => {
  const anchored = { ...loan, balance: -(10000000 - 22421.5), asOf: '2026-01-10' };
  const s = loanStatus(anchored, '2026-03-15');
  eq([s.paymentsMade, s.paymentsLeft], [3, 297]);
  close(s.owed, 10000000 - 22421.5 - 22477.6 - 22533.8, 2);
  eq(loanStatus(anchored, '2026-03-09').paymentsMade, 2);
});
test('Loan: a mortgage payment counts only interest and fees as spending', () => {
  const pay = tx('pay', '2026-01-10', -120, 'Flat / Mortgage', { currency: 'HUF', originalAmount: -48000 });
  const [m] = monthlySummary([pay], cats, { accounts: [loan], base: 'EUR' });
  close(m.spending, 63.95, 0.01);
  close(m.principal, 56.05, 0.01);
  const early = tx('early', '2025-12-01', -120, 'Flat / Mortgage', { currency: 'HUF', originalAmount: -48000 });
  eq(monthlySummary([early], cats, { accounts: [loan], base: 'EUR' })[0].spending, 120);
});

// ---- cash ----
test('Cash: spending from the wallet isn’t counted twice; the wallet balance is tracked', () => {
  const state = defaultState();
  state.transactions.push(
    tx('atm', '2026-08-01', -100, 'Cash', { account: 'Revolut EUR' }),
    tx('market', '2026-08-03', -30, 'Groceries', { account: 'Cash', manual: true }),
  );
  const [m] = monthlySummary(state.transactions, state.categories);
  eq([m.spending, m.byCategory.Groceries, m.byCategory.Cash], [100, 30, 70]);
  const cash = accountList(state, '2026-08-05').find((a) => a.type === 'cash');
  eq(cash.balance, 70);
});

// ---- budgets & warnings ----
const month = (m, day) => `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function history() {
  const list = [];
  for (const m of [6, 7, 8]) {
    list.push(tx(`rent${m}`, month(m, 1), -1000, 'Housing'));
    list.push(tx(`food${m}`, month(m, 12), -(80 + (m - 6) * 20), 'Groceries'));
    list.push(tx(`out${m}`, month(m, 15), -100, 'Dining Out'));
  }
  return list;
}
test('Budgets: suggested from the last three months, rounded up', () => {
  const parts = transactionParts(history(), { categories: cats });
  eq(suggestBudgets(parts, new Date(2026, 8, 10)), { Housing: 1000, Groceries: 100, 'Dining Out': 100 });
});
test('Warnings: rent on the 1st isn’t overspending; a real jump is', () => {
  const list = [...history(), tx('rent9', month(9, 1), -1000, 'Housing'), tx('big', month(9, 8), -180, 'Dining Out')];
  const parts = transactionParts(list, { categories: cats });
  const status = monthStatus(parts, { Groceries: 90 }, new Date(2026, 8, 10));
  const row = (c) => status.rows.find((r) => r.category === c);
  eq(row('Housing').warnings, []);
  eq(row('Dining Out').warnings.map((w) => w.kind), ['trend']);
  eq(row('Dining Out').projected, 280);
  eq(row('Groceries').warnings.map((w) => w.kind), ['pace']);
  const early = monthStatus(parts, {}, new Date(2026, 8, 3));
  eq(early.rows.find((r) => r.category === 'Dining Out'), undefined);
});
test('Warnings: a bill every two months isn’t a jump, a bigger one is', () => {
  const bills = (sep) => [...history(), tx('w7', month(7, 20), -40, 'Flat / Bills'), tx('w9', month(9, 8), -sep, 'Flat / Bills')];
  const warn = (sep) => monthStatus(transactionParts(bills(sep), { categories: cats }), {}, new Date(2026, 8, 10))
    .rows.find((r) => r.category === 'Flat / Bills').warnings.map((w) => w.text);
  eq(warn(40), []);
  eq(warn(70), ['Heading 75% above your biggest recent month']);
});
test('Warnings: ignore one-offs and small amounts', () => {
  const list = [...history(), tx('tv', month(9, 6), -900, 'Dining Out', { oneOff: true }), tx('snack', month(9, 6), -20, 'Groceries')];
  const parts = transactionParts(list, { categories: cats });
  const status = monthStatus(parts, {}, new Date(2026, 8, 10));
  eq(status.rows.filter((r) => r.warnings.length).map((r) => r.category), []);
});

// ---- accounts ----
test('Accounts: opening balance plus later transactions, net worth and the flat', () => {
  const state = defaultState();
  state.settings.fallbackRates = { HUF: 400, USD: 1.2 };
  state.categories = cats;
  state.accounts = [
    { name: 'Test Bank HUF', type: 'bank', currency: 'HUF', balance: 100000, asOf: '2026-08-31' },
    { ...loan, balance: -(10000000 - 22421.5), asOf: '2026-01-10' },
    { name: 'Flat', type: 'property', currency: 'HUF', value: 20000000 },
    { name: 'Broker', type: 'investment', currency: 'USD', match: 'BROKER', initial: 1200, initialDate: '2026-07-01', value: 2400 },
  ];
  state.balances['Test Bank EUR'] = { account: 'Test Bank EUR', currency: 'EUR', date: '2026-09-01', balance: 500 };
  state.transactions.push(
    tx('rent', '2026-09-02', 750, 'Flat / Rent received', { currency: 'HUF', originalAmount: 300000, account: 'Test Bank HUF' }),
    tx('before', '2026-08-30', -25, 'Flat / Bills', { currency: 'HUF', originalAmount: -10000, account: 'Test Bank HUF' }),
    tx('dep', '2026-07-05', -800, 'Investments', { description: 'Transfer to Broker Ltd', account: 'Test Bank EUR' }),
  );
  const list = accountList(state, '2026-09-10');
  const by = (n) => list.find((a) => a.name === n);
  eq([by('Test Bank HUF').balance, by('Test Bank HUF').value], [400000, 1000]);
  eq(by('Test Bank EUR').value, 500);
  eq(by('Broker').details, { deposits: 800, withdrawals: 0, profit: 200, initialMain: 1000 });
  const totals = netWorth(list);
  eq([totals.liquid, totals.property], [3500, 50000]);
  close(totals.loans, -(10000000 - 22421.5 - 22477.6 - 22533.8 - 22590.1 - 22646.6 - 22703.2 - 22760 - 22816.9 - 22873.9) / 400, 1);
  eq(flatSetup(state).categories, ['Flat', 'Flat / Rent received', 'Flat / Mortgage', 'Flat / Bills']);
  eq(investmentFlows({ name: 'Broker' }, state.transactions, '2026-08-01'), { deposits: 0, withdrawals: 0 });
});
test('Setup: reloading keeps values typed on the Accounts tab', () => {
  const state = defaultState();
  applySetup(state, { accounts: [{ name: 'Broker', type: 'investment', currency: 'USD' }] });
  state.accounts[0].value = 2400;
  applySetup(state, { accounts: [{ name: 'Broker', type: 'investment', currency: 'USD' }] });
  eq(state.accounts[0].value, 2400);
});

// ---- review ----
test('Review: people’s names from transfers, and what needs a category', () => {
  eq(personName('Transfer from Alex Example'), 'Alex Example');
  eq(personName('To Sam Sample'), 'Sam Sample');
  eq(personName('To EUR Savings'), null);
  eq(personName('Tesco'), null);
  eq(personName('Payment from Example Employer Ltd'), null);
  eq(needsReview({ category: 'Uncategorized' }), true);
  eq(needsReview({ category: 'Other Income', manual: true }), false);
  eq(needsReview({ category: 'Other Income', repays: ['x'] }), false);
});

// ---- FIRE with a rented flat, regular payments, goals ----
// 0% return keeps the arithmetic checkable by hand.
const flatPlan = { rent: 6000, mortgageCosts: 2400, payment: 300, owed: [...Array(11).keys()].map((m) => 3000 - 300 * m), keepRent: true };
test('FIRE with a flat: rent lowers the target, mortgage slows saving until it ends', () => {
  const s = runScenario({ annualIncome: 30000, annualSpending: 20000, savings: 0, annualReturnPct: 0, withdrawalRatePct: 4, flat: flatPlan });
  // Spending without the mortgage 17,600, minus rent 6,000 = 11,600 a year ÷ 4%.
  eq(s.flat.invested, 290000);
  close(s.monthlyContribution, 733.33, 0.01); // (30,000 − 17,600) ÷ 12 − 300
  close(s.flat.afterLoan, 1033.33, 0.01);
  // 10 months at 733.33 = 7,333.33, then 274 at 1,033.33 reaches 290,000.
  eq(s.months, 284);
  eq([s.target, s.flat.owedAtFire], [290000, 0]);
  eq(runScenario({ annualIncome: 30000, annualSpending: 20000, savings: 0, annualReturnPct: 0, withdrawalRatePct: 4, flat: { ...flatPlan, keepRent: false } }).flat.invested, 440000);
});
test('FIRE with a flat: before the mortgage ends, the target includes paying it off', () => {
  const s = runScenario({ annualIncome: 30000, annualSpending: 20000, savings: 293000, annualReturnPct: 0, withdrawalRatePct: 4, flat: flatPlan });
  eq([s.months, s.target, s.flat.owedAtFire], [0, 293000, 3000], 'needs 290,000 + 3,000 owed today');
  const t = runScenario({ annualIncome: 30000, annualSpending: 20000, savings: 290000, annualReturnPct: 0, withdrawalRatePct: 4, flat: flatPlan });
  // 733.33 a month saved while 300 a month comes off the loan: 3 months.
  eq([t.months, t.target, t.flat.owedAtFire], [3, 292100, 2100]);
});
test('Flat averages: rent, costs and mortgage costs over the recent months, without one-offs', () => {
  const summary = ['2026-07', '2026-08', '2026-09'].map((month) => ({ month }));
  const part = (month, category, amount, type, extra = {}) => ({ month, category, amount, type, oneOff: false, ...extra });
  const parts = [
    ...summary.flatMap(({ month }) => [part(month, 'Flat / Rent received', 300, 'income'), part(month, 'Flat / Mortgage', -100, 'expense', { kind: 'interest' }),
      part(month, 'Flat / Mortgage', -200, 'transfer', { kind: 'principal' })]),
    part('2026-08', 'Flat / Bills', -60, 'expense'),
    part('2026-09', 'Flat / Bills', -500, 'expense', { oneOff: true }),
    part('2026-09', 'Groceries', -50, 'expense'),
  ];
  const flat = { categories: ['Flat', 'Flat / Rent received', 'Flat / Mortgage', 'Flat / Bills'], loan: { category: 'Flat / Mortgage' } };
  eq(flatAverages(parts, flat, summary, new Date(2026, 9, 5)), { rent: 300, costs: 120, mortgageCosts: 100 });
});
test('Regular payments: monthly, about the same amount, still running', () => {
  const list = [
    ...['07', '08', '09'].map((m) => tx(`s${m}`, `2026-${m}-03`, -9.99, 'Subscriptions', { description: 'STREAMLY Monthly' })),
    tx('p1', '2026-07-15', -20, 'Utilities', { description: 'PhoneCo Mobile' }),
    tx('p2', '2026-08-15', -22, 'Utilities', { description: 'PhoneCo Mobile' }),
    tx('p3', '2026-09-15', -25, 'Utilities', { description: 'PhoneCo Mobile' }),
    ...['07-02', '07-09', '07-16', '08-02', '08-09', '09-02', '09-09'].map((d) => tx(`g${d}`, `2026-${d}`, -30, 'Groceries', { description: 'Corner Grocer' })),
    tx('gym1', '2026-04-01', -40, 'Sport', { description: 'Old Gym' }),
    tx('gym2', '2026-05-01', -40, 'Sport', { description: 'Old Gym' }),
    ...['07', '08', '09'].map((m) => tx(`sal${m}`, `2026-${m}-10`, 3000, 'Salary', { description: 'Example Employer' })),
    ...['07', '08', '09'].map((m) => tx(`tr${m}`, `2026-${m}-11`, -500, 'Transfers', { description: 'To savings' })),
    tx('big1', '2026-07-20', -100, 'Shopping', { description: 'Big Store' }),
    tx('big2', '2026-08-20', -300, 'Shopping', { description: 'Big Store' }),
  ];
  const found = regularPayments(list, cats, 'EUR');
  eq(found.map((r) => r.name), ['PhoneCo Mobile', 'STREAMLY Monthly']);
  const phone = found[0];
  eq([phone.amount, phone.monthly, phone.previous, phone.varies, phone.next, phone.count], [25, 22, 22, true, '2026-10-15', 3]);
  eq([found[1].varies, found[1].previous], [false, null]);
  eq(regularPayments([tx('a', '2026-12-31', -5, 'Subscriptions', { description: 'STREAMLY' }), tx('b', '2027-01-31', -5, 'Subscriptions', { description: 'STREAMLY' })], cats, 'EUR')[0].next, '2027-02-28');
});
test('Goals: bank accounts and cash by default, or the chosen accounts', () => {
  const list = [
    { name: 'Bank A', type: 'bank', value: 3000 },
    { name: 'Closed', type: 'bank', value: 999, hidden: true },
    { name: 'Cash', type: 'cash', value: 200 },
    { name: 'Broker', type: 'investment', value: 5000 },
    { name: 'Flat', type: 'property', value: 50000 },
  ];
  eq(goalProgress({ name: 'Emergency fund', target: 8000 }, list), { saved: 3200, target: 8000, left: 4800, share: 0.4, accounts: ['Bank A', 'Cash'] });
  eq(goalProgress({ name: 'Emergency fund', target: 8000, accounts: ['Bank A', 'Broker'] }, list).share, 1);
  const state = defaultState();
  applySetup(state, { goals: [{ name: 'Emergency fund', target: 8000 }] });
  applySetup(state, { goals: [{ name: 'Emergency fund', target: 9000 }] });
  eq(state.goals, [{ name: 'Emergency fund', target: 9000 }]);
  eq(JSON.parse(exportSetup(state)).goals, state.goals);
});

// ---- report ----
await Promise.all(running);
const failed = results.filter((r) => !r.ok);
const summary = document.getElementById('summary');
summary.textContent = failed.length ? `${failed.length} of ${results.length} tests failed` : `All ${results.length} tests passed`;
summary.className = failed.length ? 'fail' : 'pass';
const list = document.getElementById('results');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`;
  list.append(li);
}
window.testResults = { passed: results.length - failed.length, failed: failed.map((f) => `${f.name}: ${f.error}`) };
