// Accounts: what you have and owe, and your net worth.
// Bank balances come from statements (or an opening balance plus later
// transactions); cash, investments and the flat's value are typed here.

import { accountList, goalProgress, netWorth, today } from './accounts.js';
import { moneyFormatter } from './currency.js';
import { el, fill, formatDate, formatMoney } from './util.js';

const SOURCES = {
  statement: 'from your latest statement',
  setup: 'opening balance plus transactions since',
  estimate: 'estimated',
  counted: 'counted, plus withdrawals and cash spending since',
  typed: 'typed by you',
  missing: 'no value yet',
};
const GROUPS = [
  ['Bank accounts and cash', ['bank', 'cash']],
  ['Investments', ['investment']],
  ['Property and loans', ['property', 'loan']],
];

let message = null;

export function renderAccounts(root, store) {
  const { state } = store;
  const fmt = moneyFormatter(state);
  const list = accountList(state);
  const totals = netWorth(list);
  const rerender = (msg) => {
    message = msg ?? null;
    renderAccounts(root, store);
  };
  const save = (name, type, changes, msg) => {
    store.commit((s) => {
      s.accounts ??= [];
      let a = s.accounts.find((x) => x.name === name && x.type === type);
      if (!a) s.accounts.push((a = { name, type }));
      Object.assign(a, changes);
    });
    rerender(msg);
  };

  fill(root, 
    el('h2', { text: 'Accounts' }),
    message ? el('div', { class: 'notice success', text: message }) : null,
    list.length
      ? el('div', { class: 'tiles' },
        tile('Net worth', fmt.money(totals.netWorth), 'Everything below, minus loans'),
        tile('Savings and investments', fmt.money(totals.liquid), 'Bank, cash and investments. Used as your FIRE savings.'),
        totals.property ? tile('Property', fmt.money(totals.property), '') : null,
        totals.loans ? tile('Loans', fmt.money(totals.loans), '') : null)
      : el('div', { class: 'card empty' }, el('p', { text: 'Import a statement, or load your setup file in Settings, to see your accounts here.' })),
    totals.missing.length ? el('p', { class: 'warning', text: `No exchange rate for ${totals.missing.join(', ')}, so they’re left out of the totals.` }) : null,

    GROUPS.map(([title, types]) => {
      const rows = list.filter((a) => types.includes(a.type));
      if (!rows.length) return null;
      return el('section', { class: 'card' },
        el('h3', { text: title }),
        el('div', { class: 'account-list' }, rows.map((a) => accountRow(a))));
    }),

    goalsCard(),
    addCard(),
  );
  message = null;

  // Savings goals, e.g. an emergency fund, shown on the dashboard.
  function goalsCard() {
    const choosable = list.filter((a) => ['bank', 'cash', 'investment'].includes(a.type) && !a.hidden);
    const saveGoals = (mutator, msg) => {
      store.commit((s) => { s.goals ??= []; mutator(s.goals); });
      rerender(msg);
    };
    const editors = state.goals.map((g, i) => {
      const p = goalProgress(g, list);
      const target = numberInput(g.target, `${g.name} amount`);
      const boxes = choosable.map((a) => el('input', { type: 'checkbox', value: a.name, checked: p.accounts.includes(a.name) }));
      return el('form', {
        class: 'goal-editor',
        onsubmit: (e) => {
          e.preventDefault();
          const chosen = boxes.filter((b) => b.checked).map((b) => b.value);
          const defaults = choosable.filter((a) => ['bank', 'cash'].includes(a.type)).map((a) => a.name);
          const same = chosen.length === defaults.length && chosen.every((n) => defaults.includes(n));
          saveGoals((goals) => Object.assign(goals[i], { target: Number(target.value) || 0, accounts: same ? null : chosen }), `${g.name} updated.`);
        },
      },
      el('strong', { text: g.name }),
      el('span', { class: 'sub', text: `${fmt.money(p.saved)} of ${fmt.money(p.target)} so far` }),
      el('label', { class: 'inline-field' }, `Amount (${state.settings.currency}) `, target),
      choosable.length
        ? el('div', {}, el('span', { class: 'hint', text: 'Counted from:' }),
          el('div', { class: 'check-list' }, choosable.map((a, j) => el('label', {}, boxes[j], a.name))))
        : null,
      el('div', { class: 'actions' },
        el('button', { type: 'submit', class: 'small primary', text: 'Save' }),
        el('button', { type: 'button', class: 'small', text: 'Remove', onclick: () => saveGoals((goals) => goals.splice(i, 1), `${g.name} removed.`) })));
    });

    const name = el('input', { type: 'text', required: true, placeholder: 'Emergency fund', 'aria-label': 'Goal name' });
    const amount = numberInput(null, 'Goal amount');
    amount.placeholder = `Amount (${state.settings.currency})`;
    return el('section', { class: 'card' },
      el('h3', { text: 'Goals' }),
      el('p', { class: 'hint', text: 'Money you want set aside, like an emergency fund. It counts your bank accounts and cash unless you choose otherwise, and shows on the dashboard.' }),
      editors,
      el('form', {
        class: 'inline-form',
        onsubmit: (e) => {
          e.preventDefault();
          const n = name.value.trim();
          if (!n || amount.value === '') return;
          if (state.goals.some((g) => g.name === n)) return rerender(`There’s already a goal called ${n}.`);
          saveGoals((goals) => goals.push({ name: n, target: Number(amount.value) }), `Added ${n}.`);
        },
      }, name, amount, el('button', { type: 'submit', class: 'small', text: 'Add a goal' })));
  }

  function accountRow(a) {
    const own = formatMoney(a.balance, a.currency);
    const converted = a.currency !== fmt.currency && a.value != null ? fmt.money(a.value) : null;
    return el('div', { class: `account${a.hidden ? ' hidden-account' : ''}` },
      el('div', { class: 'account-head' },
        el('div', {},
          el('strong', { text: a.name }),
          el('span', { class: 'sub', text: [SOURCES[a.source], a.asOf ? formatDate(a.asOf) : null, a.hidden ? 'hidden from totals' : null].filter(Boolean).join(' · ') })),
        el('div', { class: 'num' },
          el('span', { class: `account-balance ${a.balance < 0 ? '' : 'positive'}`, text: own }),
          converted ? el('span', { class: 'sub', text: converted }) : null)),
      editor(a));
  }

  function numberInput(value, label) {
    return el('input', { type: 'number', step: 'any', inputmode: 'decimal', value: value == null ? '' : String(value), 'aria-label': label });
  }

  function editor(a) {
    if (a.type === 'cash') {
      const counted = numberInput(null, 'Cash in hand');
      return el('details', {}, el('summary', { text: 'Count my cash' }),
        el('form', {
          class: 'inline-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (counted.value === '') return;
            save(a.name, 'cash', { balance: Number(counted.value), asOf: today() }, 'Cash in hand updated.');
          },
        }, el('span', { class: 'hint', text: `How much cash you have now, in ${a.currency}. Withdrawals (the Cash category) add to it and spending on the Cash account takes from it.` }),
        counted, el('button', { type: 'submit', class: 'small', text: 'Save' })));
    }
    if (a.type === 'investment') {
      const d = a.details;
      const value = numberInput(a.account?.value, 'Current value');
      const initial = numberInput(a.account?.initial, 'Value at the start');
      const start = el('input', { type: 'date', value: a.account?.initialDate ?? '', 'aria-label': 'Start date' });
      return el('div', {},
        el('p', { class: 'hint' },
          `Deposits ${fmt.money(d.deposits)} · withdrawals ${fmt.money(d.withdrawals)}`,
          d.profit != null && a.account?.value != null ? ` · profit ${fmt.money(d.profit)} (value + withdrawals − deposits − value at the start)` : ''),
        el('form', {
          class: 'grid-2',
          onsubmit: (e) => {
            e.preventDefault();
            save(a.name, 'investment', {
              value: value.value === '' ? null : Number(value.value),
              asOf: today(),
              initial: initial.value === '' ? null : Number(initial.value),
              initialDate: start.value || null,
            }, `${a.name} updated.`);
          },
        },
        el('label', { class: 'field' }, `Current value (${a.currency})`, value),
        el('label', { class: 'field' }, `Value at the start (${a.currency})`, initial),
        el('label', { class: 'field' }, 'Start date', start, el('span', { class: 'hint', text: 'Deposits and withdrawals after this date count. Transactions whose description contains the account name are counted.' })),
        el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'small primary', text: 'Save' }))));
    }
    if (a.type === 'property') {
      const value = numberInput(a.account?.value, 'Value');
      return el('details', {}, el('summary', { text: 'Change the value' }),
        el('form', {
          class: 'inline-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (value.value === '') return;
            save(a.name, 'property', { value: Number(value.value), asOf: today() }, `${a.name} value updated.`);
          },
        }, value, el('span', { class: 'muted', text: a.currency }), el('button', { type: 'submit', class: 'small', text: 'Save' })));
    }
    if (a.type === 'loan') {
      const d = a.details;
      if (!d) return null;
      return el('p', { class: 'hint', text: `${d.paymentsMade} payments made, ${d.paymentsLeft} left. Monthly ${formatMoney(d.monthlyPayment, a.currency, { whole: true })}. Paid off so far ${formatMoney(d.principalPaid, a.currency, { whole: true })}.` });
    }
    if (a.type === 'bank') {
      return el('button', {
        class: 'link small-text',
        text: a.hidden ? 'Show in totals' : 'Hide (closed account)',
        onclick: () => save(a.name, 'bank', { hidden: !a.hidden }),
      });
    }
    return null;
  }

  function addCard() {
    const type = el('select', { 'aria-label': 'Account type' },
      el('option', { value: 'investment', text: 'Investment' }),
      el('option', { value: 'bank', text: 'Bank account (opening balance)' }),
      el('option', { value: 'property', text: 'Property' }));
    const name = el('input', { type: 'text', required: true, placeholder: 'Name', 'aria-label': 'Account name' });
    const currency = el('input', { type: 'text', value: state.settings.currency, maxlength: '3', 'aria-label': 'Currency', class: 'currency-input' });
    const amount = numberInput(null, 'Balance or value');
    amount.placeholder = 'Balance or value';
    return el('details', { class: 'card' }, el('summary', { text: 'Add an account' }),
      el('p', { class: 'hint', text: 'For accounts that aren’t in a statement. Loans go in your setup file. Account names must match the account shown on transactions (e.g. “OTP HUF”) for later transactions to be added.' }),
      el('form', {
        class: 'inline-form',
        onsubmit: (e) => {
          e.preventDefault();
          const n = name.value.trim();
          if (!n) return;
          const cur = currency.value.trim().toUpperCase() || state.settings.currency;
          const v = amount.value === '' ? null : Number(amount.value);
          const fields = type.value === 'bank' ? { currency: cur, balance: v ?? 0, asOf: today() }
            : type.value === 'property' ? { currency: cur, value: v ?? 0, asOf: today() }
              : { currency: cur, value: v, initial: v, initialDate: today(), asOf: today() };
          save(n, type.value, fields, `Added ${n}.`);
        },
      }, type, name, currency, amount, el('button', { type: 'submit', class: 'small', text: 'Add' })));
  }
}

function tile(label, value, note) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label', text: label }),
    el('div', { class: 'tile-value', text: value }),
    note ? el('div', { class: 'tile-note', text: note }) : null);
}
