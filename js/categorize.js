// Categories and keyword rules.
// Category types: 'expense' counts as spending, 'income' as income,
// 'transfer' is ignored (moving money between your own accounts).

export const UNCATEGORIZED = 'Uncategorized';
export const OTHER_INCOME = 'Other Income';

// A category can sit under a parent (e.g. "Flat / Mortgage" under "Flat") to
// group it in lists. Names are unique, so the full name is what's stored.
export const DEFAULT_CATEGORIES = [
  { name: 'Housing', type: 'expense' },
  { name: 'Utilities', type: 'expense' },
  { name: 'Groceries', type: 'expense' },
  { name: 'Dining Out', type: 'expense' },
  { name: 'Transport', type: 'expense' },
  { name: 'Subscriptions', type: 'expense' },
  { name: 'Shopping', type: 'expense' },
  { name: 'Tech', type: 'expense' },
  { name: 'Health', type: 'expense' },
  { name: 'Sport', type: 'expense' },
  { name: 'Learning', type: 'expense' },
  { name: 'Entertainment', type: 'expense' },
  { name: 'Travel', type: 'expense' },
  { name: 'Gifts', type: 'expense' },
  { name: 'Cash', type: 'expense' },
  { name: 'Bank fees', type: 'expense' },
  { name: 'Other', type: 'expense' },
  { name: UNCATEGORIZED, type: 'expense' },
  { name: 'Salary', type: 'income' },
  { name: 'Interest', type: 'income' },
  { name: OTHER_INCOME, type: 'income' },
  { name: 'Transfers', type: 'transfer' },
  { name: 'Investments', type: 'transfer' },
];

// Categories the importers rely on. They come back if deleted.
export const REQUIRED_CATEGORIES = ['Transfers', 'Investments', 'Interest', 'Bank fees', 'Cash', UNCATEGORIZED, OTHER_INCOME];

// General shops and services only. Your own rules (people, local places) live in
// your personal setup file, not here.
export const DEFAULT_RULES = [
  ['NETFLIX', 'Subscriptions'],
  ['SPOTIFY', 'Subscriptions'],
  ['YOUTUBE', 'Subscriptions'],
  ['DISNEY PLUS', 'Subscriptions'],
  ['APPLE.COM/BILL', 'Subscriptions'],
  ['MICROSOFT', 'Subscriptions'],
  ['UBER EATS', 'Dining Out'],
  ['DELIVEROO', 'Dining Out'],
  ['JUST EAT', 'Dining Out'],
  ['WOLT', 'Dining Out'],
  ['STARBUCKS', 'Dining Out'],
  ['MCDONALD', 'Dining Out'],
  ['UBER', 'Transport'],
  ['BOLT', 'Transport'],
  ['FREENOW', 'Transport'],
  ['IRISH RAIL', 'Transport'],
  ['LEAP CARD', 'Transport'],
  ['LIDL', 'Groceries'],
  ['ALDI', 'Groceries'],
  ['TESCO', 'Groceries'],
  ['DUNNES', 'Groceries'],
  ['SUPERVALU', 'Groceries'],
  ['SPAR', 'Groceries'],
  ['CENTRA', 'Groceries'],
  ['AMAZON', 'Shopping'],
  ['IKEA', 'Shopping'],
  ['PHARMACY', 'Health'],
  ['BOOTS', 'Health'],
  ['AIRBNB', 'Travel'],
  ['BOOKING.COM', 'Travel'],
  ['RYANAIR', 'Travel'],
  ['AER LINGUS', 'Travel'],
  ['WIZZ AIR', 'Travel'],
  ['ETORO', 'Investments'],
  ['PAYROLL', 'Salary'],
  ['SALARY', 'Salary'],
].map(([match, category]) => ({ match, category }));

// A keyword matches at the start of a word, so "RENT" matches "RENT PAYMENT"
// but not "CURRENT ACCOUNT".
export function matchesKeyword(description, keyword) {
  const text = description.toUpperCase();
  const key = keyword.trim().toUpperCase();
  if (!key) return false;
  let i = text.indexOf(key);
  while (i !== -1) {
    if (i === 0 || !/[A-Z0-9]/.test(text[i - 1])) return true;
    i = text.indexOf(key, i + 1);
  }
  return false;
}

