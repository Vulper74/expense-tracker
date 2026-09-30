// Transactions screen: search, filter, re-categorize, split, link paybacks, add cash, delete.

import { applyRule, categoryType, groupCategories, needsReview, shortName, suggestKeyword, UNCATEGORIZED } from './categorize.js';
import { moneyFormatter, reconvert } from './currency.js';
import { CASH_ACCOUNT, PAYBACK_DAYS, paybackCandidates, repaidAmounts, splitRest } from './ledger.js';
import { partsOf } from './stats.js';
import { el, fill, formatDate, formatMoney, formatMonth, uid } from './util.js';

const PAGE = 200;
const REVIEW = '__review';
const filters = { search: '', month: '', category: '', account: '', hideInternal: true };
let limit = PAGE;
let ruleOffer = null; // { keyword, category, amount, currency, sign, message }
let adding = false;
let editing = null; // id of the transaction open in the details editor

// After an import: show only the transactions that need a category.
export function showForReview() {
  Object.assign(filters, { search: '', month: '', category: REVIEW, account: '' });
  limit = PAGE;
}

// <option>s for a category drop-down, sub-categories grouped under their parent.
export function categoryOptions(categories) {
  return groupCategories(categories).map((g) => {
    const options = g.categories.map((c) => el('option', { value: c.name, text: g.label ? shortName(c) : c.name }));
    return g.label ? el('optgroup', { label: g.label }, options) : options;
  });
}

