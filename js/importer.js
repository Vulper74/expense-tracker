// Turning bank CSV rows into transactions: column mapping, amounts, dates, duplicates.
// Pure functions only (the screen lives in import-view.js), so they're easy to test.

import { categorize, needsReview, personName } from './categorize.js';
import { reconvert } from './currency.js';
import { uid } from './util.js';

export const DATE_FORMATS = [
  { id: 'YMD', label: 'Year-Month-Day (2026-09-27)' },
  { id: 'MDY', label: 'Month/Day/Year (09/27/2026)' },
  { id: 'DMY', label: 'Day/Month/Year (27/09/2026)' },
];

const pad = (n) => String(n).padStart(2, '0');

// Returns 'YYYY-MM-DD', or null if the text isn't a valid date in that format.
export function parseDate(raw, format) {
  const parts = String(raw ?? '').trim().split(/\D+/).filter(Boolean);
  if (parts.length < 3) return null;
  let y, m, d;
  if (format === 'YMD') [y, m, d] = parts;
  else if (format === 'MDY') [m, d, y] = parts;
  else [d, m, y] = parts;
  y = Number(y);
  m = Number(m);
  d = Number(d);
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Pick a date format that reads every sample. When several do (03/09 could be
// March 9 or 3 September), pick the one where the dates sit closest together,
// since a bank export covers a short period. Ties go day-first for dotted dates.
export function guessDateFormat(samples) {
  const values = samples.filter((s) => String(s ?? '').trim());
  const fits = DATE_FORMATS.map((f) => f.id).filter((id) => values.length && values.every((v) => parseDate(v, id)));
  if (fits.length <= 1) return fits[0] ?? 'YMD';
  const span = (id) => {
    const times = values.map((v) => Date.parse(parseDate(v, id)));
    return Math.max(...times) - Math.min(...times);
  };
  const dayFirst = values.some((v) => /\d\.\d/.test(v));
  const preference = (id) => (dayFirst && id === 'DMY' ? 0 : 1);
  return fits.sort((a, b) => span(a) - span(b) || preference(a) - preference(b))[0];
}

// Understands "$1,234.56", "-12.30", "(12.30)", "12.30-", "1.234,56" and "12,5".
export function parseAmount(raw) {
  const cleaned = String(raw ?? '').trim().replace(/[^\d\-().,]/g, '');
  if (!/\d/.test(cleaned)) return NaN;
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith('-') || cleaned.endsWith('-');
  let digits = cleaned.replace(/[()\-]/g, '');

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    digits = lastComma > lastDot ? digits.replace(/\./g, '').replace(',', '.') : digits.replace(/,/g, '');
  } else if (lastComma > -1) {
    const single = digits.indexOf(',') === lastComma;
    const decimals = digits.length - lastComma - 1;
    digits = single && decimals !== 3 ? digits.replace(',', '.') : digits.replace(/,/g, '');
  } else if (digits.indexOf('.') !== lastDot) {
    digits = digits.replace(/\./g, ''); // 1.234.567
  }

  const n = Number(digits);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negative ? -n : n) * 100) / 100;
}

// For files where every amount is positive and another column says which way the money went.
// Returns -1 for money out, 1 for money in, 0 if the text isn't recognised.
export function parseDirection(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (/^(expenses?|debit|dr|withdrawal|payment|purchase|charge|spending|out|money out|outflow)$/.test(text)) return -1;
  if (/^(income|credit|cr|deposit|refund|in|money in|inflow)$/.test(text)) return 1;
  return 0;
}

