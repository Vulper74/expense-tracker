// Dashboard: Overview (one month and the 12 before it, and your goals), Budgets
// (this month and warnings), Regular payments and the flat (rent against costs,
// in its own currency).

import { groupedColumnChart, horizontalBarChart, lineChart } from './charts.js';
import { monthStatus } from './budgets.js';
import { accountList, flatSetup, goalProgress, netWorth } from './accounts.js';
import { regularPayments } from './recurring.js';
import { monthKey, monthlySummary, partsOf, recentAverages, recentMonths } from './stats.js';
import { moneyFormatter } from './currency.js';
import { renderBudgets, warningDetail } from './budgets-view.js';
import { renderFlat } from './flat-view.js';
import { el, fill, formatDate, formatMoney, formatMonth, formatPercent } from './util.js';

let selectedMonth = null;
let section = 'overview';

export function renderDashboard(root, store, { goTo }) {
  const { state } = store;
  const parts = partsOf(state);
  const summary = monthlySummary(parts);
  const flat = flatSetup(state);
  const importPrompt = () => el('div', { class: 'card empty' },
    el('p', { text: 'Import your bank transactions to see where your money goes.' }),
    flat ? null : el('p', { class: 'muted', text: 'Have a flat or a mortgage? Load your setup file in Settings, or add the flat on the Accounts tab, and it gets its own section here.' }),
    el('button', { class: 'primary', text: 'Import a statement', onclick: () => goTo('import') }));
  if (!summary.length && !flat) {
    fill(root, el('h2', { text: 'Dashboard' }), importPrompt());
    return;
  }

  const sections = [['overview', 'Overview'], ['budgets', 'Budgets'], ['regular', 'Regular'], ...(flat ? [['flat', flat.property.name]] : [])];
  if (!sections.some(([k]) => k === section)) section = 'overview';
  const rerender = () => renderDashboard(root, store, { goTo });
  const body = el('div');

  fill(root, 
    el('h2', { text: 'Dashboard' }),
    el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Dashboard sections' },
      sections.map(([key, label]) => el('button', {
        role: 'tab',
        'aria-selected': String(section === key),
        class: section === key ? 'active' : null,
        text: label,
        onclick: () => { section = key; rerender(); },
      }))),
    body,
  );

  if (section === 'budgets') renderBudgets(body, store, { parts, rerender });
  else if (section === 'flat') renderFlat(body, store, { parts, flat });
  else if (section === 'regular') regular(body, store, { goTo });
  else if (!summary.length) fill(body, importPrompt());
  else overview(body, store, { parts, summary, rerender, goTo });
}