// A rule can also require an exact amount and a direction, e.g. "LANDLORD,
// 1,350 out → Rent". Amounts are in the transaction's own currency.
// sign: 'out' (money out), 'in' (money in) or empty (either).
export function ruleMatches(rule, description, amount) {
  if (!matchesKeyword(description, rule.match)) return false;
  if (rule.sign === 'out' && !(amount < 0)) return false;
  if (rule.sign === 'in' && !(amount > 0)) return false;
  if (rule.amount != null && rule.amount !== '' && Math.abs(Math.abs(amount) - Number(rule.amount)) > 0.005) return false;
  return true;
}

// Most specific rule wins: one with an amount, then one with a direction,
// then the longest keyword, so "UBER EATS" beats "UBER".
const specificity = (r) => (r.amount != null && r.amount !== '' ? 2 : 0) + (r.sign ? 1 : 0);
export function sortRules(rules) {
  return [...rules].sort((a, b) => specificity(b) - specificity(a) || b.match.length - a.match.length);
}

export function categorize(description, amount, rules, fallback) {
  const rule = sortRules(rules).find((r) => ruleMatches(r, description, amount));
  if (rule) return rule.category;
  return fallback ?? (amount > 0 ? OTHER_INCOME : UNCATEGORIZED);
}

// Rules leave alone categories you picked and ones the bank file decided
// (currency exchanges, interest, fees).
export function followsRules(t) {
  return !t.manual && !t.fromBank;
}

export function categorizeTransaction(t, rules) {
  return categorize(t.description, t.originalAmount ?? t.amount, rules, t.fallback);
}

export function categoryType(name, categories) {
  return categories.find((c) => c.name === name)?.type ?? 'expense';
}

// Guess a keyword to turn into a rule, e.g. "NETFLIX.COM 866-579-7172 CA" -> "NETFLIX.COM".
export function suggestKeyword(description) {
  const words = description
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => /[A-Z]{3,}/.test(w) && !/\d{3,}/.test(w) && !/^(POS|DEBIT|CARD|PURCHASE|PAYMENT|ACH|SQ|TST)\*?$/.test(w));
  return words.slice(0, 2).join(' ') || description.toUpperCase().slice(0, 20);
}

// Re-categorize every transaction that matches the keyword, except ones the
// user set by hand. `rules` is the full list, so a more specific rule still
// wins over the new one. Returns how many changed.
export function applyRule(transactions, rule, rules = [rule]) {
  let changed = 0;
  for (const t of transactions) {
    if (!followsRules(t) || !matchesKeyword(t.description, rule.match)) continue;
    const category = categorizeTransaction(t, rules);
    if (t.category !== category) {
      t.category = category;
      changed++;
    }
  }
  return changed;
}

// Re-run every rule. Returns how many changed.
export function applyAllRules(transactions, rules) {
  let changed = 0;
  for (const t of transactions) {
    if (!followsRules(t)) continue;
    const category = categorizeTransaction(t, rules);
    if (category !== t.category) {
      t.category = category;
      changed++;
    }
  }
  return changed;
}

// For drop-downs: top-level categories, with sub-categories grouped under their parent.
// Returns [{ label, categories }] where label is null for the ungrouped ones.
export function groupCategories(categories) {
  const parents = new Set(categories.map((c) => c.parent).filter(Boolean));
  const groups = [{ label: null, categories: categories.filter((c) => !c.parent && !parents.has(c.name)) }];
  for (const parent of parents) {
    groups.push({ label: parent, categories: categories.filter((c) => c.parent === parent || c.name === parent) });
  }
  return groups;
}

// "Flat / Mortgage" -> "Mortgage" when shown under its "Flat" group.
export function shortName(category) {
  return category.parent && category.name.startsWith(`${category.parent} / `)
    ? category.name.slice(category.parent.length + 3)
    : category.name;
}

// Transfers to and from people, e.g. "Transfer from Alex Example" -> "Alex Example".
const PERSON = /^(?:to|from|transfer (?:to|from)|payment from|money added from)\s+(.+)$/i;
export function personName(description) {
  const name = description.match(PERSON)?.[1]?.trim();
  return name && /[a-z]/i.test(name) && !/\b(savings|vault|pocket|pot|account|eur|usd|huf|ltd|limited|inc|llc|plc|gmbh|kft|zrt|nyrt|bt|dac|corp|company|bank)\b/i.test(name) ? name : null;
}

// A transaction no rule knew what to do with.
export function needsReview(t) {
  return !t.manual && !t.fromBank && !t.repays?.length && !t.splits?.length && (t.category === UNCATEGORIZED || t.category === OTHER_INCOME);
}