// Try each pattern in priority order, so "Description" beats "Details".
const find = (header, patterns) => {
  for (const pattern of patterns) {
    const i = header.findIndex((h) => pattern.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
};

// Guess which column is which from the header row.
export function guessMapping(rows) {
  const header = rows[0] ?? [];
  const width = Math.max(...rows.map((r) => r.length));
  const hasHeader = header.length > 0 && header.every((h) => !/^[-\d.,/$€£()\s]+$/.test(h) || !h.trim());

  let date = hasHeader ? find(header, [/date|datum/i, /posted|booking|time/i]) : -1;
  let description = hasHeader ? find(header, [/desc/i, /payee|merchant|narrat/i, /details|memo|name|text|reference/i]) : -1;
  const amount = hasHeader ? find(header, [/amount|betrag|iznos/i, /value|sum/i]) : -1;
  const debit = hasHeader ? find(header, [/debit|withdraw|money out|paid out|outflow/i]) : -1;
  const credit = hasHeader ? find(header, [/credit|deposit|money in|paid in|inflow/i]) : -1;

  const body = hasHeader ? rows.slice(1) : rows;
  if (date < 0) date = [...Array(width).keys()].find((i) => body.slice(0, 5).every((r) => /\d+\D\d+\D\d+/.test(r[i] ?? ''))) ?? 0;
  if (description < 0) description = [...Array(width).keys()].find((i) => i !== date && body.slice(0, 5).some((r) => /[a-z]{3,}/i.test(r[i] ?? ''))) ?? 1;

  // Separate money-out / money-in columns (e.g. "Debit Amount" and "Credit Amount").
  let amountMode = debit >= 0 && credit >= 0 && debit !== credit && (amount < 0 || amount === debit || amount === credit) ? 'split' : 'single';
  const fallbackAmount = [...Array(width).keys()].find((i) => i !== date && i !== description && body.slice(0, 5).every((r) => !Number.isNaN(parseAmount(r[i])))) ?? 2;
  const amountColumn = amount >= 0 ? amount : fallbackAmount;

  // No minus signs anywhere, but a column like "Type: Expense / Income" says which way it went.
  const sampleRows = body.slice(0, 60);
  const unsigned = sampleRows.every((r) => !(parseAmount(r[amountColumn]) < 0));
  const type = [...Array(width).keys()].find((i) => i !== amountColumn && i !== date && i !== description &&
    sampleRows.some((r) => parseDirection(r[i]) < 0) && sampleRows.every((r) => parseDirection(r[i]) !== 0));
  if (amountMode === 'single' && unsigned && type !== undefined) amountMode = 'typed';

  return {
    hasHeader,
    date,
    description,
    amountMode,
    amount: amountColumn,
    debit: Math.max(debit, 0),
    credit: Math.max(credit, 0),
    type: type ?? 0,
    dateFormat: guessDateFormat(body.slice(0, 60).map((r) => r[date])),
    invert: false,
  };
}

// A header "fingerprint" so a saved bank profile is picked automatically next time.
export function headerSignature(rows) {
  return (rows[0] ?? []).map((h) => h.trim().toLowerCase()).join('|');
}

// Apply a mapping. Returns { rows: [{date, description, amount}], errors: [{line, reason}] }.
export function mapRows(rows, mapping) {
  const result = { rows: [], errors: [] };
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const firstLine = mapping.hasHeader ? 2 : 1;

  body.forEach((row, i) => {
    const line = firstLine + i;
    const date = parseDate(row[mapping.date], mapping.dateFormat);
    if (!date) return result.errors.push({ line, reason: `Couldn't read the date "${row[mapping.date] ?? ''}"` });

    let amount;
    if (mapping.amountMode === 'split') {
      const out = parseAmount(row[mapping.debit]);
      const inn = parseAmount(row[mapping.credit]);
      if (Number.isNaN(out) && Number.isNaN(inn)) return result.errors.push({ line, reason: 'No amount in the money in/out columns' });
      amount = (Number.isNaN(inn) ? 0 : Math.abs(inn)) - (Number.isNaN(out) ? 0 : Math.abs(out));
    } else {
      amount = parseAmount(row[mapping.amount]);
      if (Number.isNaN(amount)) return result.errors.push({ line, reason: `Couldn't read the amount "${row[mapping.amount] ?? ''}"` });
      if (mapping.amountMode === 'typed') {
        const direction = parseDirection(row[mapping.type]);
        if (!direction) return result.errors.push({ line, reason: `Couldn't tell if "${row[mapping.type] ?? ''}" is money in or out` });
        amount = direction * Math.abs(amount);
      }
    }
    if (mapping.invert && mapping.amountMode === 'single') amount = -amount;

    const description = String(row[mapping.description] ?? '').replace(/\s+/g, ' ').trim() || '(no description)';
    result.rows.push({ date, description, amount: Math.round(amount * 100) / 100 });
  });
  return result;
}

// Same date + amount + description = same transaction. Two identical coffees on
// the same day stay separate because each gets a running number (#1, #2).
// Re-importing the same (or an overlapping) file gives the same keys, so they're skipped.
export function withKeys(rows) {
  const seen = new Map();
  return rows.map((r) => {
    const base = `${r.date}|${r.amount.toFixed(2)}|${r.description.toUpperCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, key: `${base}#${n}` };
  });
}

// Add new transactions, skip ones already imported. Returns counts.
// Rows from a known bank carry their own key, currency and account; the
// main-currency amount of foreign rows is filled in by reconvert() afterwards.
export function mergeTransactions(existing, rows, rules, { categories, base } = {}) {
  const known = new Set(existing.map((t) => t.key));
  const exists = (name) => !categories || categories.some((c) => c.name === name);
  let added = 0;
  let skipped = 0;
  for (const r of rows.some((x) => !x.key) ? withKeys(rows.map((x) => ({ ...x, amount: x.amount ?? x.originalAmount }))) : rows) {
    if (known.has(r.key)) {
      skipped++;
      continue;
    }
    known.add(r.key);
    const original = r.originalAmount ?? r.amount;
    const foreign = r.currency && base && r.currency !== base;
    const fromBank = r.category != null && exists(r.category);
    const t = {
      id: uid(),
      date: r.date,
      description: r.description,
      amount: foreign ? 0 : original,
      category: fromBank ? r.category : categorize(r.description, original, rules, r.fallbackCategory),
      key: r.key,
      manual: false,
    };
    if (r.currency) t.currency = r.currency;
    if (foreign) t.originalAmount = original;
    if (r.account) t.account = r.account;
    if (fromBank) t.fromBank = true;
    if (r.fallbackCategory) t.fallback = r.fallbackCategory;
    existing.push(t);
    added++;
  }
  return { added, skipped };
}

// Add a parsed bank statement (see banks.js): transactions, the exchange rates
// it contains, and the latest balance of each account. Returns counts plus any
// currencies that still need a rate.
export function importStatement(state, parsed) {
  const before = state.transactions.length;
  const counts = mergeTransactions(state.transactions, parsed.rows, state.rules, { categories: state.categories, base: state.settings.currency });
  const knownExchanges = new Set(state.exchanges.map((x) => x.key));
  for (const x of parsed.exchanges) if (!knownExchanges.has(x.key)) state.exchanges.push(x);
  for (const b of parsed.balances) {
    const prev = state.balances[b.account];
    if (!prev || (b.at ?? b.date) >= (prev.at ?? prev.date)) state.balances[b.account] = b;
  }
  const missingRates = reconvert(state);
  // People you haven't made a rule for yet.
  const added = state.transactions.slice(before);
  const newPeople = [...new Set(added.filter(needsReview).map((t) => personName(t.description)).filter(Boolean))];
  return { ...counts, missingRates, review: added.filter(needsReview).length, newPeople };
}
