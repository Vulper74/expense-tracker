// Statement formats the app knows, so they import without any column setup:
// Revolut (CSV) and OTP Bank (Excel). Other banks use the column mapper.
//
// Each parser returns
//   { bank, rows, skipped: { pending, other }, errors, exchanges, balances }
// where rows are { date, description, originalAmount, currency, account, key,
// category?, fallbackCategory? }. `category` is set only for rows whose kind
// decides it (exchanges, interest, fees); everything else goes through your rules.

import { parseAmount, parseDate } from './importer.js';
import { excelSerialToDate } from './xlsx.js';

export const INTERNAL = 'Transfers';
export const INTEREST = 'Interest';
export const BANK_FEES = 'Bank fees';
export const CASH = 'Cash';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Column positions by header name. Returns null unless every required column is there.
function columns(header, wanted) {
  const names = header.map(norm);
  const found = {};
  for (const [key, aliases] of Object.entries(wanted)) {
    const i = names.findIndex((n) => aliases.includes(n));
    if (i < 0 && !key.endsWith('?')) return null;
    found[key.replace('?', '')] = i;
  }
  return found;
}

// Two identical rows in one file get different keys (#1, #2), and the same
// rows in an overlapping file get the same keys, so re-imports are skipped.
function numbered() {
  const seen = new Map();
  return (base) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  };
}

export function parseStatement(rows, base) {
  return parseRevolut(rows, base) ?? parseOtp(rows);
}

// ---- Revolut ----

const REVOLUT = {
  type: ['type'],
  product: ['product'],
  started: ['started date'],
  completed: ['completed date'],
  description: ['description'],
  amount: ['amount'],
  fee: ['fee'],
  currency: ['currency'],
  state: ['state'],
  'balance?': ['balance'],
};

export function parseRevolut(rows, base) {
  const col = columns(rows[0] ?? [], REVOLUT);
  if (!col) return null;
  const result = { bank: 'Revolut', rows: [], skipped: { pending: 0, other: 0 }, errors: [], exchanges: [], balances: [] };
  const key = numbered();
  const exchangeRows = new Map(); // started time -> [{ currency, amount }]
  const latest = new Map(); // account -> balance row

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (!row.some((v) => String(v).trim())) return;
    const state = norm(row[col.state]);
    if (state === 'pending') return result.skipped.pending++;
    if (state !== 'completed') return result.skipped.other++; // reverted, declined, failed: no money moved

    const started = String(row[col.started]).trim();
    const date = parseDate(started, 'YMD');
    const amount = parseAmount(row[col.amount]);
    const feeValue = parseAmount(row[col.fee]);
    const fee = Number.isNaN(feeValue) ? 0 : feeValue;
    if (!date) return result.errors.push({ line, reason: `Couldn't read the date "${started}"` });
    if (Number.isNaN(amount)) return result.errors.push({ line, reason: `Couldn't read the amount "${row[col.amount]}"` });

    const type = norm(row[col.type]);
    const product = String(row[col.product] ?? '').trim() || 'Current';
    const currency = String(row[col.currency]).trim().toUpperCase();
    const description = String(row[col.description] ?? '').replace(/\s+/g, ' ').trim() || '(no description)';
    const account = product.toLowerCase() === 'current' ? `Revolut ${currency}` : `Revolut ${product} ${currency}`;
    const baseKey = `revolut|${product}|${currency}|${started}|${amount.toFixed(2)}|${description.toUpperCase()}`;
    const entry = { date, description, currency, account };

    // Money moving between your own Revolut accounts and currencies.
    const ownAccount = product.toLowerCase() !== 'current'
      || /^(to|from) .*\b(savings|vault|pocket)\b/i.test(description);
    const internal = type === 'exchange' || (type === 'transfer' && ownAccount);

    if (type === 'interest') {
      // The fee on interest is tax withheld, so what you keep is the net amount.
      result.rows.push({ ...entry, originalAmount: round2(amount - fee), category: INTEREST, key: key(baseKey) });
    } else if (internal) {
      result.rows.push({ ...entry, originalAmount: amount, category: INTERNAL, key: key(baseKey) });
      // A fee on an exchange is real spending, so it gets its own row.
      if (fee) result.rows.push({ ...entry, description: `${description} (fee)`, originalAmount: -fee, category: BANK_FEES, key: key(`${baseKey}|fee`) });
      if (type === 'exchange') {
        if (!exchangeRows.has(started)) exchangeRows.set(started, []);
        exchangeRows.get(started).push({ currency, amount, date });
      }
    } else {
      const row = { ...entry, originalAmount: round2(amount - fee), key: key(baseKey) };
      if (type === 'charge' || type === 'fee') row.category = BANK_FEES;
      else if (type === 'atm') row.category = CASH;
      // A refund with no rule is still a refund, not income.
      else if (type === 'card refund') row.fallbackCategory = 'Uncategorized';
      result.rows.push(row);
    }

    if (col.balance >= 0) {
      const balance = parseAmount(row[col.balance]);
      const at = String(row[col.completed] ?? '').trim() || started;
      const prev = latest.get(account);
      if (!Number.isNaN(balance) && (!prev || at >= prev.at)) latest.set(account, { account, currency, at, date: at.slice(0, 10), balance });
    }
  });

  // An exchange is two rows with the same start time: money out of one
  // currency, into another. When one side is your main currency, it's a rate.
  for (const [started, group] of exchangeRows) {
    const out = group.filter((g) => g.amount < 0);
    const into = group.filter((g) => g.amount > 0);
    if (out.length !== 1 || into.length !== 1 || out[0].currency === into[0].currency) continue;
    const [from, to] = [out[0], into[0]];
    if (from.currency === base) result.exchanges.push({ key: `revolut|${started}`, date: from.date, currency: to.currency, amount: to.amount, baseAmount: -from.amount });
    else if (to.currency === base) result.exchanges.push({ key: `revolut|${started}`, date: from.date, currency: from.currency, amount: -from.amount, baseAmount: to.amount });
  }
  result.balances = [...latest.values()];
  return result;
}

