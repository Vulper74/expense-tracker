// Personal setup: your own categories, rules, rates and accounts in a file that
// is kept apart from the app's code. Load it once on a new device; download it
// again after adding rules so you have a copy.
//
// { format: 'expense-tracker-setup', settings, categories, rules, accounts, budgets, goals, fire }
// Everything is merged in: loading never deletes transactions.

import { applyAllRules } from './categorize.js';
import { reconvert } from './currency.js';

const SETUP_FORMAT = 'expense-tracker-setup';

const sameRule = (a, b) => a.match.toUpperCase() === b.match.toUpperCase()
  && (a.amount ?? null) === (b.amount ?? null) && (a.sign ?? null) === (b.sign ?? null);

export function parseSetup(text) {
  const data = JSON.parse(text);
  if (data?.format !== SETUP_FORMAT) throw new Error('This is not an Expense Tracker setup file.');
  return data;
}

// Returns a short description of what changed.
export function applySetup(state, setup) {
  const counts = { categories: 0, rules: 0, accounts: 0, recategorised: 0 };
  if (setup.settings) {
    const { fallbackRates, ...rest } = setup.settings;
    Object.assign(state.settings, rest);
    state.settings.fallbackRates = { ...state.settings.fallbackRates, ...fallbackRates };
  }
  for (const c of setup.categories ?? []) {
    const existing = state.categories.find((x) => x.name === c.name);
    if (existing) Object.assign(existing, c);
    else {
      state.categories.push({ ...c });
      counts.categories++;
    }
  }
  for (const r of setup.rules ?? []) {
    const rule = { match: r.match.trim().toUpperCase(), category: r.category };
    if (r.amount != null) rule.amount = Number(r.amount);
    if (r.sign) rule.sign = r.sign;
    if (!state.categories.some((c) => c.name === rule.category)) continue;
    state.rules = state.rules.filter((x) => !sameRule(x, rule));
    state.rules.push(rule);
    counts.rules++;
  }
  for (const name of setup.removeRules ?? []) {
    state.rules = state.rules.filter((r) => r.match.toUpperCase() !== name.toUpperCase() || r.amount != null || r.sign);
  }
  if (setup.accounts) {
    state.accounts ??= [];
    for (const a of setup.accounts) {
      // Values typed on the Accounts tab (investment value, counted cash) are kept.
      const existing = state.accounts.find((x) => x.name === a.name);
      if (existing) Object.assign(existing, a);
      else state.accounts.push({ ...a });
      counts.accounts++;
    }
  }
  if (setup.budgets) state.budgets = { ...state.budgets, ...setup.budgets };
  for (const g of setup.goals ?? []) {
    state.goals ??= [];
    const existing = state.goals.find((x) => x.name === g.name);
    if (existing) Object.assign(existing, g);
    else state.goals.push({ ...g });
  }
  if (setup.fire) Object.assign(state.fire, setup.fire);
  counts.recategorised = applyAllRules(state.transactions, state.rules);
  reconvert(state);
  return counts;
}

// Your setup without any transactions, to keep or move to another device.
export function exportSetup(state) {
  return JSON.stringify({
    format: SETUP_FORMAT,
    exportedAt: new Date().toISOString(),
    settings: { currency: state.settings.currency, fallbackRates: state.settings.fallbackRates },
    categories: state.categories,
    rules: state.rules,
    accounts: state.accounts ?? [],
    budgets: state.budgets ?? {},
    goals: state.goals ?? [],
    fire: state.fire,
  }, null, 2);
}
