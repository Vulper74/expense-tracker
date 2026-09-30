// Saves everything in the browser's localStorage, plus JSON backups.

import { DEFAULT_CATEGORIES, DEFAULT_RULES, REQUIRED_CATEGORIES } from './categorize.js';

const STORAGE_KEY = 'expense-tracker:v1';
const BACKUP_FORMAT = 'expense-tracker-backup';

export function defaultState() {
  return {
    version: 2,
    // { id, date: 'YYYY-MM-DD', description, amount (main currency, negative = money out),
    //   category, key, manual, account?, currency?, originalAmount? (when not in the main currency),
    //   fromBank? (category decided by the statement), fallback?, note?,
    //   splits? [{ amount (own currency), category, oneOff?, note? }] (the rest stays in `category`),
    //   oneOff? (left out of averages, budgets and warnings), repays? [ids of expenses it pays back] }
    transactions: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    rules: structuredClone(DEFAULT_RULES),
    // Saved CSV column mappings, one per bank: { name, signature, mapping }
    profiles: [],
    // Currency exchanges seen in statements, used for rates: { date, currency, amount, baseAmount }
    exchanges: [],
    // Latest balance per account from statements: { [account]: { date, currency, balance } }
    balances: {},
    // Accounts from your setup file (opening balances, loans, property), used for net worth.
    accounts: [],
    // Monthly budget per category, in the main currency: { Groceries: 300 }
    budgets: {},
    // Savings goals, in the main currency: { name, target, accounts? [names] }.
    // No accounts = your bank accounts and cash.
    goals: [],
    fire: {
      savings: null, // null = the total of your accounts
      annualReturn: 5, // % per year after inflation
      withdrawalRate: 4, // % per year
      spendingOverride: null, // yearly; null = use tracker average
      incomeOverride: null, // yearly, after tax; null = use tracker average
      currentAge: null,
      keepRent: true, // the flat is still rented out after you retire
    },
    settings: {
      currency: 'EUR', // main currency: all totals
      display: null, // 'EUR', 'HUF', 'USD'… or 'original'; null = main currency
      fallbackRates: {}, // { HUF: 390 } units per 1 main currency, when no exchange is close
    },
  };
}

// Fill in anything missing so older saves keep working after updates.
function withDefaults(saved) {
  const base = defaultState();
  const state = {
    ...base,
    ...saved,
    fire: { ...base.fire, ...saved.fire },
    settings: { ...base.settings, ...saved.settings },
  };
  // Savings of 0 used to mean "not set"; now blank uses your accounts.
  if (state.fire.savings === 0) state.fire.savings = null;
  state.budgets ??= {};
  state.goals ??= [];
  for (const name of REQUIRED_CATEGORIES) {
    if (!state.categories.some((c) => c.name === name)) state.categories.push(DEFAULT_CATEGORIES.find((c) => c.name === name));
  }
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? withDefaults(JSON.parse(raw)) : defaultState();
  } catch (err) {
    console.error('Could not read saved data, starting fresh', err);
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createStore() {
  let state = loadState();
  return {
    get state() {
      return state;
    },
    // Change the state and save it: store.commit((s) => { s.x = 1; })
    commit(mutator) {
      mutator(state);
      saveState(state);
    },
    replace(next) {
      state = withDefaults(next);
      saveState(state);
    },
  };
}

export function exportBackup(state) {
  return JSON.stringify({ format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), state }, null, 2);
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data?.format !== BACKUP_FORMAT || !Array.isArray(data.state?.transactions)) {
    throw new Error('This file is not an Expense Tracker backup.');
  }
  return withDefaults(data.state);
}
