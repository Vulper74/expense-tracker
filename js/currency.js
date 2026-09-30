// Money in several currencies. Every transaction keeps what the bank showed
// (originalAmount + currency) and an `amount` in your main currency, which
// all totals use. Rates come from your own currency exchanges; a manual rate
// fills the gaps.

import { formatMoney } from './util.js';

// Exchange rows the app has seen: { date, currency, amount, baseAmount }
// e.g. 330.13 EUR became 120,000 HUF → { currency: 'HUF', amount: 120000, baseAmount: 330.13 }.

const DAY = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;

// Units of `currency` per 1 unit of the main currency, on (or nearest to) `date`.
// Same-day exchanges are combined, weighted by size, so a €330 exchange counts
// far more than a €0.50 round-up. Returns null when there's no rate at all.
export function rateFor(currency, date, { base, exchanges = [], fallbackRates = {} }) {
  if (!currency || currency === base) return 1;
  const own = exchanges.filter((x) => x.currency === currency && x.baseAmount > 0 && x.amount > 0);
  if (own.length) {
    const target = Date.parse(date);
    let best = Infinity;
    for (const x of own) best = Math.min(best, Math.abs(Date.parse(x.date) - target));
    const nearest = own.filter((x) => Math.abs(Date.parse(x.date) - target) === best);
    const total = (key) => nearest.reduce((s, x) => s + x[key], 0);
    // A rate from months away is worse than the one you typed in.
    if (best <= 45 * DAY || !(fallbackRates[currency] > 0)) return total('amount') / total('baseAmount');
  }
  return fallbackRates[currency] > 0 ? fallbackRates[currency] : null;
}

export function rateContext(state) {
  return { base: state.settings.currency, exchanges: state.exchanges ?? [], fallbackRates: state.settings.fallbackRates ?? {} };
}

// Value in the main currency, or null if there's no rate for that currency yet.
export function toBase(amount, currency, date, context) {
  const rate = rateFor(currency, date, context);
  return rate ? round2(amount / rate) : null;
}

// Recalculate main-currency amounts after new rates arrive. Transactions typed
// by hand in the main currency, or with an amount you fixed, aren't touched.
// Returns the currencies that still have no rate.
export function reconvert(state) {
  const context = rateContext(state);
  const missing = new Set();
  for (const t of state.transactions) {
    if (!t.currency || t.currency === context.base || t.fixedAmount) continue;
    const value = toBase(t.originalAmount, t.currency, t.date, context);
    if (value == null) {
      missing.add(t.currency);
      t.amount = 0;
      t.unconverted = true;
    } else {
      t.amount = value;
      delete t.unconverted;
    }
  }
  return [...missing];
}

// ---- showing amounts ----

// Currency totals are shown in: the chosen one, or the main one for "original".
export function displayCurrency(state, mode = state.settings.display) {
  return !mode || mode === 'original' ? state.settings.currency : mode;
}

// A main-currency total in the display currency, at today's (latest) rate.
export function toDisplay(state, baseValue, mode = state.settings.display) {
  const currency = displayCurrency(state, mode);
  if (currency === state.settings.currency) return baseValue;
  const rate = rateFor(currency, new Date().toISOString().slice(0, 10), rateContext(state));
  return rate ? baseValue * rate : baseValue;
}

// What to show for one transaction: { amount, currency }.
// "original" shows what the bank showed; a currency shows the original amount
// when it was already in that currency, otherwise a conversion.
export function transactionDisplay(state, t, mode = state.settings.display) {
  const originalCurrency = t.currency ?? state.settings.currency;
  const original = t.originalAmount ?? t.amount;
  if (mode === 'original' || mode === originalCurrency) return { amount: original, currency: originalCurrency };
  const currency = displayCurrency(state, mode);
  if (currency === state.settings.currency) return { amount: t.amount, currency };
  const rate = rateFor(currency, t.date, rateContext(state));
  return rate ? { amount: t.amount * rate, currency } : { amount: t.amount, currency: state.settings.currency };
}

// Formatters for a screen: money(v) shows a main-currency total in the display
// currency; forTransaction(t) shows one transaction the display way.
export function moneyFormatter(state, mode = state.settings.display) {
  const currency = displayCurrency(state, mode);
  const convert = (v) => toDisplay(state, v, mode);
  return {
    currency,
    money: (v, opts) => formatMoney(convert(v), currency, opts),
    compact: (v) => formatMoney(convert(v), currency, { compact: true }),
    whole: (v) => formatMoney(convert(v), currency, { whole: true }),
    forTransaction(t) {
      const shown = transactionDisplay(state, t, mode);
      return formatMoney(shown.amount, shown.currency);
    },
  };
}

// Choices for the currency switch: the main currency, the ones in your
// transactions and rates, then "Original".
export function displayChoices(state) {
  const seen = new Set([state.settings.currency]);
  for (const t of state.transactions) if (t.currency) seen.add(t.currency);
  for (const c of Object.keys(state.settings.fallbackRates ?? {})) seen.add(c);
  for (const x of state.exchanges ?? []) seen.add(x.currency);
  return [...seen, 'original'];
}
