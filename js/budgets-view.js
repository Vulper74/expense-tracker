// Budgets: a monthly amount per category, suggested from your last three months,
// with this month's spending, where it's heading and any warnings.

import { monthStatus, suggestBudgets, TREND } from './budgets.js';
import { categoryType } from './categorize.js';
import { CASH_CATEGORY } from './ledger.js';
import { moneyFormatter } from './currency.js';
import { el, fill, formatMoney, formatMonth } from './util.js';

export function renderBudgets(root, store, { parts, rerender }) {
  const { state } = store;
  const base = state.settings.currency;
  const { money } = moneyFormatter(state);
  const today = new Date();
  const status = monthStatus(parts, state.budgets, today);
  const suggestions = suggestBudgets(parts, today);
  const byCategory = new Map(status.rows.map((r) => [r.category, r]));

  // Every spending category with a budget, spending, or a suggestion.
  const names = state.categories
    .filter((c) => categoryType(c.name, state.categories) === 'expense')
    .map((c) => c.name)
    .filter((n) => byCategory.has(n) || suggestions[n] || state.budgets[n]);

  const setBudget = (name, value) => {
    store.commit((s) => {
      s.budgets ??= {};
      if (value > 0) s.budgets[name] = value;
      else delete s.budgets[name];
    });
    rerender();
  };

  const totals = names.reduce((t, n) => {
    const r = byCategory.get(n);
    t.budget += state.budgets[n] ?? 0;
    t.spent += r?.spent ?? 0;
    return t;
  }, { budget: 0, spent: 0 });
  const empty = names.filter((n) => !state.budgets[n] && suggestions[n]);

  fill(root, 
    el('section', { class: 'card' },
      el('h3', { text: `${formatMonth(status.month)} · day ${status.day} of ${status.daysInMonth}` }),
      el('p', { class: 'hint', text: `Budgets are monthly, in ${base}. Suggestions are your average of the last three months, rounded up. One-offs are left out. A warning shows when a category is over budget, heading over it, or heading at least ${Math.round((TREND.ratio - 1) * 100)}% and ${formatMoney(TREND.minimum, base, { whole: true })} above your usual. “Heading for” assumes the rest of the month goes like your usual.` }),
      status.monthsOfHistory ? null : el('p', { class: 'notice', text: 'There’s no full month before this one yet, so there are no suggestions or usual amounts. They appear after your first full month.' }),
      totals.budget ? el('p', {}, `Budgeted ${money(totals.budget)} · spent ${money(totals.spent)} so far`) : null,
      el('div', { class: 'actions' },
        empty.length
          ? el('button', {
            class: 'primary small',
            text: `Use suggestions for ${empty.length} categor${empty.length === 1 ? 'y' : 'ies'} without a budget`,
            onclick: () => {
              store.commit((s) => { for (const n of empty) s.budgets[n] = suggestions[n]; });
              rerender();
            },
          })
          : null,
        Object.keys(state.budgets ?? {}).length
          ? el('button', {
            class: 'small',
            text: 'Clear all budgets',
            onclick: () => {
              if (!confirm('Remove every budget?')) return;
              store.commit((s) => { s.budgets = {}; });
              rerender();
            },
          })
          : null),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'budgets' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Category' }),
            el('th', { class: 'num', text: `Budget (${base})` }),
            el('th', { class: 'num', text: 'Spent' }),
            el('th', { class: 'num wide-only', text: 'Heading for' }),
            el('th', { class: 'num wide-only', text: 'Usual' }))),
          el('tbody', {}, names.map((n) => {
            const r = byCategory.get(n) ?? { spent: 0, projected: 0, average: 0, warnings: [] };
            const budget = state.budgets[n];
            const share = budget ? Math.min(1, r.spent / budget) : null;
            return el('tr', { class: r.warnings.length ? 'warn' : null },
              el('td', { class: 'budget-category' }, n,
                n === CASH_CATEGORY ? el('span', { class: 'sub', text: 'Withdrawals, minus cash you logged in other categories' }) : null,
                share != null ? el('div', { class: `meter${r.spent > budget ? ' over' : ''}`, role: 'img', 'aria-label': `${Math.round((r.spent / budget) * 100)}% of budget` },
                  el('span', { style: `width:${Math.round(share * 100)}%` })) : null,
                r.warnings.length ? el('span', { class: 'warning-text', text: r.warnings.map((w) => w.text).join(', ') }) : null),
              el('td', { class: 'num' },
                el('input', {
                  type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'budget-input',
                  'aria-label': `Budget for ${n}`,
                  value: budget ? String(budget) : '',
                  placeholder: suggestions[n] ? String(suggestions[n]) : '',
                  onchange: (e) => setBudget(n, Number(e.target.value)),
                })),
              el('td', { class: 'num', text: money(r.spent) }),
              el('td', { class: 'num wide-only', text: money(r.projected) }),
              el('td', { class: 'num wide-only', text: r.average ? money(r.average) : '–' }));
          })))),
      status.rows.some((r) => r.warnings.length)
        ? el('details', {}, el('summary', { text: 'Warning details' }),
          el('ul', {}, status.rows.filter((r) => r.warnings.length).map((r) => el('li', { text: `${r.category}: ${warningDetail(r, money)}` }))))
        : null),
  );
}

export function warningDetail(r, money) {
  const bits = [`${money(r.spent)} so far`];
  if (Math.abs(r.projected - r.spent) > 0.5) bits.push(`heading for ${money(r.projected)}`);
  if (r.budget) bits.push(`budget ${money(r.budget)}`);
  if (r.average) bits.push(`usually ${money(r.average)}`);
  return bits.join(', ');
}
