// Monthly totals used by the dashboard and the FIRE planner.

import { savingsRate } from './fire.js';
import { transactionParts } from './ledger.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function nextMonth(month) {
  let [y, m] = month.split('-').map(Number);
  m++;
  if (m > 12) {
    m = 1;
    y++;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Everything a month's totals need, for state or plain lists (tests).
export function partsOf(state) {
  return transactionParts(state.transactions, { categories: state.categories, accounts: state.accounts, base: state.settings.currency });
}

// One entry per month from the first to the last transaction (empty months included).
// Transfers (and loan principal) are left out. Refunds in a spending category reduce it.
// `regular` is the same without one-offs, for averages, budgets and warnings.
// Pass parts from partsOf(), or transactions + categories.
export function monthlySummary(transactionsOrParts, categories, options = {}) {
  const parts = transactionsOrParts.length && transactionsOrParts[0].t
    ? transactionsOrParts
    : transactionParts(transactionsOrParts, { categories, ...options });
  const empty = (month) => ({ month, income: 0, spending: 0, byCategory: {}, principal: 0, regular: { income: 0, spending: 0, byCategory: {} } });
  const byMonth = new Map();
  for (const p of parts) {
    if (!byMonth.has(p.month)) byMonth.set(p.month, empty(p.month));
    const entry = byMonth.get(p.month);
    if (p.kind === 'principal') entry.principal -= p.amount;
    if (p.type === 'transfer') continue;
    for (const target of p.oneOff ? [entry] : [entry, entry.regular]) {
      if (p.type === 'income') {
        target.income += p.amount;
      } else {
        target.spending -= p.amount;
        target.byCategory[p.category] = (target.byCategory[p.category] ?? 0) - p.amount;
      }
    }
  }
  if (!byMonth.size) return [];

  const months = [...byMonth.keys()].sort();
  const tidy = (e) => {
    for (const k of Object.keys(e.byCategory)) e.byCategory[k] = round2(e.byCategory[k]);
    return { ...e, income: round2(e.income), spending: round2(e.spending), savingsRate: savingsRate(e.income, e.spending) };
  };
  const result = [];
  for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth(m)) {
    const entry = byMonth.get(m) ?? empty(m);
    result.push({ ...tidy(entry), principal: round2(entry.principal), regular: tidy(entry.regular) });
  }
  return result;
}

// The months averages are taken over: the last (up to) 12 full months.
// The current calendar month is skipped while it's in progress.
export function recentMonths(summary, today = new Date()) {
  const thisMonth = monthKey(today);
  return summary.filter((m) => m.month !== thisMonth || summary.length === 1).slice(-12).map((m) => m.month);
}

// Average monthly income and spending over recentMonths, leaving out one-offs.
export function recentAverages(summary, today = new Date()) {
  const used = new Set(recentMonths(summary, today));
  const months = summary.filter((m) => used.has(m.month));
  if (!months.length) return { monthlyIncome: 0, monthlySpending: 0, monthsUsed: 0 };
  const total = (key) => months.reduce((sum, m) => sum + (m.regular ?? m)[key], 0);
  return {
    monthlyIncome: round2(total('income') / months.length),
    monthlySpending: round2(total('spending') / months.length),
    monthsUsed: months.length,
  };
}

// The flat's share of recentAverages, per month in the main currency: rent
// received, all its costs, and the mortgage's interest and fees among them.
export function flatAverages(parts, flat, summary, today = new Date()) {
  const used = new Set(recentMonths(summary, today));
  const totals = { rent: 0, costs: 0, mortgageCosts: 0 };
  for (const p of parts) {
    if (!used.has(p.month) || p.oneOff || !flat.categories.includes(p.category)) continue;
    if (p.type === 'income') totals.rent += p.amount;
    else if (p.type === 'expense') {
      totals.costs -= p.amount;
      if (flat.loan && p.category === flat.loan.category) totals.mortgageCosts -= p.amount;
    }
  }
  const n = used.size || 1;
  return { rent: round2(totals.rent / n), costs: round2(totals.costs / n), mortgageCosts: round2(totals.mortgageCosts / n) };
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
