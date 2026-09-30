// Budgets and warnings. All amounts are in the main currency, one-offs left out.
//
// "On pace" compares this month with your usual by the same day of the month,
// so a rent paid on the 1st doesn't look like a month's worth of overspending.
// Categories you don't pay every month (bills every two months) are compared
// with your biggest recent month instead, so a bill arriving isn't a warning.

import { monthKey } from './stats.js';

const round2 = (n) => Math.round(n * 100) / 100;
export const TREND = { ratio: 1.3, minimum: 25 }; // 30% and €25 above your 3-month average
const PAST_MONTHS = 3;

function previousMonths(month, count) {
  let [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    m--;
    if (m < 1) { m = 12; y--; }
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

// Spending per category in a month, optionally only up to a day of the month.
function spentBy(parts, month, day = 31) {
  const out = {};
  for (const p of parts) {
    if (p.type !== 'expense' || p.oneOff || p.month !== month || Number(p.date.slice(8, 10)) > day) continue;
    out[p.category] = (out[p.category] ?? 0) - p.amount;
  }
  return out;
}

// Months before `month` that have data, up to three.
function historyMonths(parts, month) {
  const seen = new Set(parts.map((p) => p.month));
  const first = [...seen].sort()[0];
  return previousMonths(month, PAST_MONTHS).filter((m) => first && m >= first);
}

// Your usual monthly spending per category over the last three full months.
export function categoryAverages(parts, month) {
  const months = historyMonths(parts, month);
  const totals = {};
  const highest = {};
  const paidIn = {};
  for (const m of months) {
    for (const [c, v] of Object.entries(spentBy(parts, m))) {
      totals[c] = (totals[c] ?? 0) + v;
      highest[c] = Math.max(highest[c] ?? 0, v);
      if (v > 0.005) paidIn[c] = (paidIn[c] ?? 0) + 1;
    }
  }
  const out = {};
  const irregular = {};
  for (const [c, v] of Object.entries(totals)) {
    out[c] = months.length ? round2(v / months.length) : 0;
    if ((paidIn[c] ?? 0) < months.length) irregular[c] = round2(highest[c]);
  }
  return { averages: out, months, irregular };
}

// A budget suggestion per category: the 3-month average, rounded up.
export function suggestBudgets(parts, today = new Date()) {
  const { averages } = categoryAverages(parts, monthKey(today));
  const out = {};
  for (const [c, v] of Object.entries(averages)) {
    if (v < 1) continue;
    const step = v >= 500 ? 50 : v >= 100 ? 10 : 5;
    out[c] = Math.ceil(v / step) * step;
  }
  return out;
}

// This month, per category: spent so far, where it's heading, and any warnings.
// [{ category, spent, projected, average, budget, warnings: [{ kind, text }] }]
// kind: 'over' (budget used up), 'pace' (heading over budget), 'trend' (well above usual).
export function monthStatus(parts, budgets = {}, today = new Date()) {
  const month = monthKey(today);
  const day = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const spent = spentBy(parts, month, day);
  const { averages, months, irregular } = categoryAverages(parts, month);
  // Usual spending by this day of the month.
  const byDay = {};
  for (const m of months) for (const [c, v] of Object.entries(spentBy(parts, m, day))) byDay[c] = (byDay[c] ?? 0) + v / months.length;

  const categories = new Set([...Object.keys(spent), ...Object.keys(budgets), ...Object.keys(averages)]);
  const rows = [];
  for (const category of categories) {
    const now = round2(spent[category] ?? 0);
    const average = averages[category] ?? 0;
    // A bill that doesn't come every month has already come if there's spending.
    const usualRest = irregular[category] != null && now > 0 ? 0 : Math.max(0, average - (byDay[category] ?? 0));
    // No history yet: straight-line from the days so far.
    const projected = round2(months.length ? now + usualRest : (now / day) * daysInMonth);
    const budget = budgets[category];
    const warnings = [];
    if (budget > 0 && now > budget) warnings.push({ kind: 'over', text: 'Over budget' });
    else if (budget > 0 && projected > budget && day >= 5) warnings.push({ kind: 'pace', text: 'On pace to go over budget' });
    const usual = irregular[category] ?? average;
    if (months.length && day >= 5 && projected >= usual * TREND.ratio && projected - usual >= TREND.minimum) {
      const above = `${Math.round((projected / usual - 1) * 100)}% above your ${irregular[category] != null ? 'biggest recent month' : 'usual'}`;
      warnings.push({ kind: 'trend', text: usual > 0 ? `Heading ${above}` : 'New spending this month' });
    }
    if (!now && !budget && !warnings.length) continue;
    rows.push({ category, spent: now, projected, average, budget: budget ?? null, warnings });
  }
  return {
    month,
    day,
    daysInMonth,
    monthsOfHistory: months.length,
    rows: rows.sort((a, b) => b.warnings.length - a.warnings.length || b.spent - a.spent),
  };
}
