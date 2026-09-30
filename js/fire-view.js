// FIRE planner: your numbers + assumptions → FIRE number, time to FIRE, what-if sliders.

import { lineChart } from './charts.js';
import { describeMonths, projectBalances, runScenario } from './fire.js';
import { accountList, flatSetup, netWorth, today } from './accounts.js';
import { moneyFormatter, rateContext, rateFor } from './currency.js';
import { addMonths, loanStatus } from './ledger.js';
import { flatAverages, monthlySummary, partsOf, recentAverages } from './stats.js';
import { el, fill, formatDate, formatMoney, formatPercent } from './util.js';

// What-if changes are for exploring, so they aren't saved.
const whatIf = { spendingPct: 0, incomePct: 0 };

export function renderFire(root, store) {
  const { state } = store;
  // Inputs are typed in your main currency; results follow the currency switch.
  const currency = state.settings.currency;
  const fmt = moneyFormatter(state);
  const money = (v) => fmt.money(v, Math.abs(v) >= 1e6 ? { compact: true } : { whole: true });
  const round = (v) => fmt.whole(v);

  const parts = partsOf(state);
  const summary = monthlySummary(parts);
  const averages = recentAverages(summary);
  const flat = flatInputs(state, parts, summary);
  const accounts = accountList(state);
  const fromAccounts = accounts.length ? netWorth(accounts).liquid : null;
  const tracker = {
    spending: averages.monthlySpending * 12,
    income: averages.monthlyIncome * 12,
  };

  const results = el('div');
  const chartArea = el('section', { class: 'card' });

  const save = (mutator) => {
    store.commit((s) => mutator(s.fire));
    refresh();
  };

  // ---- inputs ----
  const numberField = (label, key, { hint, placeholder } = {}) =>
    el('label', { class: 'field' }, label,
      el('input', {
        type: 'number',
        min: '0',
        step: 'any',
        inputmode: 'decimal',
        value: state.fire[key] == null ? '' : String(state.fire[key]),
        placeholder,
        oninput: (e) => save((f) => { f[key] = e.target.value === '' ? null : Number(e.target.value); }),
      }),
      hint ? el('span', { class: 'hint', text: hint }) : null);

  const slider = ({ label, min, max, step, get, set, show }) => {
    const output = el('output', { text: show(get()) });
    return el('label', { class: 'field slider' },
      el('span', { class: 'slider-head' }, label, output),
      el('input', {
        type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()),
        oninput: (e) => {
          set(Number(e.target.value));
          output.textContent = show(get());
        },
      }));
  };

  const fromTracker = averages.monthsUsed
    ? (v) => `Leave blank to use your transactions: ${formatMoney(v, currency, { whole: true })} a year (average of ${averages.monthsUsed} month${averages.monthsUsed === 1 ? '' : 's'}, without one-offs).`
    : () => 'No transactions yet, so type a yearly amount (or import your bank CSV).';

  const whatIfSliders = [
    slider({
      label: 'Spending',
      min: -50, max: 50, step: 5,
      get: () => whatIf.spendingPct,
      set: (v) => { whatIf.spendingPct = v; refresh(); },
      show: (v) => signedPct(v),
    }),
    slider({
      label: 'Income',
      min: -50, max: 50, step: 5,
      get: () => whatIf.incomePct,
      set: (v) => { whatIf.incomePct = v; refresh(); },
      show: (v) => signedPct(v),
    }),
  ];

  fill(root, 
    el('h2', { text: 'FIRE planner' }),
    el('p', { class: 'muted', text: 'Estimates based on your own numbers and assumptions. This is a calculator, not financial advice. All amounts are in today’s money (returns are after inflation).' }),

    el('div', { class: 'fire-layout' },
      el('div', { class: 'fire-inputs' },
        el('section', { class: 'card' },
          el('h3', { text: 'Your numbers' }),
          numberField(`Savings today (${currency})`, 'savings', fromAccounts != null
            ? { hint: `Leave blank to use your accounts: ${formatMoney(fromAccounts, currency, { whole: true })} in bank accounts, cash and investments (the flat isn’t counted).`, placeholder: String(Math.round(fromAccounts)) }
            : { hint: 'Money set aside for FIRE: investment accounts, retirement accounts.' }),
          numberField(`Yearly spending (${currency})`, 'spendingOverride', { hint: fromTracker(tracker.spending), placeholder: averages.monthsUsed ? String(Math.round(tracker.spending)) : '' }),
          numberField(`Yearly income after tax (${currency})`, 'incomeOverride', { hint: fromTracker(tracker.income), placeholder: averages.monthsUsed ? String(Math.round(tracker.income)) : '' }),
          numberField('Your age (optional)', 'currentAge')),

        el('section', { class: 'card' },
          el('h3', { text: 'Assumptions' }),
          slider({
            label: 'Investment return per year (after inflation)',
            min: 0, max: 10, step: 0.5,
            get: () => state.fire.annualReturn,
            set: (v) => save((f) => { f.annualReturn = v; }),
            show: (v) => `${v}%`,
          }),
          slider({
            label: 'Safe withdrawal rate',
            min: 2.5, max: 6, step: 0.25,
            get: () => state.fire.withdrawalRate,
            set: (v) => save((f) => { f.withdrawalRate = v; }),
            show: (v) => `${v}%`,
          }),
          el('p', { class: 'hint', text: 'The withdrawal rate is how much of your savings you’d take out each year once retired. 4% is a common starting point (it means 25× your yearly spending). Lower is more cautious.' }),
          flat
            ? el('label', { class: 'check-field' },
              el('input', { type: 'checkbox', checked: state.fire.keepRent !== false, onchange: (e) => save((f) => { f.keepRent = e.target.checked; }) }),
              el('span', {}, `${flat.name} is still rented out after you retire`,
                el('span', { class: 'hint', text: 'Its rent then pays part of your spending, so you need less invested. Untick it if you’d sell it or move in.' })))
            : null),

        el('section', { class: 'card' },
          el('h3', { text: 'What if…' }),
          el('p', { class: 'hint', text: 'Try changes without touching your real numbers.' }),
          ...whatIfSliders,
          el('button', {
            class: 'small',
            text: 'Reset what-ifs',
            onclick: () => {
              whatIf.spendingPct = 0;
              whatIf.incomePct = 0;
              renderFire(root, store);
            },
          }))),

      el('div', { class: 'fire-results' }, results, chartArea)),
  );
  refresh();

  // What the flat changes, in words.
  function flatCard(plan, f) {
    const p = plan.flat;
    const rentNet = flat.plan.rent - (flat.costs - flat.plan.mortgageCosts);
    const loanEnds = p.paymentsLeft ? formatDate(flat.loanEnd) : null;
    return el('section', { class: 'card' },
      el('h3', { text: `${flat.name} in your plan` }),
      el('ul', { class: 'plain spaced' },
        f.keepRent !== false
          ? el('li', {}, `Rent after the flat’s other costs: about ${round(rentNet)} a year. Once you retire it pays part of your spending, so you need ${money(p.invested)} invested instead of ${money(p.withoutRent)}.`)
          : el('li', {}, `The rent isn’t counted after you retire, so your savings cover all your spending.`),
        loanEnds
          ? el('li', {}, `Until ${loanEnds} the mortgage (${round(flat.plan.payment)} a month) comes out of your income, so you invest ${round(plan.monthlyContribution)} a month. After that it’s ${round(p.afterLoan)}.`)
          : null,
        p.owedAtFire
          ? el('li', {}, `When you reach FIRE you’d still owe about ${money(p.owedAtFire)} on the mortgage, so the FIRE number includes enough to pay it off.`)
          : null,
        el('li', { class: 'muted' }, `Rent and flat costs are your averages over the same months as your spending. The flat’s value isn’t counted as savings.`)));
  }

  function refresh() {
    const f = state.fire;
    const baseSpending = f.spendingOverride ?? tracker.spending;
    const baseIncome = f.incomeOverride ?? tracker.income;
    const withFlat = flat ? { ...flat.plan, keepRent: f.keepRent !== false } : undefined;
    const common = { savings: f.savings || (fromAccounts ?? 0), annualReturnPct: f.annualReturn, withdrawalRatePct: f.withdrawalRate, flat: withFlat };
    const plan = runScenario({ ...common, annualSpending: baseSpending, annualIncome: baseIncome });
    const active = whatIf.spendingPct !== 0 || whatIf.incomePct !== 0;
    const alt = active
      ? runScenario({ ...common, annualSpending: baseSpending * (1 + whatIf.spendingPct / 100), annualIncome: baseIncome * (1 + whatIf.incomePct / 100) })
      : null;

    if (!(baseSpending > 0)) {
      fill(results, el('section', { class: 'card empty' },
        el('p', { text: 'Enter your yearly spending (or import transactions) to see your FIRE number.' })));
      chartArea.hidden = true;
      return;
    }
    chartArea.hidden = false;

    const whatIfNote = (text) => (alt ? el('div', { class: 'whatif-note', text: `What-if: ${text}` }) : null);

    fill(results, 
      el('section', { class: 'card hero' },
        el('div', { class: 'tile-label', text: 'Time to FIRE' }),
        el('div', { class: 'hero-value', text: describeMonths(plan.months) }),
        el('div', { class: 'tile-note', text: whenText(plan.months, f.currentAge, plan) }),
        alt ? whatIfNote(`${describeMonths(alt.months)}${comparison(plan.months, alt.months)}`) : null),
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' },
          el('div', { class: 'tile-label', text: 'FIRE number' }),
          el('div', { class: 'tile-value', text: money(plan.target) }),
          el('div', { class: 'tile-note', text: plan.flat
            ? `${round(plan.flat.need)} a year ÷ ${f.withdrawalRate}%${plan.flat.owedAtFire ? `, plus ${round(plan.flat.owedAtFire)} to pay off the mortgage` : ''}`
            : `${round(baseSpending)} a year ÷ ${f.withdrawalRate}%` }),
          alt ? whatIfNote(money(alt.target)) : null),
        el('div', { class: 'tile' },
          el('div', { class: 'tile-label', text: 'Savings rate' }),
          el('div', { class: 'tile-value', text: formatPercent(plan.savingsRate) }),
          el('div', { class: 'tile-note', text: 'Of income after tax' }),
          alt ? whatIfNote(formatPercent(alt.savingsRate)) : null),
        el('div', { class: 'tile' },
          el('div', { class: 'tile-label', text: 'Saving each month' }),
          el('div', { class: 'tile-value', text: round(plan.monthlyContribution) }),
          el('div', { class: 'tile-note', text: plan.flat?.paymentsLeft ? 'Income minus spending and the mortgage, invested' : 'Income minus spending, invested' }),
          alt ? whatIfNote(round(alt.monthlyContribution)) : null)),
      plan.flat ? flatCard(plan, f) : null,
    );

    // Projection chart: long enough to show both plans reaching the target.
    const reachYears = [plan.months, alt?.months].filter((m) => m != null).map((m) => Math.ceil(m / 12));
    const years = Math.min(60, Math.max(10, (reachYears.length ? Math.max(...reachYears) : 37) + 3));
    const thisYear = new Date().getFullYear();
    const labels = [...Array(years + 1).keys()].map((i) => String(thisYear + i));
    const series = [{ name: 'Your plan', values: projectBalances({ ...common, monthlyContribution: plan.contribution, years }) }];
    const references = [{ value: plan.target, label: `FIRE number ${money(plan.target)}` }];
    if (alt) {
      series.push({ name: 'What-if', values: projectBalances({ ...common, monthlyContribution: alt.contribution, years }) });
      if (Math.abs(alt.target - plan.target) > 1) references.push({ value: alt.target, label: `What-if FIRE number ${money(alt.target)}` });
    }
    fill(chartArea, 
      el('h3', { text: 'Projected savings' }),
      el('p', { class: 'muted', text: 'Invested savings growing at your return rate, with your monthly saving added each month.' }),
      lineChart(labels, series, {
        format: money,
        tickFormat: fmt.compact,
        references,
        xTitle: 'Year ',
      }));
  }
}

