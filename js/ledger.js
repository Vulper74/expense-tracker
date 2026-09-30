// Turns transactions into the pieces that totals are made of.
// Most transactions are one piece. A transaction can also be:
// - split into parts with their own categories (an ATM withdrawal that was partly poker),
// - a payback that cancels part of earlier spending (a friend paying you back),
// - a loan payment, split into interest (a cost) and principal (money moved into the flat),
// - cash spent from the wallet, which was already counted when you withdrew it.
// Parts can be marked one-off so they don't skew averages, budgets and warnings.

import { categoryType } from './categorize.js';

export const CASH_ACCOUNT = 'Cash';
export const CASH_CATEGORY = 'Cash';
export const PAYBACK_DAYS = 62; // how far back a payback can reach (about two months)

const round2 = (n) => Math.round(n * 100) / 100;
const own = (t) => t.originalAmount ?? t.amount;

// ---- loans ----

// Monthly payment of a fixed-rate loan (annuity), before any fee.
export function annuity(principal, ratePercent, years) {
  const r = ratePercent / 100 / 12;
  const n = years * 12;
  return r ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n;
}

function monthIndex(from, date) {
  const [fy, fm] = from.split('-').map(Number);
  const [y, m] = date.split('-').map(Number);
  return (y - fy) * 12 + (m - fm);
}

// Amount owed (positive) right after payment number k (0 = first payment).
// The known balance (loan.balance, negative, on loan.asOf) is the anchor; months
// before or after are rolled from it with the loan's rate.
function balanceAfter(loan, k) {
  const r = loan.ratePercent / 100 / 12;
  const payment = annuity(loan.principal, loan.ratePercent, loan.years);
  const anchorIndex = monthIndex(loan.firstPayment, loan.asOf ?? loan.firstPayment);
  let balance = loan.balance != null ? Math.abs(loan.balance) : loan.principal;
  if (loan.balance == null) {
    // No known balance: start from the original amount before the first payment.
    for (let i = 0; i <= k; i++) balance = balance * (1 + r) - payment;
    return Math.max(0, balance);
  }
  if (k >= anchorIndex) for (let i = anchorIndex; i < k; i++) balance = balance * (1 + r) - payment;
  else for (let i = anchorIndex; i > k; i--) balance = (balance + payment) / (1 + r);
  return Math.max(0, balance);
}

