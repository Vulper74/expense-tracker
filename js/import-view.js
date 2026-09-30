// Import screen: pick a file → (known bank: straight to preview | other: map columns) → import.

import { parseCSV } from './csv.js';
import { readXlsx } from './xlsx.js';
import { parseStatement, INTERNAL } from './banks.js';
import { showForReview } from './transactions-view.js';
import { DATE_FORMATS, guessMapping, headerSignature, importStatement, mapRows, mergeTransactions } from './importer.js';
import { categorize } from './categorize.js';
import { el, formatDate, formatMoney, mount, readFileAsText } from './util.js';

// The file being imported stays in memory until it's imported or replaced.
// Known bank: { fileName, parsed }. Other: { fileName, rows, mapping, profileName, matchedProfile }.
let pending = null;
let lastResult = null;

async function readRows(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  // .xlsx files are zips, which start with "PK".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(buffer);
  return parseCSV(await readFileAsText(file));
}

export function renderImport(root, store, { goTo }) {
  const { state } = store;
  mount(root,
    el('h2', { text: 'Import transactions' }),
    el('p', { class: 'muted', text: 'Your files are read in this browser only. Nothing is uploaded anywhere.' }),
    lastResult ? resultBanner(lastResult, goTo) : null,
    fileStep(),
    pending?.parsed ? bankPreview() : null,
    pending?.rows ? mappingStep() : null,
    pending?.rows ? previewStep() : null,
  );
  // Show the banner once.
  lastResult = null;

  function rerender() {
    renderImport(root, store, { goTo });
  }

  function fileStep() {
    const input = el('input', {
      type: 'file',
      accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      onchange: async () => {
        const file = input.files[0];
        if (!file) return;
        let rows;
        try {
          rows = await readRows(file);
        } catch (err) {
          alert(err.message);
          return;
        }
        if (!rows.length) {
          alert('That file looks empty.');
          return;
        }
        const parsed = parseStatement(rows, state.settings.currency);
        if (parsed) {
          pending = { fileName: file.name, parsed };
          rerender();
          return;
        }
        const signature = headerSignature(rows);
        const matched = state.profiles.find((p) => p.signature === signature);
        pending = {
          fileName: file.name,
          rows,
          mapping: matched ? { ...matched.mapping } : guessMapping(rows),
          profileName: matched?.name ?? file.name.replace(/\.csv$/i, ''),
          matchedProfile: matched?.name ?? null,
        };
        rerender();
      },
    });
    return el('section', { class: 'card' },
      el('h3', { text: '1. Choose a statement' }),
      el('p', { class: 'muted', text: 'Revolut (CSV) and OTP (Excel) statements are read automatically. For other banks, export CSV and match the columns.' }),
      el('label', { class: 'file-picker' }, input),
      pending?.rows ? el('p', {}, 'Loaded ', el('strong', { text: pending.fileName }), ` · ${pending.rows.length} rows`) : null,
    );
  }

  function mappingStep() {
    const { rows, mapping } = pending;
    const width = Math.max(...rows.map((r) => r.length));
    const header = rows[0];
    const sample = mapping.hasHeader ? rows[1] ?? [] : rows[0];
    const columnOptions = [...Array(width).keys()].map((i) => {
      const name = mapping.hasHeader ? header[i] || `Column ${i + 1}` : `Column ${i + 1}`;
      const example = sample[i] ? ` (e.g. ${sample[i].slice(0, 30)})` : '';
      return el('option', { value: String(i), text: `${name}${example}` });
    });

    const update = (changes) => {
      Object.assign(pending.mapping, changes);
      rerender();
    };
    const columnSelect = (key) =>
      el('select', { value: String(mapping[key]), onchange: (e) => update({ [key]: Number(e.target.value) }) },
        columnOptions.map((o) => o.cloneNode(true)));

    const otherProfiles = state.profiles.filter((p) => p.name !== pending.matchedProfile);

    return el('section', { class: 'card' },
      el('h3', { text: '2. Tell the app what each column is' }),
      pending.matchedProfile
        ? el('p', { class: 'notice' }, 'Using your saved settings for ', el('strong', { text: pending.matchedProfile }), '.')
        : el('p', { class: 'muted', text: 'I’ve guessed the columns. Check them against the preview below.' }),
      otherProfiles.length
        ? el('label', { class: 'field' }, 'Use saved bank settings',
          el('select', {
            onchange: (e) => {
              const p = state.profiles.find((x) => x.name === e.target.value);
              if (p) {
                pending.mapping = { ...p.mapping };
                pending.profileName = p.name;
              }
              rerender();
            },
          }, el('option', { value: '', text: '— choose —' }), otherProfiles.map((p) => el('option', { value: p.name, text: p.name }))))
        : null,
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: mapping.hasHeader, onchange: (e) => update({ hasHeader: e.target.checked }) }),
        'The first row is column names'),
      el('div', { class: 'grid-2' },
        el('label', { class: 'field' }, 'Date column', columnSelect('date')),
        el('label', { class: 'field' }, 'Date format',
          el('select', { value: mapping.dateFormat, onchange: (e) => update({ dateFormat: e.target.value }) },
            DATE_FORMATS.map((f) => el('option', { value: f.id, text: f.label })))),
        el('label', { class: 'field' }, 'Description column', columnSelect('description')),
        el('label', { class: 'field' }, 'Amounts are in',
          el('select', { value: mapping.amountMode, onchange: (e) => update({ amountMode: e.target.value }) },
            el('option', { value: 'single', text: 'One column (money out is negative)' }),
            el('option', { value: 'split', text: 'Two columns (money out / money in)' }),
            el('option', { value: 'typed', text: 'One column, plus a column saying money in or out' }))),
        ...(mapping.amountMode === 'split'
          ? [
            el('label', { class: 'field' }, 'Money out column', columnSelect('debit')),
            el('label', { class: 'field' }, 'Money in column', columnSelect('credit')),
          ]
          : [el('label', { class: 'field' }, 'Amount column', columnSelect('amount'))]),
        mapping.amountMode === 'typed'
          ? el('label', { class: 'field' }, 'Money in / out column', columnSelect('type'),
            el('span', { class: 'hint', text: 'Values like Expense / Income, Debit / Credit or DR / CR.' }))
          : null,
      ),
      mapping.amountMode === 'single'
        ? el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: mapping.invert, onchange: (e) => update({ invert: e.target.checked }) }),
          'My bank shows spending as positive numbers (flip the signs)')
        : null,
      el('label', { class: 'field' }, 'Save these settings as',
        el('input', { type: 'text', value: pending.profileName, placeholder: 'e.g. Chase checking', oninput: (e) => (pending.profileName = e.target.value) }),
        el('span', { class: 'hint', text: 'Next time you import a file from this bank, these settings are used automatically.' })),
    );
  }

  function bankPreview() {
    const { parsed } = pending;
    const internal = parsed.rows.filter((r) => r.category === INTERNAL);
    const shown = parsed.rows.filter((r) => r.category !== INTERNAL).sort((a, b) => b.date.localeCompare(a.date));
    const accounts = [...new Set(parsed.rows.map((r) => r.account))];
    const { pending: waiting, other } = parsed.skipped;
    const limit = pending.limit ?? 10;

    return el('section', { class: 'card' },
      el('h3', {}, `2. Check your ${parsed.bank} statement`),
      el('p', {}, el('strong', { text: pending.fileName }), ` · ${accounts.join(', ')}`),
      el('ul', { class: 'summary-list' },
        el('li', { text: `${shown.length} transactions to categorise` }),
        internal.length ? el('li', { text: `${internal.length} moves between your own accounts (exchanges, round-ups, savings). Kept, but not counted as spending or income.` }) : null,
        waiting ? el('li', { text: `${waiting} pending, skipped. They’ll come in with your next statement once they’ve gone through.` }) : null,
        other ? el('li', { text: `${other} declined or reverted, skipped.` }) : null,
        parsed.exchanges.length ? el('li', { text: `${parsed.exchanges.length} currency exchange${parsed.exchanges.length === 1 ? '' : 's'}, used for exchange rates.` }) : null,
        parsed.errors.length ? el('li', { text: `${parsed.errors.length} rows couldn’t be read.` }) : null),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'preview' },
          el('thead', {}, el('tr', {}, ['Date', 'Description', 'Category', 'Amount'].map((h) => el('th', { class: h === 'Amount' ? 'num' : null, text: h })))),
          el('tbody', {}, shown.slice(0, limit).map((r) => el('tr', {},
            el('td', { class: 'nowrap', text: formatDate(r.date) }),
            el('td', { text: r.description }),
            el('td', { text: r.category ?? categorize(r.description, r.originalAmount, state.rules, r.fallbackCategory) }),
            el('td', { class: `num ${r.originalAmount > 0 ? 'positive' : ''}`, text: formatMoney(r.originalAmount, r.currency) })))))),
      shown.length > limit ? el('button', { class: 'small', text: `Show all ${shown.length}`, onclick: () => { pending.limit = shown.length; rerender(); } }) : null,
      parsed.errors.length
        ? el('details', {}, el('summary', { text: `Rows that can’t be read (${parsed.errors.length})` }),
          el('ul', {}, parsed.errors.slice(0, 20).map((e) => el('li', { text: `Line ${e.line}: ${e.reason}` }))))
        : null,
      el('div', { class: 'actions' },
        el('button', {
          class: 'primary',
          disabled: !parsed.rows.length,
          text: `Import ${parsed.rows.length} transactions`,
          onclick: () => {
            let result;
            store.commit((s) => { result = importStatement(s, parsed); });
            lastResult = { ...result, errors: parsed.errors.length };
            pending = null;
            rerender();
          },
        }),
        el('button', { text: 'Cancel', onclick: () => { pending = null; rerender(); } })),
    );
  }

  function previewStep() {
    const { rows: mapped, errors } = mapRows(pending.rows, pending.mapping);
    const currency = state.settings.currency;
    const spending = mapped.filter((r) => r.amount < 0).length;

    return el('section', { class: 'card' },
      el('h3', { text: '3. Check the preview' }),
      el('p', {}, `${mapped.length} transactions ready`,
        mapped.length ? ` · ${spending} money out, ${mapped.length - spending} money in` : '',
        errors.length ? ` · ${errors.length} rows can’t be read` : ''),
      mapped.length && spending === 0
        ? el('p', { class: 'warning', text: 'Every amount is positive. If a column says which rows are money in or out, choose “One column, plus a column saying money in or out” above. If they’re all purchases, tick “flip the signs”.' })
        : null,
      el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {}, ['Date', 'Description', 'Category', 'Amount'].map((h) => el('th', { text: h })))),
          el('tbody', {}, mapped.slice(0, 8).map((r) => el('tr', {},
            el('td', { text: formatDate(r.date) }),
            el('td', { text: r.description }),
            el('td', { text: categorize(r.description, r.amount, state.rules) }),
            el('td', { class: `num ${r.amount > 0 ? 'positive' : ''}`, text: formatMoney(r.amount, currency) })))))),
      errors.length
        ? el('details', {}, el('summary', { text: `Rows that can’t be read (${errors.length})` }),
          el('ul', {}, errors.slice(0, 20).map((e) => el('li', { text: `Line ${e.line}: ${e.reason}` }))))
        : null,
      el('div', { class: 'actions' },
        el('button', {
          class: 'primary',
          disabled: !mapped.length,
          text: `Import ${mapped.length} transactions`,
          onclick: () => {
            let result;
            store.commit((s) => {
              result = mergeTransactions(s.transactions, mapped, s.rules, { categories: s.categories });
              const name = pending.profileName.trim();
              if (name) {
                s.profiles = s.profiles.filter((p) => p.name !== name);
                s.profiles.push({ name, signature: headerSignature(pending.rows), mapping: { ...pending.mapping } });
              }
            });
            lastResult = { ...result, errors: errors.length };
            pending = null;
            rerender();
          },
        }),
        el('button', { text: 'Cancel', onclick: () => { pending = null; rerender(); } }),
      ),
    );
  }
}

function resultBanner({ added, skipped, errors, missingRates = [], review = 0, newPeople = [] }, goTo) {
  return el('div', { class: 'notice success' },
    el('strong', { text: `Imported ${added} new transaction${added === 1 ? '' : 's'}.` }),
    skipped ? ` Skipped ${skipped} already imported.` : '',
    errors ? ` ${errors} rows couldn’t be read.` : '',
    missingRates.length ? ` No exchange rate yet for ${missingRates.join(', ')}: add one in Settings → Currency, or import a statement with an exchange.` : '',
    review ? ` ${review} need a category.` : '',
    newPeople.length ? el('p', { text: `New people: ${newPeople.join(', ')}. Pick a category for them and make a rule, so next time they’re sorted.` }) : '',
    ' ',
    el('button', {
      class: 'link',
      text: review ? 'Review them →' : 'See transactions →',
      onclick: () => {
        if (review) showForReview();
        goTo('transactions');
      },
    }));
}