function signedPct(v) {
  return v === 0 ? 'No change' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
}

function whenText(months, age, plan) {
  if (months == null) {
    return plan.monthlyContribution <= 0
      ? 'You’re spending all your income, so savings can’t grow toward the target.'
      : 'Not within 100 years at these numbers.';
  }
  if (months === 0) return 'Your savings already cover your FIRE number.';
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const when = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return age ? `Around ${when}, at age ${Math.floor(age + months / 12)}` : `Around ${when}`;
}

function comparison(base, alt) {
  if (base == null || alt == null || base === alt) return '';
  const diff = Math.abs(base - alt);
  return ` (${describeMonths(diff)} ${alt < base ? 'sooner' : 'later'})`;
}

// The flat's numbers for the plan, in the main currency. null without a flat
// that has rent or a mortgage.
function flatInputs(state, parts, summary) {
  const flat = flatSetup(state);
  if (!flat) return null;
  const avg = flatAverages(parts, flat, summary);
  const date = today();
  const loan = flat.loan?.principal && flat.loan.firstPayment ? flat.loan : null;
  const rate = !loan || loan.currency === state.settings.currency ? 1 : rateFor(loan.currency, date, rateContext(state));
  const status = loan && rate ? loanStatus(loan, date) : null;
  if (!avg.rent && !status) return null;
  const owed = [];
  for (let m = 0; status && m <= status.paymentsLeft; m++) owed.push(loanStatus(loan, addMonths(date, m)).owed / rate);
  return {
    name: flat.property.name,
    costs: avg.costs * 12,
    loanEnd: status?.endDate,
    plan: {
      rent: avg.rent * 12,
      mortgageCosts: status ? avg.mortgageCosts * 12 : 0,
      payment: status ? status.monthlyPayment / rate : 0,
      owed: owed.length ? owed : [0],
    },
  };
}
