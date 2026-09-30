// A small CSV parser: quoted fields, "" escapes, newlines inside quotes,
// comma / semicolon / tab / pipe delimiters, and a leading BOM.

const DELIMITERS = [',', ';', '\t', '|'];

function stripBom(text) {
  return text.replace(/^\uFEFF/, '');
}

// Pick the delimiter that appears most often (outside quotes) in the first line.
export function detectDelimiter(text) {
  const firstLine = stripBom(text).split(/\r?\n/)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

// Returns an array of rows, each an array of strings. Blank lines are dropped.
export function parseCSV(text, delimiter = detectDelimiter(text)) {
  text = stripBom(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