function overview(root, store, { parts, summary, rerender, goTo }) {
  const { state } = store;
  const months = summary.map((m) => m.month);
  // Open on the last full month: the current one is still in progress.
  const thisMonth = monthKey(new Date());
  const monthLabel = (m) => (m === thisMonth ? `${formatMonth(m)} (so far)` : formatMonth(m));
  if (!months.includes(selectedMonth)) {
    selectedMonth = months.length > 1 && months[months.length - 1] === thisMonth ? months[months.length - 2] : months[months.length - 1];
  }
  const index = months.indexOf(selectedMonth);
  const current = summary[index];
  const previous = summary[index - 1];
  const window12 = summary.slice(Math.max(0, index - 11), index + 1);
  const averages = recentAverages(summary.slice(0, index + 1));

  const { money, compact } = moneyFormatter(state);

  // Sub-categories are added up under their group here; the group has its own section.
  const parentOf = new Map(state.categories.filter((c) => c.parent).map((c) => [c.name, c.parent]));
  const grouped = {};
  for (const [name, value] of Object.entries(current.byCategory)) {
    const label = parentOf.get(name) ?? name;
    grouped[label] = (grouped[label] ?? 0) + value;
  }
  const categories = Object.entries(grouped)
    .map(([label, value]) => ({ label, value }))
    .filter((c) => c.value > 0.005)
    .sort((a, b) => b.value - a.value);

  const labels = window12.map((m) => formatMonth(m.month, { short: true }));
  const oneOffSpent = current.spending - current.regular.spending;
  const oneOffIncome = current.income - current.regular.income;

  const warnings = monthStatus(parts, state.budgets, new Date()).rows.filter((r) => r.warnings.length);
  const accounts = accountList(state);
  const worth = accounts.length ? netWorth(accounts) : null;
  // What reaches your accounts each month: income minus spending and mortgage principal.
  const recent = recentAverages(summary);
  const used = new Set(recentMonths(summary));
  const principal = used.size ? summary.filter((m) => used.has(m.month)).reduce((t, m) => t + m.principal, 0) / used.size : 0;
  const saving = recent.monthlyIncome - recent.monthlySpending - principal;

  fill(root, 
    warnings.length
      ? el('section', { class: 'card warnings' },
        el('h3', { text: `Heads up · ${formatMonth(thisMonth)}` }),
        el('ul', { class: 'plain' }, warnings.slice(0, 5).map((r) => el('li', {},
          el('strong', { text: r.category }), ` · ${r.warnings.map((w) => w.text).join(', ')}. `,
          el('span', { class: 'muted', text: warningDetail(r, money) })))),
        el('button', { class: 'link', text: 'See budgets →', onclick: () => { section = 'budgets'; rerender(); } }))
      : null,

    el('div', { class: 'filters' },
      el('label', { class: 'inline-field' }, 'Month ',
        el('select', {
          value: selectedMonth,
          onchange: (e) => { selectedMonth = e.target.value; rerender(); },
        }, [...months].reverse().map((m) => el('option', { value: m, text: monthLabel(m) }))))),

    el('div', { class: 'tiles' },
      tile('Spent', money(current.spending), [previous && delta(current.spending, previous.spending, money), oneOffSpent > 0.005 ? `Includes ${money(oneOffSpent)} one-off` : null]),
      tile('Income', money(current.income), [previous && delta(current.income, previous.income, money), Math.abs(oneOffIncome) > 0.005 ? `Includes ${money(oneOffIncome)} one-off` : null]),
      tile('Savings rate', formatPercent(current.savingsRate), [current.savingsRate == null ? 'No income this month' : savedText(current.income - current.spending, money),
        current.principal > 0.005 ? `Plus ${money(current.principal)} paid off the mortgage` : null]),
      tile('Average monthly spending', money(averages.monthlySpending), [`Over ${averages.monthsUsed} month${averages.monthsUsed === 1 ? '' : 's'}, without one-offs`]),
      worth ? tile('Net worth', money(worth.netWorth), [`${money(worth.liquid)} in accounts and investments`], () => goTo('accounts')) : null,
    ),

    state.goals.length ? goalsCard(state.goals, accounts, saving, money, goTo) : null,

    el('section', { class: 'card' },
      el('h3', { text: `Spending by category · ${monthLabel(selectedMonth)}` }),
      horizontalBarChart(categories, { format: money, emptyText: 'No spending this month.' })),

    el('section', { class: 'card' },
      el('h3', { text: 'Income and spending by month' }),
      groupedColumnChart(labels, [
        { name: 'Income', values: window12.map((m) => m.income) },
        { name: 'Spending', values: window12.map((m) => m.spending) },
      ], { format: money, tickFormat: compact })),

    el('section', { class: 'card' },
      el('h3', { text: 'Savings rate by month' }),
      el('p', { class: 'muted', text: 'The share of your income you didn’t spend. Months with no income are left blank.' }),
      lineChart(labels, [{ name: 'Savings rate', values: window12.map((m) => m.savingsRate) }], {
        format: (v) => formatPercent(v),
        xTitle: '',
      })),
  );
}

