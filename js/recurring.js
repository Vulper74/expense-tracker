// Regular payments: the same payee charging about the same amount about once a
// month (subscriptions, phone, insurance, the mortgage). Found from your
// transactions, nothing to set up. Pure functions, no screen code.

import { categoryType, suggestKeyword } from './categorize.js';
import { CASH_CATEGORY } from './ledger.js';

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round2 = (n) => Math.round(n * 100) / 100;
// The same day next month (the last day, if that month is shorter).
const nextMonthDay = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
};

const MIN_GAP = 20; // days between charges that still count as monthly
const MAX_GAP = 40;
const SPREAD = 0.25; // each charge within 25% of the usual amount
const STOPPED = 45; // no charge for this many days: it has probably ended

// [{ name, category, currency, amount (own currency), monthly (main currency),
//    count, last, next, varies, previous? (amount before the last one when it changed) }]
// Newest data decides what's still running, so an old import doesn't show everything as ended.
export function regularPayments(transactions, categories, base) {
  const groups = new Map();
  for (const t of transactions) {
    if (!(t.amount < 0) || t.category === CASH_CATEGORY || categoryType(t.category, categories) !== 'expense') continue;
    const currency = t.currency ?? base;
    const key = `${suggestKeyword(t.description)}|${currency}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const latest = transactions.reduce((d, t) => (t.date > d ? t.date : d), '');

  const found = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = list.slice(1).map((t, i) => days(list[i].date, t.date));
    const gap = median(gaps);
    if (gap < MIN_GAP || gap > MAX_GAP) continue;
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (list.length > months.size * 1.25) continue; // several a month: a shop you go to, not a bill
    const own = list.map((t) => Math.abs(t.originalAmount ?? t.amount));
    const usual = median(own);
    if (own.some((v) => Math.abs(v - usual) > usual * SPREAD)) continue;
    const last = list[list.length - 1];
    if (days(last.date, latest) > STOPPED) continue;
    const lastAmount = own[own.length - 1];
    const before = own[own.length - 2];
    found.push({
      name: last.description,
      category: last.category,
      currency: last.currency ?? base,
      amount: round2(lastAmount),
      monthly: round2(median(list.map((t) => Math.abs(t.amount)))),
      count: list.length,
      last: last.date,
      next: nextMonthDay(last.date),
      varies: Math.max(...own) - Math.min(...own) > usual * 0.05,
      previous: Math.abs(lastAmount - before) > before * 0.05 ? round2(before) : null,
    });
  }
  return found.sort((a, b) => b.monthly - a.monthly);
}
