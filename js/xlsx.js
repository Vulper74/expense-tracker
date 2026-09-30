// Reads the first sheet of an .xlsx file into rows of text, like parseCSV does.
// An .xlsx file is a zip of XML files. The browser unzips it with
// DecompressionStream, so no library is needed and nothing leaves the device.

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);

// { 'xl/workbook.xml': Uint8Array(compressed), ... } from the zip's central directory.
function zipEntries(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65535); i--) {
    if (u32(view, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This isn’t an Excel (.xlsx) file.');

  const entries = new Map();
  let at = u32(view, end + 16);
  const count = u16(view, end + 10);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(view, at) !== 0x02014b50) throw new Error('The .xlsx file looks damaged.');
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLength = u16(view, at + 28);
    const skip = nameLength + u16(view, at + 30) + u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLength));
    // The local header repeats the name and has its own extra field.
    const dataStart = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    entries.set(name, { method, data: new Uint8Array(buffer, dataStart, size) });
    at += 46 + skip;
  }
  return entries;
}

async function readEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.method === 0) return new TextDecoder().decode(entry.data);
  if (entry.method !== 8) throw new Error('This .xlsx file uses a compression the app can’t read.');
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

// Text of <t> elements, skipping phonetic guides (<rPh>) used in some languages.
function cellText(node) {
  return [...node.getElementsByTagName('t')]
    .filter((t) => t.parentNode.nodeName !== 'rPh')
    .map((t) => t.textContent)
    .join('');
}

// "AB12" -> 27 (zero-based column)
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function firstSheetPath(entries) {
  const workbook = await readEntry(entries, 'xl/workbook.xml');
  const rels = await readEntry(entries, 'xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const sheet = parseXml(workbook).getElementsByTagName('sheet')[0];
    const id = sheet?.getAttribute('r:id');
    const rel = [...parseXml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === id);
    const target = rel?.getAttribute('Target');
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

// Returns [['Account number', 'Partner name', …], …]. Empty rows are left out.
export async function readXlsx(buffer) {
  const entries = zipEntries(buffer);
  const sharedXml = await readEntry(entries, 'xl/sharedStrings.xml');
  const shared = sharedXml ? [...parseXml(sharedXml).getElementsByTagName('si')].map(cellText) : [];
  const sheetXml = await readEntry(entries, await firstSheetPath(entries));
  if (!sheetXml) throw new Error('Couldn’t find a sheet in this .xlsx file.');

  const rows = [];
  for (const rowNode of parseXml(sheetXml).getElementsByTagName('row')) {
    const row = [];
    for (const c of rowNode.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = cellText(c);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else value = v;
      const ref = c.getAttribute('r');
      const index = ref ? columnIndex(ref) : row.length;
      while (row.length < index) row.push('');
      row[index] = value;
    }
    if (row.some((v) => String(v).trim())) rows.push(row);
  }
  return rows;
}

// Excel stores dates as days since 1900 (with its famous leap-year bug).
export function excelSerialToDate(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
