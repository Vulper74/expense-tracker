// The flat: rent received against its costs, in the flat's own currency.
// Mortgage payments are split into interest and fees (a cost) and principal
// (paying off the loan, so not a cost). Bills that come every two months are
// compared in two-month periods.

import { groupedColumnChart } from './charts.js';
import { shortName } from './categorize.js';
import { rateContext, rateFor } from './currency.js';
import { accountList } from './accounts.js';
import { loanPayment, loanStatus } from './ledger.js';
import { monthKey, nextMonth } from './stats.js';
import { el, fill, formatDate, formatMoney, formatMonth, formatPercent } from './util.js';

let shownIn = null; // currency the flat is shown in; its own by default
let selectedMonth = null;

const round2 = (n) => Math.round(n * 100) / 100;

export function renderFlat(root, store, { parts, flat }) {
  const { state } = store;
  const base = state.settings.currency;
  const currency = [flat.currency, base].includes(shownIn) ? shownIn : flat.currency;
  const context = rateContext(state);
  const money = (v) => formatMoney(v, currency, { whole: true });
  const rerender = () => renderFlat(root, store, { parts, flat });

  // A part's amount in the currency shown here.
  const inShown = (p) => {
    if (p.currency === currency) return p.original;
    if (currency === base) return p.amount;
    const rate = rateFor(currency, p.date, context);
    return rate ? p.amount * rate : 0;
  };
  const names = new Map(state.categories.map((c) => [c.name, c]));
  const label = (name) => (names.get(name) ? shortName(names.get(name)) : name);

  const mine = parts.filter((p) => flat.categories.includes(p.category));
  const months = new Map();
  const empty = (month) => ({ month, received: 0, costs: 0, principal: 0, byCategory: {} });
  for (const p of mine) {
    if (!months.has(p.month)) months.set(p.month, empty(p.month));
    const m = months.get(p.month);
    const v = inShown(p);
    if (p.kind === 'principal') m.principal -= v;
    else if (p.type === 'income') m.received += v;
    else if (p.type === 'expense') {
      m.costs -= v;
      const key = p.kind === 'interest' ? `${p.category}|interest` : p.category;
      m.byCategory[key] = (m.byCategory[key] ?? 0) - v;
    }
  }
  const keys = [...months.keys()].sort();
  if (!keys.length) {
    fill(root,
      el('section', { class: 'card empty' },
        el('p', { text: `No transactions in the ${flat.group} categories yet. Rent, bills and the mortgage show here once they’re categorised.` })),
      flat.loan ? loanCard(state, flat, currency, money) : null);
    return;
  }
  const all = [];
  for (let m = keys[0]; m <= keys[keys.length - 1]; m = nextMonth(m)) all.push(months.get(m) ?? empty(m));
  const monthList = all.map((m) => m.month);
  if (!monthList.includes(selectedMonth)) {
    const thisMonth = monthKey(new Date());
    selectedMonth = monthList.length > 1 && monthList[monthList.length - 1] === thisMonth ? monthList[monthList.length - 2] : monthList[monthList.length - 1];
  }
  const current = all[monthList.indexOf(selectedMonth)];
  const window12 = all.slice(Math.max(0, monthList.indexOf(selectedMonth) - 11), monthList.indexOf(selectedMonth) + 1);
  const total = all.reduce((t, m) => ({ received: t.received + m.received, costs: t.costs + m.costs, principal: t.principal + m.principal }), { received: 0, costs: 0, principal: 0 });

  const costLabel = (key) => (key.endsWith('|interest') ? `${label(key.split('|')[0])}: interest and fees` : label(key));

  fill(root, 
    el('div', { class: 'filters' },
      el('label', { class: 'inline-field' }, 'Month ',
        el('select', { value: selectedMonth, onchange: (e) => { selectedMonth = e.target.value; rerender(); } },
          [...monthList].reverse().map((m) => el('option', { value: m, text: formatMonth(m) })))),
      flat.currency !== base
        ? el('label', { class: 'inline-field' }, 'Show in ',
          el('select', { value: currency, onchange: (e) => { shownIn = e.target.value; rerender(); } },
            [flat.currency, base].map((c) => el('option', { value: c, text: c }))))
        : null),

    el('div', { class: 'tiles' },
      tile('Received', money(current.received), 'Rent and utilities from the tenant'),
      tile('Costs', money(current.costs), 'Bills, repairs, mortgage interest and fees'),
      tile('Net result', money(current.received - current.costs), current.received - current.costs >= 0 ? 'Earned after costs' : 'Cost you more than it brought in'),
      tile('Mortgage paid off', money(current.principal), 'Principal: it becomes yours, so it isn’t a cost')),

    el('section', { class: 'card' },
      el('h3', { text: `Costs · ${formatMonth(selectedMonth)}` }),
      Object.keys(current.byCategory).length
        ? el('table', {}, el('tbody', {},
          Object.entries(current.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => el('tr', {},
            el('td', { text: costLabel(k) }), el('td', { class: 'num', text: money(v) })))))
        : el('p', { class: 'muted', text: 'No costs this month.' })),

    el('section', { class: 'card' },
      el('h3', { text: 'Received and costs by month' }),
      groupedColumnChart(window12.map((m) => formatMonth(m.month, { short: true })), [
        { name: 'Received', values: window12.map((m) => round2(m.received)) },
        { name: 'Costs', values: window12.map((m) => round2(m.costs)) },
      ], { format: money, tickFormat: (v) => formatMoney(v, currency, { compact: true }) })),

    twoMonthCard(all, money, costLabel),

    flat.loan ? loanCard(state, flat, currency, money) : null,

    el('section', { class: 'card' },
      el('h3', { text: `Since ${formatMonth(monthList[0])}` }),
      el('table', {}, el('tbody', {},
        row('Received', money(total.received)),
        row('Costs', money(total.costs)),
        row('Net result', money(total.received - total.costs)),
        row('Mortgage paid off', money(total.principal)),
        row('Net result plus mortgage paid off', money(total.received - total.costs + total.principal))))),
  );
}

