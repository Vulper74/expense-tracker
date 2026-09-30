// Settings: currency, categories, rules, saved bank settings, backups.

import { applyAllRules, applyRule, groupCategories, REQUIRED_CATEGORIES, shortName, UNCATEGORIZED } from './categorize.js';
import { displayChoices, rateContext, rateFor, reconvert } from './currency.js';
import { applySetup, exportSetup, parseSetup } from './setup.js';
import { exportBackup, parseBackup, defaultState } from './storage.js';
import { categoryOptions } from './transactions-view.js';
import { downloadFile, el, formatMoney, mount, readFileAsText } from './util.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RSD', 'JPY', 'INR', 'SGD', 'ZAR', 'BRL', 'MXN'];
const TYPE_LABELS = { expense: 'Spending', income: 'Income', transfer: 'Transfer (ignored)' };
const PROTECTED = REQUIRED_CATEGORIES;
const SIGN_LABELS = { '': 'In or out', out: 'Money out', in: 'Money in' };

let message = null;

export function renderSettings(root, store) {
  const { state } = store;
  const rerender = (msg) => {
    message = msg ?? null;
    renderSettings(root, store);
  };
  const usage = (name) => state.transactions.filter((t) => t.category === name).length;

  mount(root,
    el('h2', { text: 'Settings' }),
    message ? el('div', { class: 'notice success', text: message }) : null,

    currencyCard(),
    setupCard(),

    el('section', { class: 'card' },
      el('h3', { text: 'Categories' }),
      el('p', { class: 'hint', text: 'Transfers (moving money between your own accounts, paying off a credit card) are left out of spending and income.' }),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Counts as' }), el('th', { class: 'num', text: 'Transactions' }), el('th', { 'aria-label': 'Actions' }))),
        el('tbody', {}, groupCategories(state.categories).flatMap((g) => g.categories.map((c) => el('tr', {},
          el('td', { class: c.parent ? 'indent' : null, text: g.label && c.parent ? shortName(c) : c.name }),
          el('td', {},
            el('select', {
              'aria-label': `Type of ${c.name}`,
              value: c.type,
              disabled: PROTECTED.includes(c.name),
              onchange: (e) => { store.commit(() => { c.type = e.target.value; }); rerender(); },
            }, Object.entries(TYPE_LABELS).map(([v, t]) => el('option', { value: v, text: t })))),
          el('td', { class: 'num', text: String(usage(c.name)) }),
          el('td', {},
            PROTECTED.includes(c.name) ? null : el('button', {
              class: 'icon',
              'aria-label': `Delete category ${c.name}`,
              title: 'Delete category',
              text: '×',
              onclick: () => {
                const n = usage(c.name);
                if (!confirm(`Delete the "${c.name}" category?${n ? ` Its ${n} transactions move to ${UNCATEGORIZED}.` : ''}`)) return;
                store.commit((s) => {
                  s.categories = s.categories.filter((x) => x.name !== c.name);
                  s.rules = s.rules.filter((r) => r.category !== c.name);
                  for (const t of s.transactions) if (t.category === c.name) t.category = UNCATEGORIZED;
                });
                rerender(`Deleted “${c.name}”.`);
              },
            })))))))),
      addCategoryForm()),

    el('section', { class: 'card' },
      el('h3', { text: 'Rules' }),
      el('p', { class: 'hint', text: 'A rule puts any transaction whose description contains the keyword into a category. A rule can also need an exact amount (in the transaction’s own currency) or a direction. The most specific rule wins: amount, then direction, then the longest keyword, so “UBER EATS” beats “UBER”.' }),
      addRuleForm(),
      el('div', { class: 'table-wrap scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Keyword' }), el('th', { text: 'Only when' }), el('th', { text: 'Category' }), el('th', { 'aria-label': 'Actions' }))),
        el('tbody', {}, [...state.rules].sort((a, b) => a.match.localeCompare(b.match)).map((r) => el('tr', {},
          el('td', { text: r.match }),
          el('td', { class: 'muted', text: [r.sign ? SIGN_LABELS[r.sign] : '', r.amount != null ? `amount ${r.amount}` : ''].filter(Boolean).join(', ') || '–' }),
          el('td', { text: r.category }),
          el('td', {}, el('button', {
            class: 'icon',
            'aria-label': `Delete rule ${r.match}`,
            title: 'Delete rule',
            text: '×',
            onclick: () => { store.commit((s) => { s.rules = s.rules.filter((x) => x !== r); }); rerender(); },
          }))))))),
      el('div', { class: 'actions' },
        el('button', {
          text: 'Re-apply all rules to my transactions',
          onclick: () => {
            let changed = 0;
            store.commit((s) => { changed = applyAllRules(s.transactions, s.rules); });
            rerender(`Rules re-applied. ${changed} change${changed === 1 ? '' : 's'} made (categories you set by hand, and exchanges and fees from the bank file, were left alone).`);
          },
        }))),

    state.profiles.length
      ? el('section', { class: 'card' },
        el('h3', { text: 'Saved bank settings' }),
        el('ul', { class: 'plain' }, state.profiles.map((p) => el('li', {}, p.name, ' ',
          el('button', {
            class: 'icon',
            'aria-label': `Delete saved settings ${p.name}`,
            title: 'Delete',
            text: '×',
            onclick: () => { store.commit((s) => { s.profiles = s.profiles.filter((x) => x !== p); }); rerender(); },
          })))))
      : null,

    el('section', { class: 'card' },
      el('h3', { text: 'Backup' }),
      el('p', { class: 'hint', text: 'Your data lives in this browser. Download a backup now and then, and keep it somewhere safe. Clearing browser data deletes it.' }),
      el('div', { class: 'actions' },
        el('button', {
          class: 'primary',
          text: 'Download backup',
          onclick: () => downloadFile(`expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(state)),
        }),
        el('label', { class: 'button' }, 'Restore from backup…',
          el('input', {
            type: 'file',
            accept: '.json,application/json',
            class: 'visually-hidden',
            onchange: async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              try {
                const next = parseBackup(await readFileAsText(file));
                if (!confirm(`Replace everything with this backup (${next.transactions.length} transactions)?`)) return;
                store.replace(next);
                rerender('Backup restored.');
              } catch (err) {
                alert(err.message);
              }
            },
          })),
        el('button', {
          class: 'danger',
          text: 'Delete all data',
          onclick: () => {
            if (!confirm('Delete all transactions, rules and settings from this browser? Download a backup first if you might want them back.')) return;
            store.replace(defaultState());
            rerender('All data deleted.');
          },
        }))),
  );
  message = null;

  function currencyCard() {
    const base = state.settings.currency;
    const others = displayChoices(state).filter((c) => c !== base && c !== 'original');
    const today = new Date().toISOString().slice(0, 10);
    const context = rateContext(state);
    const fromExchanges = (c) => rateFor(c, today, { ...context, fallbackRates: {} });
    return el('section', { class: 'card' },
      el('h3', { text: 'Currency' }),
      el('div', { class: 'grid-2' },
        el('label', { class: 'field' }, 'Main currency',
          el('select', {
            value: base,
            onchange: (e) => {
              if (state.transactions.length && !confirm('Change the main currency? Foreign amounts are recalculated, but ones already in your old main currency keep their numbers.')) return rerender();
              store.commit((s) => { s.settings.currency = e.target.value; reconvert(s); });
              rerender('Main currency updated.');
            },
          }, [...new Set([base, ...CURRENCIES])].map((c) => el('option', { value: c, text: c }))),
          el('span', { class: 'hint', text: 'All totals, budgets and FIRE numbers use this.' }))),
      el('h4', { text: 'Exchange rates' }),
      el('p', { class: 'hint', text: `Foreign transactions are converted with the rate from your own currency exchange nearest that day. When none is within about six weeks, this rate is used (units per 1 ${base}).` }),
      others.length ? null : el('p', { class: 'muted', text: 'No other currencies yet.' }),
      el('div', { class: 'grid-2' }, others.map((c) => {
        const seen = fromExchanges(c);
        return el('label', { class: 'field' }, `${c} per 1 ${base}`,
          el('input', {
            type: 'number', min: '0', step: 'any', inputmode: 'decimal',
            value: state.settings.fallbackRates?.[c] ?? '',
            onchange: (e) => {
              const missing = [];
              store.commit((s) => {
                s.settings.fallbackRates ??= {};
                if (e.target.value === '') delete s.settings.fallbackRates[c];
                else s.settings.fallbackRates[c] = Number(e.target.value);
                missing.push(...reconvert(s));
              });
              rerender(missing.length ? `Rate saved. Still no rate for ${missing.join(', ')}.` : 'Rate saved and amounts recalculated.');
            },
          }),
          el('span', { class: 'hint', text: seen ? `Your latest exchange: ${formatMoney(seen, c)} per 1 ${base}` : 'No exchanges in this currency yet.' }));
      })));
  }

  function setupCard() {
    return el('section', { class: 'card' },
      el('h3', { text: 'Personal setup' }),
      el('p', { class: 'hint', text: 'Your own categories, rules, rates and accounts, kept in a file separate from the app. Load it once on a new device. Download it again after adding rules so your copy stays current. It never includes transactions.' }),
      el('div', { class: 'actions' },
        el('label', { class: 'button' }, 'Load setup file…',
          el('input', {
            type: 'file',
            accept: '.json,application/json',
            class: 'visually-hidden',
            onchange: async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              try {
                const setup = parseSetup(await readFileAsText(file));
                let counts;
                store.commit((s) => { counts = applySetup(s, setup); });
                rerender(`Setup loaded: ${counts.categories} new categories, ${counts.rules} rules, ${counts.accounts} accounts. ${counts.recategorised} transactions re-categorised.`);
              } catch (err) {
                alert(err.message);
              }
            },
          })),
        el('button', {
          text: 'Download my setup',
          onclick: () => downloadFile(`expense-tracker-setup-${new Date().toISOString().slice(0, 10)}.json`, exportSetup(state)),
        })));
  }

  function addCategoryForm() {
    const name = el('input', { type: 'text', placeholder: 'New category', 'aria-label': 'New category name', required: true });
    const type = el('select', { 'aria-label': 'New category type' }, Object.entries(TYPE_LABELS).map(([v, t]) => el('option', { value: v, text: t })));
    const parents = [...new Set(state.categories.map((c) => c.parent).filter(Boolean))];
    const parent = el('input', { type: 'text', placeholder: 'Group (optional)', 'aria-label': 'Group it under', list: 'category-parents' });
    return el('form', {
      class: 'inline-form',
      onsubmit: (e) => {
        e.preventDefault();
        const group = parent.value.trim();
        const n = group ? `${group} / ${name.value.trim()}` : name.value.trim();
        if (!name.value.trim()) return;
        if (state.categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return alert('That category already exists.');
        store.commit((s) => { s.categories.push(group ? { name: n, type: type.value, parent: group } : { name: n, type: type.value }); });
        rerender(`Added “${n}”.`);
      },
    }, name, type, parent, el('datalist', { id: 'category-parents' }, parents.map((p) => el('option', { value: p }))),
    el('button', { type: 'submit', text: 'Add category' }));
  }

  function addRuleForm() {
    const keyword = el('input', { type: 'text', placeholder: 'Keyword, e.g. GYM', 'aria-label': 'Rule keyword', required: true });
    const category = el('select', { 'aria-label': 'Rule category' }, categoryOptions(state.categories));
    const sign = el('select', { 'aria-label': 'Direction' }, Object.entries(SIGN_LABELS).map(([v, t]) => el('option', { value: v, text: t })));
    const amount = el('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Exact amount (optional)', 'aria-label': 'Exact amount' });
    return el('form', {
      class: 'inline-form',
      onsubmit: (e) => {
        e.preventDefault();
        const rule = { match: keyword.value.trim().toUpperCase(), category: category.value };
        if (!rule.match) return;
        if (sign.value) rule.sign = sign.value;
        if (amount.value !== '') rule.amount = Math.abs(Number(amount.value));
        let changed = 0;
        store.commit((s) => {
          s.rules = s.rules.filter((r) => !(r.match.toUpperCase() === rule.match && r.amount === rule.amount && r.sign === rule.sign));
          s.rules.push(rule);
          changed = applyRule(s.transactions, rule, s.rules);
        });
        rerender(`Rule added: “${rule.match}” → ${rule.category}. ${changed} transaction${changed === 1 ? '' : 's'} updated.`);
      },
    }, keyword, sign, amount, category, el('button', { type: 'submit', text: 'Add rule' }));
  }
}
