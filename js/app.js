// Starts the app and switches between tabs. The tab lives in the URL (#fire),
// so reloading the page keeps you where you were.

import { displayChoices } from './currency.js';
import { createStore } from './storage.js';
import { renderImport } from './import-view.js';
import { renderTransactions } from './transactions-view.js';
import { renderDashboard } from './dashboard-view.js';
import { renderAccounts } from './accounts-view.js';
import { renderFire } from './fire-view.js';
import { renderSettings } from './settings-view.js';

const VIEWS = {
  dashboard: renderDashboard,
  transactions: renderTransactions,
  import: renderImport,
  accounts: renderAccounts,
  fire: renderFire,
  settings: renderSettings,
};

const store = createStore();
const main = document.getElementById('view');
const tabs = [...document.querySelectorAll('[data-tab]')];
const currencySwitch = document.getElementById('display-currency');

// The header switch: totals in any of your currencies, or each transaction as the bank showed it.
function fillCurrencySwitch() {
  const { settings } = store.state;
  const current = settings.display ?? settings.currency;
  currencySwitch.replaceChildren(...displayChoices(store.state).map((c) => {
    const option = document.createElement('option');
    option.value = c;
    option.textContent = c === 'original' ? 'Original' : c;
    return option;
  }));
  currencySwitch.value = current;
  // Only one currency so far: nothing to switch between.
  currencySwitch.hidden = currencySwitch.options.length <= 2 && current !== 'original';
}

function currentTab() {
  const tab = location.hash.slice(1);
  if (VIEWS[tab]) return tab;
  return store.state.transactions.length ? 'dashboard' : 'import';
}

function goTo(tab) {
  if (location.hash === `#${tab}`) show();
  else location.hash = tab;
}

function show() {
  const tab = currentTab();
  for (const t of tabs) {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  fillCurrencySwitch();
  VIEWS[tab](main, store, { goTo });
  window.scrollTo(0, 0);
}

// An import can bring in a new currency, so the switch is refreshed after every change.
const { commit, replace } = store;
store.commit = (mutator) => {
  commit(mutator);
  fillCurrencySwitch();
};
store.replace = (next) => {
  replace(next);
  fillCurrencySwitch();
};

currencySwitch.addEventListener('change', () => {
  const value = currencySwitch.value;
  store.commit((s) => { s.settings.display = value === s.settings.currency ? null : value; });
  show();
});
for (const t of tabs) t.addEventListener('click', () => goTo(t.dataset.tab));
window.addEventListener('hashchange', show);
show();

// Offline support once it's on your phone. Asking for persistent storage keeps
// Safari from clearing your data when the phone runs low on space.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.();