// One payment split into interest, principal and fee, in the loan's currency.
function daysBefore(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function loanPayment(loan, date) {
  const k = monthIndex(loan.firstPayment, date);
  const r = loan.ratePercent / 100 / 12;
  const scheduled = annuity(loan.principal, loan.ratePercent, loan.years);
  const before = k <= 0 ? loan.principal : balanceAfter(loan, k - 1);
  const interest = before * r;
  const principal = Math.min(before, scheduled - interest);
  return {
    number: k + 1,
    interest: round2(interest),
    principal: round2(principal),
    fee: loan.payment ? round2(Math.max(0, loan.payment - scheduled)) : 0,
    balanceAfter: round2(before - principal),
  };
}

// Where a loan stands on a date: payments made, what's owed, totals paid so far.
export function loanStatus(loan, date) {
  const made = loan.firstPayment && date >= loan.firstPayment
    ? monthIndex(loan.firstPayment, date) + (Number(date.slice(8, 10)) >= Number(loan.firstPayment.slice(8, 10)) ? 1 : 0)
    : 0;
  const n = loan.years * 12;
  const owed = made ? balanceAfter(loan, made - 1) : loan.principal;
  return {
    paymentsMade: made,
    paymentsLeft: Math.max(0, n - made),
    owed: round2(owed),
    principalPaid: round2(loan.principal - owed),
    monthlyPayment: round2(loan.payment ?? annuity(loan.principal, loan.ratePercent, loan.years)),
    next: made < n ? loanPayment(loan, addMonths(loan.firstPayment, made)) : null,
    endDate: addMonths(loan.firstPayment, n - 1),
  };
}

export function addMonths(date, count) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---- parts ----

// Rest of a split transaction, in its own currency.
export function splitRest(t) {
  return round2(own(t) - (t.splits ?? []).reduce((s, p) => s + p.amount, 0));
}

// The category a payback lands in: the biggest part of the expense it repays.
function mainCategory(t) {
  if (!t.splits?.length) return t.category;
  const pieces = [{ amount: splitRest(t), category: t.category }, ...t.splits];
  return pieces.sort((a, b) => a.amount - b.amount)[0].category;
}

// Every piece that totals are made of:
// { t, date, month, amount (main currency), original (t's own currency), currency,
//   category, type ('expense' | 'income' | 'transfer'), oneOff, kind? }
// kind: 'split' | 'payback' | 'principal' | 'interest' | 'cash-offset'.
// Principal parts have type 'transfer': they move money into the loan, they aren't spent.
export function transactionParts(transactions, { categories, accounts = [], base } = {}) {
  const typeOf = (name) => categoryType(name, categories);
  const loans = accounts.filter((a) => a.type === 'loan' && a.category && a.principal && a.firstPayment);
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const repaid = new Map(); // expense id -> amount already paid back
  const parts = [];

  const push = (t, piece) => {
    const ratio = own(t) ? t.amount / own(t) : 1;
    const date = piece.date ?? t.date;
    parts.push({
      t,
      date,
      month: date.slice(0, 7),
      amount: round2(piece.original * ratio),
      original: piece.original,
      currency: t.currency ?? base,
      category: piece.category,
      type: piece.type ?? typeOf(piece.category),
      oneOff: Boolean(piece.oneOff ?? t.oneOff),
      kind: piece.kind,
      note: piece.note,
      repays: piece.repays,
    });
  };

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    let rest = own(t);

    for (const p of t.splits ?? []) {
      push(t, { original: p.amount, category: p.category, oneOff: p.oneOff, note: p.note, kind: 'split' });
      rest -= p.amount;
    }

    // A payback cancels spending in the month it was spent.
    if (t.repays?.length && rest > 0) {
      const linked = t.repays.map((id) => byId.get(id)).filter((e) => e && own(e) < 0).sort((a, b) => a.date.localeCompare(b.date));
      for (const e of linked) {
        const ratio = own(t) ? t.amount / own(t) : 1;
        const open = Math.abs(e.amount) - (repaid.get(e.id) ?? 0); // main currency
        const take = Math.min(rest * ratio, open) / ratio; // t's currency
        if (!(take > 0.005)) continue;
        repaid.set(e.id, (repaid.get(e.id) ?? 0) + take * ratio);
        push(t, { original: take, category: mainCategory(e), date: e.date, oneOff: e.oneOff, kind: 'payback', repays: e.id });
        rest -= take;
      }
    }

    if (Math.abs(rest) < 0.005) continue;

    // Loan payment: interest and fee are a cost, principal is not.
    // Payments from shortly before the first one (banks sometimes take it early) on.
    const loan = rest < 0 && loans.find((l) => l.category === t.category);
    const loanCurrency = loan && (t.currency ?? base) === loan.currency;
    if (loan && loanCurrency && (!loan.firstPayment || t.date >= daysBefore(loan.firstPayment, 10))) {
      const { principal } = loanPayment(loan, t.date);
      const moved = -Math.min(Math.abs(rest), Math.max(0, principal));
      push(t, { original: round2(rest - moved), category: t.category, kind: 'interest' });
      if (moved) push(t, { original: round2(moved), category: t.category, type: 'transfer', kind: 'principal' });
      continue;
    }

    push(t, { original: rest, category: t.category });

    // Spent from the wallet: the money already counted as Cash when it was withdrawn.
    if (t.account === CASH_ACCOUNT && rest < 0 && t.category !== CASH_CATEGORY && typeOf(t.category) === 'expense') {
      push(t, { original: -rest, category: CASH_CATEGORY, kind: 'cash-offset' });
    }
  }
  return parts;
}

// How much of each expense has been paid back, in the main currency: Map(expense id -> amount).
export function repaidAmounts(parts) {
  const map = new Map();
  for (const p of parts) if (p.kind === 'payback') map.set(p.repays, (map.get(p.repays) ?? 0) + p.amount);
  return map;
}

// Earlier spending an incoming payment could be paying back, closest amount first.
export function paybackCandidates(t, transactions, categories, days = PAYBACK_DAYS) {
  if (!(t.amount > 0)) return [];
  const until = Date.parse(t.date);
  const from = until - days * 86400000;
  return transactions
    .filter((e) => e.id !== t.id && e.amount < 0 && categoryType(e.category, categories) === 'expense')
    .filter((e) => {
      const at = Date.parse(e.date);
      return at >= from && at <= until;
    })
    .sort((a, b) => Math.abs(Math.abs(a.amount) - t.amount) - Math.abs(Math.abs(b.amount) - t.amount));
}