export function renderTransactions(root, store, { goTo }) {
  const { state } = store;
  const fmt = moneyFormatter(state);
  const months = [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const accounts = [...new Set(state.transactions.map((t) => t.account).filter(Boolean))].sort();
  const tableArea = el('div');
  const offerArea = el('div');
  const addArea = el('div');
  let parts = partsOf(state);
  let repaid = repaidAmounts(parts);

  const refresh = () => {
    parts = partsOf(state);
    repaid = repaidAmounts(parts);
    fill(offerArea, ruleOffer ? ruleOfferBanner() : '');
    fill(addArea, adding ? addForm() : '');
    fill(tableArea, state.transactions.length ? table() : emptyState());
  };
  const setFilter = (key, value) => {
    filters[key] = value;
    limit = PAGE;
    refresh();
  };

  fill(root, 
    el('div', { class: 'title-row' },
      el('h2', { text: 'Transactions' }),
      el('button', { class: 'primary small', text: '+ Add cash', onclick: () => { adding = true; refresh(); } })),
    addArea,
    state.transactions.length
      ? el('div', { class: 'filters' },
        el('input', {
          type: 'search',
          placeholder: 'Search descriptions',
          value: filters.search,
          'aria-label': 'Search descriptions',
          oninput: (e) => setFilter('search', e.target.value),
        }),
        el('select', { 'aria-label': 'Month', value: filters.month, onchange: (e) => setFilter('month', e.target.value) },
          el('option', { value: '', text: 'All months' }),
          months.map((m) => el('option', { value: m, text: formatMonth(m) }))),
        el('select', { 'aria-label': 'Category', value: filters.category, onchange: (e) => setFilter('category', e.target.value) },
          el('option', { value: '', text: 'All categories' }),
          el('option', { value: REVIEW, text: 'Needs a category' }),
          categoryOptions(state.categories)),
        accounts.length > 1
          ? el('select', { 'aria-label': 'Account', value: filters.account, onchange: (e) => setFilter('account', e.target.value) },
            el('option', { value: '', text: 'All accounts' }),
            accounts.map((a) => el('option', { value: a, text: a })))
          : null,
        el('label', { class: 'check inline' },
          el('input', { type: 'checkbox', checked: filters.hideInternal, onchange: (e) => setFilter('hideInternal', e.target.checked) }),
          'Hide moves between my accounts'))
      : null,
    offerArea,
    tableArea,
  );
  refresh();

  function emptyState() {
    return el('div', { class: 'card empty' },
      el('p', { text: 'No transactions yet.' }),
      el('button', { class: 'primary', text: 'Import a statement', onclick: () => goTo('import') }));
  }

  function inCategory(t, category) {
    if (category === REVIEW) return needsReview(t);
    return t.category === category || (t.splits ?? []).some((p) => p.category === category);
  }

  function visible() {
    const q = filters.search.trim().toUpperCase();
    return state.transactions
      .filter((t) => (!filters.month || t.date.startsWith(filters.month))
        && (!filters.category || inCategory(t, filters.category))
        && (!filters.account || t.account === filters.account)
        && (!filters.hideInternal || filters.category || t.splits?.length || categoryType(t.category, state.categories) !== 'transfer')
        && (!q || t.description.toUpperCase().includes(q) || (t.note ?? '').toUpperCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function table() {
    const list = visible();
    const shown = new Set(list);
    let spent = 0;
    let earned = 0;
    // With a category picked, only the parts in it count (e.g. the poker part of a withdrawal).
    const only = filters.category && filters.category !== REVIEW ? filters.category : null;
    for (const p of parts) {
      if (!shown.has(p.t) || (only && p.category !== only)) continue;
      if (p.type === 'income') earned += p.amount;
      else if (p.type === 'expense') spent -= p.amount;
    }

    return el('div', {},
      el('p', { class: 'muted' },
        `Showing ${Math.min(limit, list.length)} of ${list.length} · Spent ${fmt.money(spent)} · Income ${fmt.money(earned)}`),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'transactions' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Date' }), el('th', { text: 'Description' }), el('th', { text: 'Category' }),
            el('th', { class: 'num', text: 'Amount' }), el('th', { 'aria-label': 'Actions' }))),
          el('tbody', {}, list.slice(0, limit).map((t) => (editing === t.id
            ? [row(t), el('tr', { class: 'editor-row' }, el('td', { colspan: '5' }, editor(t)))]
            : row(t)))))),
      list.length > limit
        ? el('button', { text: `Show ${Math.min(PAGE, list.length - limit)} more`, onclick: () => { limit += PAGE; refresh(); } })
        : null,
    );
  }

  function row(t) {
    // The bank's own amount underneath, unless that's already what's shown.
    const original = t.currency && t.currency !== state.settings.currency && ![t.currency, 'original'].includes(state.settings.display)
      ? formatMoney(t.originalAmount, t.currency)
      : null;
    const own = (v) => formatMoney(v, t.currency ?? state.settings.currency);
    const byId = (id) => state.transactions.find((x) => x.id === id);
    const notes = [
      t.account,
      t.note,
      t.oneOff ? 'One-off' : null,
      t.splits?.length ? `Split: ${[...t.splits.map((p) => `${own(Math.abs(p.amount))} ${p.category}${p.oneOff ? ' (one-off)' : ''}`), `${own(Math.abs(splitRest(t)))} ${t.category}`].join(' · ')}` : null,
      t.repays?.length ? `Pays back ${t.repays.map(byId).filter(Boolean).map((e) => e.description).join(', ')}` : null,
      repaid.get(t.id) ? `${fmt.money(repaid.get(t.id))} paid back` : null,
    ].filter(Boolean);
    return el('tr', { class: editing === t.id ? 'editing' : null },
      el('td', { class: 'date nowrap', text: formatDate(t.date) }),
      el('td', { class: 'description' },
        el('span', { text: t.description }),
        notes.length ? el('span', { class: 'sub', text: notes.join(' · ') }) : null),
      el('td', { class: 'category' },
        el('select', {
          'aria-label': t.splits?.length ? 'Category of the rest' : 'Category',
          value: t.category,
          onchange: (e) => {
            const category = e.target.value;
            store.commit(() => {
              t.category = category;
              t.manual = true;
            });
            ruleOffer = {
              keyword: suggestKeyword(t.description),
              category,
              amount: Math.abs(t.originalAmount ?? t.amount),
              currency: t.currency ?? state.settings.currency,
              sign: t.amount < 0 ? 'out' : 'in',
            };
            refresh();
          },
        }, categoryOptions(state.categories))),
      el('td', { class: `num amount ${t.amount > 0 ? 'positive' : ''}` },
        el('span', { text: fmt.forTransaction(t) }),
        t.unconverted ? el('span', { class: 'sub', text: 'No rate yet' }) : original ? el('span', { class: 'sub', text: original }) : null),
      el('td', { class: 'actions-cell' },
        el('button', {
          class: 'icon',
          title: 'Split, one-off, payback, note',
          'aria-label': `Details of ${t.description}`,
          'aria-expanded': String(editing === t.id),
          text: '✎',
          onclick: () => { editing = editing === t.id ? null : t.id; refresh(); },
        }),
        el('button', {
          class: 'icon',
          title: 'Delete transaction',
          'aria-label': `Delete ${t.description}`,
          text: '×',
          onclick: () => {
            if (!confirm(`Delete "${t.description}" (${fmt.forTransaction(t)})?`)) return;
            store.commit((s) => {
              s.transactions = s.transactions.filter((x) => x.id !== t.id);
              for (const x of s.transactions) if (x.repays) x.repays = x.repays.filter((id) => id !== t.id);
            });
            refresh();
          },
        })),
    );
  }

  // Split, one-off, payback and note for one transaction, shown under its row.
  function editor(t) {
    const currency = t.currency ?? state.settings.currency;
    const total = t.originalAmount ?? t.amount;
    const sign = total < 0 ? -1 : 1;
    const draft = {
      note: t.note ?? '',
      oneOff: Boolean(t.oneOff),
      category: t.category,
      splits: (t.splits ?? []).map((p) => ({ ...p, amount: Math.abs(p.amount) })),
      repays: new Set(t.repays ?? []),
      search: '',
    };
    const box = el('div', { class: 'editor' });
    const own = (v) => formatMoney(v, currency);
    const candidates = paybackCandidates(t, state.transactions, state.categories);

    const draw = () => {
      const q = draft.search.trim().toUpperCase();
      const listed = candidates.filter((e) => draft.repays.has(e.id) || !q || e.description.toUpperCase().includes(q)).slice(0, 12);
      fill(box, 
        el('div', { class: 'grid-2' },
          el('label', { class: 'field' }, 'Note',
            el('input', { type: 'text', value: draft.note, placeholder: 'Optional', oninput: (e) => { draft.note = e.target.value; } })),
          el('label', { class: 'check' },
            el('input', { type: 'checkbox', checked: draft.oneOff, onchange: (e) => { draft.oneOff = e.target.checked; } }),
            'One-off: still in totals, but left out of averages, budgets and warnings (a bonus, a big purchase).')),

        el('h4', { text: 'Split' }),
        el('p', { class: 'hint', text: `Divide ${own(Math.abs(total))} between categories. Whatever isn’t split off stays in the rest.` }),
        el('div', { class: 'split-rows' },
          draft.splits.map((p, i) => el('div', { class: 'split-row' },
            el('input', {
              type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: p.amount === '' ? '' : String(p.amount), 'aria-label': 'Amount',
              oninput: (e) => { p.amount = e.target.value === '' ? '' : Number(e.target.value); restLine.textContent = restText(); },
            }),
            el('select', { value: p.category, 'aria-label': 'Category', onchange: (e) => { p.category = e.target.value; } }, categoryOptions(state.categories)),
            el('label', { class: 'check inline' },
              el('input', { type: 'checkbox', checked: Boolean(p.oneOff), onchange: (e) => { p.oneOff = e.target.checked; } }), 'One-off'),
            el('button', { type: 'button', class: 'icon', 'aria-label': 'Remove part', title: 'Remove part', text: '×', onclick: () => { draft.splits.splice(i, 1); draw(); } }))),
          el('div', { class: 'split-row rest' },
            el('span', { class: 'rest-amount' }),
            el('select', { value: draft.category, 'aria-label': 'Category of the rest', onchange: (e) => { draft.category = e.target.value; } }, categoryOptions(state.categories)),
            el('span', { class: 'muted', text: 'the rest' }))),
        el('button', {
          type: 'button',
          class: 'small',
          text: '+ Add a part',
          onclick: () => { draft.splits.push({ amount: '', category: UNCATEGORIZED }); draw(); },
        }),

        t.amount > 0
          ? el('div', {},
            el('h4', { text: 'Pays back' }),
            el('p', { class: 'hint', text: `Money someone paid you back. It cancels that spending (in the month it was spent) instead of counting as income. Showing your spending from the ${Math.round(PAYBACK_DAYS / 31)} months before, closest amount first.` }),
            candidates.length
              ? el('div', {},
                el('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search spending', value: draft.search, oninput: (e) => { draft.search = e.target.value; draw(); box.querySelector('input[type=search]')?.focus(); } }),
                el('ul', { class: 'plain candidates' }, listed.map((e) => el('li', {},
                  el('label', { class: 'check' },
                    el('input', { type: 'checkbox', checked: draft.repays.has(e.id), onchange: (ev) => { if (ev.target.checked) draft.repays.add(e.id); else draft.repays.delete(e.id); } }),
                    `${formatDate(e.date)} · ${e.description} · ${fmt.forTransaction(e)} · ${e.category}`)))))
              : el('p', { class: 'muted', text: 'No spending in the two months before this.' }))
          : null,

        el('div', { class: 'actions' },
          el('button', {
            type: 'button',
            class: 'primary small',
            text: 'Save',
            onclick: () => {
              const splits = draft.splits.filter((p) => Number(p.amount) > 0);
              const sum = splits.reduce((s, p) => s + Number(p.amount), 0);
              if (sum - Math.abs(total) > 0.005) return alert(`The parts add up to ${own(sum)}, more than ${own(Math.abs(total))}.`);
              store.commit(() => {
                if (draft.category !== t.category || splits.length) t.manual = true;
                t.category = draft.category;
                if (draft.note.trim()) t.note = draft.note.trim(); else delete t.note;
                if (draft.oneOff) t.oneOff = true; else delete t.oneOff;
                if (splits.length) {
                  t.splits = splits.map((p) => {
                    const part = { amount: Math.round(sign * Number(p.amount) * 100) / 100, category: p.category };
                    if (p.oneOff) part.oneOff = true;
                    if (p.note) part.note = p.note;
                    return part;
                  });
                } else delete t.splits;
                if (draft.repays.size) t.repays = [...draft.repays]; else delete t.repays;
              });
              editing = null;
              refresh();
            },
          }),
          el('button', { type: 'button', class: 'small', text: 'Cancel', onclick: () => { editing = null; refresh(); } })),
      );
      const restLine = box.querySelector('.rest-amount');
      const restText = () => {
        const left = Math.round((Math.abs(total) - draft.splits.reduce((s, p) => s + (Number(p.amount) || 0), 0)) * 100) / 100;
        return left < 0 ? `${own(left)} (too much)` : own(left);
      };
      restLine.textContent = restText();
    };
    draw();
    return box;
  }

  // Cash, or anything the bank files don't show.
  function addForm() {
    const today = new Date().toISOString().slice(0, 10);
    const currencies = [...new Set([state.settings.currency, ...Object.keys(state.settings.fallbackRates ?? {}), ...state.exchanges.map((x) => x.currency)])];
    const date = el('input', { type: 'date', value: today, required: true, max: today });
    const description = el('input', { type: 'text', required: true, placeholder: 'e.g. Market, haircut' });
    const amount = el('input', { type: 'number', required: true, min: '0.01', step: '0.01', inputmode: 'decimal', placeholder: '0.00' });
    const direction = el('select', {}, el('option', { value: 'out', text: 'Money out' }), el('option', { value: 'in', text: 'Money in' }));
    const currency = el('select', {}, currencies.map((c) => el('option', { value: c, text: c })));
    const category = el('select', { value: UNCATEGORIZED }, categoryOptions(state.categories));
    const account = el('input', { type: 'text', value: CASH_ACCOUNT, list: 'account-names' });

    return el('form', {
      class: 'card add-form',
      onsubmit: (e) => {
        e.preventDefault();
        const value = Math.round(Number(amount.value) * 100) / 100 * (direction.value === 'out' ? -1 : 1);
        if (!value || !description.value.trim()) return;
        store.commit((s) => {
          const t = {
            id: uid(),
            date: date.value,
            description: description.value.trim(),
            amount: value,
            category: category.value,
            key: `manual|${uid()}`,
            manual: true,
            account: account.value.trim() || CASH_ACCOUNT,
          };
          if (currency.value !== s.settings.currency) Object.assign(t, { currency: currency.value, originalAmount: value });
          s.transactions.push(t);
          reconvert(s);
        });
        adding = false;
        ruleOffer = { message: `Added “${description.value.trim()}”.` };
        refresh();
      },
    },
    el('h3', { text: 'Add a transaction' }),
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' }, 'Date', date),
      el('label', { class: 'field' }, 'Description', description),
      el('div', { class: 'field' }, el('span', { text: 'Amount' }),
        el('div', { class: 'input-group' }, direction, amount, currency)),
      el('label', { class: 'field' }, 'Category', category),
      el('label', { class: 'field' }, 'Account', account,
        el('datalist', { id: 'account-names' }, accounts.map((a) => el('option', { value: a }))))),
    el('div', { class: 'actions' },
      el('button', { type: 'submit', class: 'primary', text: 'Add' }),
      el('button', { type: 'button', text: 'Cancel', onclick: () => { adding = false; refresh(); } })));
  }

  function ruleOfferBanner() {
    if (ruleOffer.message) {
      return el('div', { class: 'notice success' }, ruleOffer.message, ' ',
        el('button', { class: 'link', text: 'Dismiss', onclick: () => { ruleOffer = null; refresh(); } }));
    }
    const keywordInput = el('input', { type: 'text', value: ruleOffer.keyword, 'aria-label': 'Keyword', class: 'inline' });
    const onlyAmount = el('input', { type: 'checkbox' });
    const onlyDirection = el('input', { type: 'checkbox' });
    return el('div', { class: 'notice' },
      el('p', {}, 'Always put transactions containing ', keywordInput, ' in ', el('strong', { text: ruleOffer.category }), '?'),
      el('label', { class: 'check' }, onlyAmount, `Only when the amount is ${formatMoney(ruleOffer.amount, ruleOffer.currency)}`),
      el('label', { class: 'check' }, onlyDirection, `Only for money ${ruleOffer.sign === 'out' ? 'going out' : 'coming in'}`),
      el('div', { class: 'actions' },
        el('button', {
          class: 'primary small',
          text: 'Yes, make a rule',
          onclick: () => {
            const rule = { match: keywordInput.value.trim().toUpperCase(), category: ruleOffer.category };
            if (!rule.match) return;
            if (onlyAmount.checked) rule.amount = ruleOffer.amount;
            if (onlyDirection.checked) rule.sign = ruleOffer.sign;
            let changed = 0;
            store.commit((s) => {
              s.rules = s.rules.filter((r) => !(r.match.toUpperCase() === rule.match && r.amount === rule.amount && r.sign === rule.sign));
              s.rules.push(rule);
              changed = applyRule(s.transactions, rule, s.rules);
            });
            ruleOffer = { message: `Rule saved: “${rule.match}” → ${rule.category}. Updated ${changed} other transaction${changed === 1 ? '' : 's'}; new imports will follow it too.` };
            refresh();
          },
        }),
        el('button', { class: 'small', text: 'No thanks', onclick: () => { ruleOffer = null; refresh(); } })));
  }
}
