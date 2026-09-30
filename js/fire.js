// FIRE maths. Pure functions, no screen code.
// All returns are "real" (after inflation), so results are in today's money.

// How much you need invested: yearly spending ÷ withdrawal rate (4% → 25× spending).
export function fireNumber(annualSpending, withdrawalRatePct) {
  if (!(withdrawalRatePct > 0)) return Infinity;
  return annualSpending / (withdrawalRatePct / 100);
}

// Share of income you keep. null when there's no income to measure against.
export function savingsRate(income, spending) {
  if (!(income > 0)) return null;
  return (income - spending) / income;
}

// Monthly growth that compounds to the yearly return.
export function monthlyRate(annualReturnPct) {
  return Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
}

// A number, or a function of the month (1, 2, …) for amounts that change over time.
const at = (v, month) => (typeof v === 'function' ? v(month) : v);

// Months until savings reach the target, adding an amount each month.
// Returns null if it never gets there within maxYears.
export function monthsToTarget({ savings, monthlyContribution, annualReturnPct, target, maxYears = 100 }) {
  if (savings >= at(target, 0)) return 0;
  const r = monthlyRate(annualReturnPct);
  const fixed = typeof monthlyContribution !== 'function';
  let balance = savings;
  for (let month = 1; month <= maxYears * 12; month++) {
    balance = balance * (1 + r) + at(monthlyContribution, month);
    if (balance >= at(target, month)) return month;
    if (fixed && balance <= 0 && monthlyContribution <= 0) return null;
  }
  return null;
}

// Balance at the end of each year, starting with today (year 0).
export function projectBalances({ savings, monthlyContribution, annualReturnPct, years }) {
  const r = monthlyRate(annualReturnPct);
  const points = [savings];
  let balance = savings;
  for (let month = 1; month <= years * 12; month++) {
    balance = Math.max(0, balance * (1 + r) + at(monthlyContribution, month));
    if (month % 12 === 0) points.push(balance);
  }
  return points;
}

// Everything the FIRE screen shows for one set of inputs.
//
// With a rented flat (all in the main currency):
//   flat.rent            yearly rent received (in annualIncome)
//   flat.mortgageCosts   yearly mortgage interest and fees (in annualSpending)
//   flat.payment         the whole monthly mortgage payment, principal included
//   flat.owed[m]         still owed after m more months (owed[0] is today)
//   flat.keepRent        the rent keeps coming after you retire
// The mortgage is paid from income until it ends, and then that money is saved
// too. Once retired, savings only cover what the rent doesn't, plus enough to
// pay off what's still owed on the mortgage.
export function runScenario({ annualSpending, annualIncome, savings, annualReturnPct, withdrawalRatePct, flat }) {
  if (!flat) {
    const target = fireNumber(annualSpending, withdrawalRatePct);
    const monthlyContribution = (annualIncome - annualSpending) / 12;
    const months = Number.isFinite(target)
      ? monthsToTarget({ savings, monthlyContribution, annualReturnPct, target })
      : null;
    return { target, monthlyContribution, contribution: monthlyContribution, savingsRate: savingsRate(annualIncome, annualSpending), months };
  }
  const spending = annualSpending - flat.mortgageCosts;
  const need = Math.max(0, spending - (flat.keepRent ? flat.rent : 0));
  const invested = fireNumber(need, withdrawalRatePct);
  const paymentsLeft = flat.owed.length - 1;
  const owed = (m) => (m < paymentsLeft ? flat.owed[m] : 0);
  const target = (m) => invested + owed(m);
  const afterLoan = (annualIncome - spending) / 12;
  const contribution = (m) => afterLoan - (m <= paymentsLeft ? flat.payment : 0);
  const months = Number.isFinite(invested)
    ? monthsToTarget({ savings, monthlyContribution: contribution, annualReturnPct, target })
    : null;
  return {
    target: target(months ?? 0),
    monthlyContribution: contribution(1),
    contribution,
    savingsRate: savingsRate(annualIncome, annualSpending),
    months,
    flat: {
      need,
      invested,
      withoutRent: fireNumber(spending, withdrawalRatePct),
      owedAtFire: months != null ? owed(months) : null,
      afterLoan,
      paymentsLeft,
    },
  };
}

// 150 → "12 years 6 months"
export function describeMonths(months) {
  if (months == null) return 'Not reachable';
  if (months === 0) return 'Already there';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}
