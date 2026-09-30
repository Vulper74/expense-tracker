// Accounts and net worth: bank balances, cash in hand, investments, the flat and its loan.
//
// state.accounts holds what the statements can't tell (from your setup file or
// typed on the Accounts tab):
//   bank:       { name, type: 'bank', currency, balance, asOf }     opening balance; later transactions are added
//   cash:       { name: 'Cash', type: 'cash', balance, asOf }       counted cash; withdrawals and cash spending are added
//   investment: { name, type: 'investment', currency, match?, initial, initialDate, value, asOf }
//   property:   { name, type: 'property', currency, value, asOf, group? }
//   loan:       { name, type: 'loan', currency, balance (negative), asOf, principal, ratePercent, years, payment, firstPayment, category? }
// state.balances has the latest balance of each account from statements.

import { matchesKeyword } from './categorize.js';
import { rateContext, rateFor } from './currency.js';
import { CASH_ACCOUNT, CASH_CATEGORY, loanStatus } from './ledger.js';
import { partsOf } from './stats.js';

const round2 = (n) => Math.round(n * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

// An amount in a given currency, from one transaction (or a part of it).
function amountIn(t, currency, base) {
  if ((t.currency ?? base) === currency) return t.originalAmount ?? t.amount;
  if (currency === base) return t.amount;
  return null;
}

// Deposits and withdrawals for an investment account, in the main currency.
export function investmentFlows(account, transactions, from) {
  const keyword = account.match ?? account.name;
  let deposits = 0;
  let withdrawals = 0;
  for (const t of transactions) {
    if (from && t.date <= from) continue;
    if (!matchesKeyword(t.description, keyword)) continue;
    if (t.amount < 0) deposits -= t.amount;
    else withdrawals += t.amount;
  }
  return { deposits: round2(deposits), withdrawals: round2(withdrawals) };
}

// Every account with its current balance, in its own currency and the main one.
// [{ name, type, currency, balance, value (main currency), asOf, source, account?, details? }]
// Liquid ones (bank, cash, investment) count as FIRE savings; property and loans only in net worth.
export function accountList(state, date = today()) {
  const base = state.settings.currency;
  const context = rateContext(state);
  const toMain = (amount, currency) => {
    const rate = rateFor(currency, date, context);
    return rate ? round2(amount / rate) : null;
  };
  const setup = state.accounts ?? [];
  const out = [];

  // Bank accounts: the newest of the statement balance and the typed opening balance,
  // plus transactions on that account after it.
  const names = new Set([...Object.keys(state.balances ?? {}), ...setup.filter((a) => a.type === 'bank').map((a) => a.name)]);
  for (const name of names) {
    const fromStatement = state.balances?.[name];
    const typed = setup.find((a) => a.name === name && a.type === 'bank');
    const anchor = [fromStatement && { ...fromStatement, source: 'statement' }, typed?.asOf && { date: typed.asOf, balance: typed.balance, currency: typed.currency, source: 'setup' }]
      .filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!anchor) continue;
    const currency = anchor.currency ?? typed?.currency ?? base;
    let balance = anchor.balance;
    for (const t of state.transactions) {
      if (t.account !== name || t.date <= anchor.date) continue;
      const v = amountIn(t, currency, base);
      if (v != null) balance += v;
    }
    balance = round2(balance);
    out.push({ name, type: 'bank', currency, balance, value: toMain(balance, currency), asOf: anchor.date, source: anchor.source, hidden: typed?.hidden });
  }

  // Cash in hand: withdrawals (the Cash category, or the Cash part of a split) add to it,
  // spending on the Cash account takes from it.
  const cash = setup.find((a) => a.type === 'cash');
  const since = cash?.asOf ?? '';
  let wallet = cash?.balance ?? 0;
  let seen = Boolean(cash);
  for (const p of partsOf(state)) {
    if (p.t.date <= since) continue;
    if (p.t.account === CASH_ACCOUNT) {
      if (p.kind !== 'cash-offset') wallet += p.amount;
      seen = true;
    } else if (p.category === CASH_CATEGORY && p.kind !== 'payback') {
      wallet -= p.amount;
      seen = true;
    }
  }
  if (seen) {
    wallet = round2(wallet);
    out.push({ name: cash?.name ?? CASH_ACCOUNT, type: 'cash', currency: base, balance: wallet, value: wallet, asOf: date, source: cash ? 'counted' : 'estimate', account: cash });
  }

  for (const a of setup) {
    if (a.type === 'investment') {
      const currency = a.currency ?? base;
      const value = a.value ?? a.initial ?? 0;
      const flows = investmentFlows(a, state.transactions, a.initialDate);
      const valueMain = toMain(value, currency);
      const initialMain = toMain(a.initial ?? 0, currency);
      const profit = valueMain != null && initialMain != null ? round2(valueMain + flows.withdrawals - flows.deposits - initialMain) : null;
      out.push({ name: a.name, type: 'investment', currency, balance: value, value: valueMain, asOf: a.asOf, source: a.value != null ? 'typed' : 'missing', account: a, details: { ...flows, profit, initialMain } });
    } else if (a.type === 'property') {
      const currency = a.currency ?? base;
      out.push({ name: a.name, type: 'property', currency, balance: a.value ?? 0, value: toMain(a.value ?? 0, currency), asOf: a.asOf, source: 'typed', account: a });
    } else if (a.type === 'loan') {
      const currency = a.currency ?? base;
      const status = a.principal && a.firstPayment ? loanStatus(a, date) : null;
      const balance = status ? -status.owed : a.balance ?? 0;
      out.push({ name: a.name, type: 'loan', currency, balance, value: toMain(balance, currency), asOf: status ? date : a.asOf, source: status ? 'estimate' : 'typed', account: a, details: status });
    }
  }
  return out;
}

const LIQUID = ['bank', 'cash', 'investment'];

// { netWorth, liquid, property, loans, missing: [names without a rate] } in the main currency.
export function netWorth(list) {
  const sum = (types) => round2(list.filter((a) => types.includes(a.type) && !a.hidden && a.value != null).reduce((s, a) => s + a.value, 0));
  return {
    netWorth: sum([...LIQUID, 'property', 'loan']),
    liquid: sum(LIQUID),
    property: sum(['property']),
    loans: sum(['loan']),
    missing: list.filter((a) => a.value == null).map((a) => a.name),
  };
}

// A savings goal: how much of it the chosen accounts hold (bank accounts and
// cash when none are chosen), in the main currency.
export function goalProgress(goal, list) {
  const counted = list.filter((a) => !a.hidden && a.value != null
    && (goal.accounts?.length ? goal.accounts.includes(a.name) : ['bank', 'cash'].includes(a.type)));
  const saved = round2(counted.reduce((s, a) => s + a.value, 0));
  const target = goal.target ?? 0;
  return {
    saved,
    target,
    left: round2(Math.max(0, target - saved)),
    share: target > 0 ? Math.min(1, Math.max(0, saved / target)) : 1,
    accounts: counted.map((a) => a.name),
  };
}

// The flat: the property account, its loan and its category group.
export function flatSetup(state) {
  const property = (state.accounts ?? []).find((a) => a.type === 'property');
  if (!property) return null;
  const group = property.group ?? property.name;
  const categories = state.categories.filter((c) => c.parent === group || c.name === group).map((c) => c.name);
  const loan = (state.accounts ?? []).find((a) => a.type === 'loan' && (a.category ? categories.includes(a.category) : true));
  return { property, loan, group, categories, currency: property.currency ?? state.settings.currency };
}