// Goals, e.g. an emergency fund: how far along, and how long at your recent pace.
function goalsCard(goals, accounts, saving, money, goTo) {
  return el('section', { class: 'card' },
    el('h3', { text: goals.length === 1 ? goals[0].name : 'Goals' }),
    goals.map((g) => {
      const p = goalProgress(g, accounts);
      const months = p.left > 0 && saving > 0 ? Math.ceil(p.left / saving) : null;
      return el('div', { class: 'goal' },
        goals.length > 1 ? el('strong', { text: g.name }) : null,
        el('div', { class: 'goal-head' },
          el('span', { class: 'goal-value', text: `${money(p.saved)} of ${money(p.target)}` }),
          el('span', { class: 'muted', text: formatPercent(p.share) })),
        el('div', { class: 'meter', role: 'meter', 'aria-valuenow': String(Math.round(p.share * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': g.name },
          el('span', { style: `width:${p.share * 100}%` })),
        el('p', { class: 'hint', text: p.left <= 0
          ? `Reached. Counted from ${p.accounts.join(', ') || 'no accounts yet'}.`
          : `${money(p.left)} to go${months ? `: about ${months} month${months === 1 ? '' : 's'} at your recent saving of ${money(saving)} a month` : ''}. Counted from ${p.accounts.join(', ') || 'no accounts yet'}.` }));
    }),
    el('button', { class: 'link', text: 'Change goals on the Accounts tab →', onclick: () => goTo('accounts') }));
}

// Regular payments found in your transactions.
function regular(root, store, { goTo }) {
  const { state } = store;
  const { money } = moneyFormatter(state);
  const list = regularPayments(state.transactions, state.categories, state.settings.currency);
  const names = new Map(state.categories.map((c) => [c.name, c]));
  const categoryLabel = (name) => (names.get(name)?.parent ? name.split(' / ').pop() : name);
  if (!list.length) {
    fill(root, el('section', { class: 'card empty' },
      el('p', { text: 'No regular payments found yet. They show once the same payee has charged about the same amount two months in a row.' })));
    return;
  }
  const monthly = list.reduce((s, r) => s + r.monthly, 0);
  const own = (r) => formatMoney(r.amount, r.currency);
  fill(root,
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' },
        el('div', { class: 'tile-label', text: 'Regular payments' }),
        el('div', { class: 'tile-value', text: money(monthly) }),
        el('div', { class: 'tile-note', text: `A month, ${money(monthly * 12)} a year, across ${list.length} payment${list.length === 1 ? '' : 's'}` }))),
    el('section', { class: 'card' },
      el('h3', { text: 'Every month' }),
      el('p', { class: 'hint', text: 'Found automatically: the same payee charging about the same amount about once a month. Worth a look for anything you no longer use.' }),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Payment' }), el('th', { class: 'num', text: 'Amount' }), el('th', { class: 'wide-only', text: 'Next around' }))),
        el('tbody', {}, list.map((r) => el('tr', {},
          el('td', {},
            el('div', { text: r.name }),
            el('span', { class: 'sub', text: [categoryLabel(r.category), `${r.count} payments`, r.previous != null ? `up from ${formatMoney(r.previous, r.currency)}` : null].filter(Boolean).join(' · ') })),
          el('td', { class: 'num' },
            el('div', { text: `${r.varies ? 'about ' : ''}${own(r)}` }),
            r.currency !== state.settings.currency ? el('span', { class: 'sub', text: money(r.monthly) }) : null),
          el('td', { class: 'wide-only', text: formatDate(r.next) }))))),
      el('button', { class: 'link', text: 'See transactions →', onclick: () => goTo('transactions') })),
  );
}

function tile(label, value, notes = [], onclick) {
  return el(onclick ? 'button' : 'div', { class: `tile${onclick ? ' link-tile' : ''}`, onclick },
    el('div', { class: 'tile-label', text: label }),
    el('div', { class: 'tile-value', text: value }),
    notes.filter(Boolean).map((n) => el('div', { class: 'tile-note', text: n })));
}

function savedText(saved, format) {
  return saved >= 0 ? `Saved ${format(saved)}` : `Spent ${format(-saved)} more than you earned`;
}

// "↑ $120 more than last month"
function delta(now, before, format) {
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return 'Same as last month';
  const word = diff > 0 ? 'more' : 'less';
  return `${diff > 0 ? '↑' : '↓'} ${format(Math.abs(diff))} ${word} than last month`;
}