// Bills like water and electricity sometimes come every two months, so
// two-month periods (Jan–Feb, Mar–Apr, …) line them up.
function twoMonthCard(all, money, costLabel) {
  const periods = new Map();
  for (const m of all) {
    const [y, mm] = m.month.split('-').map(Number);
    const start = `${y}-${String(mm % 2 ? mm : mm - 1).padStart(2, '0')}`;
    if (!periods.has(start)) periods.set(start, { start, received: 0, costs: 0, byCategory: {}, months: 0 });
    const p = periods.get(start);
    p.months++;
    p.received += m.received;
    p.costs += m.costs;
    for (const [k, v] of Object.entries(m.byCategory)) p.byCategory[k] = (p.byCategory[k] ?? 0) + v;
  }
  const shown = [...periods.values()].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 4);
  const cats = [...new Set(shown.flatMap((p) => Object.keys(p.byCategory)))].sort();
  const name = (p) => {
    const [y, m] = p.start.split('-').map(Number);
    const second = `${y}-${String(m + 1).padStart(2, '0')}`;
    return `${formatMonth(p.start, { short: true }).split(' ')[0]}–${formatMonth(second, { short: true })}${p.months < 2 ? ' (1 month so far)' : ''}`;
  };
  return el('section', { class: 'card' },
    el('h3', { text: 'Two-month periods' }),
    el('p', { class: 'hint', text: 'Bills that come every two months are compared fairly here. Newest first.' }),
    el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: '' }), shown.map((p) => el('th', { class: 'num', text: name(p) })))),
        el('tbody', {},
          el('tr', {}, el('td', { text: 'Received' }), shown.map((p) => el('td', { class: 'num', text: money(p.received) }))),
          cats.map((c) => el('tr', {}, el('td', { class: 'indent', text: costLabel(c) }), shown.map((p) => el('td', { class: 'num', text: p.byCategory[c] ? money(p.byCategory[c]) : '–' })))),
          el('tr', { class: 'total' }, el('td', { text: 'Costs' }), shown.map((p) => el('td', { class: 'num', text: money(p.costs) }))),
          el('tr', { class: 'total' }, el('td', { text: 'Net result' }), shown.map((p) => el('td', { class: 'num', text: money(p.received - p.costs) })))))));
}

function loanCard(state, flat, currency, money) {
  const { loan, property } = flat;
  const date = new Date().toISOString().slice(0, 10);
  const status = loanStatus(loan, date);
  const account = accountList(state, date).find((a) => a.name === property.name);
  const conv = (v) => {
    if (currency === loan.currency) return v;
    const rate = rateFor(loan.currency, date, rateContext(state));
    return rate ? v / rate : v; // flat currency → main currency
  };
  const value = property.value ?? 0;
  const next = status.next;
  const upcoming = next ?? loanPayment(loan, date);
  return el('section', { class: 'card' },
    el('h3', { text: 'Mortgage' }),
    el('div', { class: 'tiles' },
      tile('Still owed', money(conv(status.owed)), `Estimated from the balance on ${formatDate(loan.asOf ?? loan.firstPayment)}`),
      tile('Flat value', money(conv(value)), account?.asOf ? `As of ${formatDate(account.asOf)}` : 'Change it on the Accounts tab'),
      tile('Your share (equity)', money(conv(value - status.owed)), value ? `${formatPercent((value - status.owed) / value)} of the value` : ''),
      tile('Payments left', String(status.paymentsLeft), `Last one ${formatDate(status.endDate)}`)),
    el('p', { class: 'hint', text: `Next payment ${money(conv(status.monthlyPayment))}: about ${money(conv(upcoming.interest))} interest, ${money(conv(upcoming.fee))} fees and ${money(conv(upcoming.principal))} off the loan. ${loan.ratePercent}% fixed over ${loan.years} years. Each month a little more goes to the loan and less to interest.` }),
    el('p', { class: 'hint', text: `Paid off since the start: ${money(conv(status.principalPaid))} of ${money(conv(loan.principal))}.` }));
}

function tile(label, value, note) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label', text: label }),
    el('div', { class: 'tile-value', text: value }),
    note ? el('div', { class: 'tile-note', text: note }) : null);
}

function row(label, value) {
  return el('tr', {}, el('td', { text: label }), el('td', { class: 'num', text: value }));
}
