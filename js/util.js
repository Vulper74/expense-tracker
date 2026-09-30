// Small shared helpers.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const NO_CENTS = ['HUF', 'JPY', 'ISK', 'KRW', 'CLP', 'RSD'];

// compact: $1.2M · whole: $1,234 (no cents)
export function formatMoney(amount, currency = 'USD', { compact = false, whole = false } = {}) {
  try {
    const options = { style: 'currency', currency };
    // Nobody uses forint or yen fillér/sen, so show whole numbers.
    if (NO_CENTS.includes(currency)) Object.assign(options, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (compact) Object.assign(options, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
    else if (whole) Object.assign(options, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return new Intl.NumberFormat(undefined, options).format(amount);
  } catch {
    // Unknown currency code: fall back to a plain number.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatPercent(fraction, digits = 0) {
  if (fraction == null || !Number.isFinite(fraction)) return '–';
  return `${(fraction * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-09' -> 'Sep 2026' (or 'Sep 26' when short)
export function formatMonth(month, { short = false } = {}) {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${short ? y.slice(2) : y}`;
}

// '2026-09-27' -> '27 Sep 2026'
export function formatDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Build a DOM element. Text is always set with textContent, never innerHTML,
// because descriptions come from bank files.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'value') continue; // set after children so <select> options exist
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  if (attrs.value != null) node.value = attrs.value;
  return node;
}

// Replaces a node's children, skipping empty ones and flattening lists like el().
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

export function downloadFile(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Replace a node's contents, skipping empty (null/false) entries.
export function mount(root, ...children) {
  root.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}