// ---- OTP Bank (Hungary), Excel export ----
// A few lines about the query come first; the table starts at the header row.

const OTP = {
  amount: ['amount', 'összeg'],
  currency: ['currency', 'pénznem', 'devizanem'],
  id: ['transaction identifier', 'tranzakció azonosító', 'tranzakcióazonosító'],
  date: ['transaction date', 'tranzakció dátuma', 'tranzakció időpontja'],
  booked: ['booking date', 'könyvelés dátuma', 'könyvelés napja'],
  'partner?': ['partner name', 'partner neve'],
  'type?': ['type', 'típus', 'tranzakció típusa'],
  'narration?': ['narration', 'közlemény'],
};

export function parseOtp(rows) {
  let headerIndex = -1;
  let col = null;
  for (let i = 0; i < Math.min(rows.length, 40) && !col; i++) {
    col = columns(rows[i], OTP);
    if (col) headerIndex = i;
  }
  if (!col) return null;
  const result = { bank: 'OTP', rows: [], skipped: { pending: 0, other: 0 }, errors: [], exchanges: [], balances: [] };
  const key = numbered();

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2;
    if (!row.some((v) => String(v).trim())) return;
    // Not booked yet: it can still change or disappear.
    if (!String(row[col.booked] ?? '').trim()) return result.skipped.pending++;

    const rawDate = String(row[col.date] ?? '').trim() || String(row[col.booked]).trim();
    const date = /^\d{5}(\.\d+)?$/.test(rawDate) ? excelSerialToDate(rawDate) : parseDate(rawDate, 'YMD');
    const amount = parseAmount(row[col.amount]);
    if (!date) return result.errors.push({ line, reason: `Couldn't read the date "${rawDate}"` });
    if (Number.isNaN(amount)) return result.errors.push({ line, reason: `Couldn't read the amount "${row[col.amount]}"` });

    const pick = (k) => (col[k] >= 0 ? String(row[col[k]] ?? '').replace(/\s+/g, ' ').trim() : '');
    const partner = pick('partner');
    const parts = [partner, pick('type'), pick('narration')]
      .filter((p, n, all) => p && !/^\d+$/.test(p) && all.indexOf(p) === n); // skip bare account numbers and repeats
    const currency = String(row[col.currency] ?? '').trim().toUpperCase() || 'HUF';
    const id = String(row[col.id] ?? '').trim();
    result.rows.push({
      date,
      description: parts.join(' – ') || '(no description)',
      originalAmount: amount,
      currency,
      account: `OTP ${currency}`,
      key: id ? `otp|${id}` : key(`otp|${date}|${amount}|${parts.join('|').toUpperCase()}`),
    });
  });
  return result;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
