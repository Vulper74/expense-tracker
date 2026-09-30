// Small SVG charts: horizontal bars, grouped columns, lines.
// Every chart has a hover tooltip and a "Show as table" view, so no value
// depends on hovering or on telling colours apart.

import { el } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

// Round axis ticks: 0, 500, 1,000 …
function niceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// Bar with a 4px rounded end and a square base.
function barPath(x, y, w, h, orientation) {
  const r = Math.min(4, orientation === 'h' ? h / 2 : w / 2, orientation === 'h' ? w : h);
  if (orientation === 'h') {
    // grows right from x
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  // grows up from y + h
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---- tooltip -------------------------------------------------------------

function createTooltip(wrap) {
  const tip = el('div', { class: 'chart-tooltip', role: 'status', hidden: true });
  wrap.append(tip);
  return {
    // rows: [{ value, label, seriesIndex? }]
    show(title, rows, x, y) {
      tip.replaceChildren(
        el('div', { class: 'tt-title', text: title }),
        ...rows.map((r) =>
          el('div', { class: 'tt-row' },
            r.seriesIndex != null ? el('span', { class: `tt-key series-${r.seriesIndex + 1}` }) : null,
            el('strong', { text: r.value }),
            el('span', { class: 'tt-label', text: r.label }))),
      );
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const left = Math.min(Math.max(x + 12, 0), box.width - tip.offsetWidth - 4);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(y - tip.offsetHeight - 8, 0)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function pointerIn(wrap, event) {
  const box = wrap.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

// ---- legend & table ------------------------------------------------------

function legend(series, shape) {
  if (series.length < 2) return null;
  return el('div', { class: 'chart-legend' },
    series.map((s, i) => el('span', { class: 'legend-item' },
      el('span', { class: `legend-key ${shape} series-${i + 1}` }), s.name)));
}

function tableView(columns, rows) {
  return el('details', { class: 'chart-table' },
    el('summary', { text: 'Show as table' }),
    el('table', {},
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((cell) => el('td', { text: cell })))))));
}

// ---- horizontal bar chart (one series) ------------------------------------

// items: [{ label, value }]
export function horizontalBarChart(items, { format, emptyText = 'No data' } = {}) {
  const wrap = el('div', { class: 'chart' });
  if (!items.length) return el('p', { class: 'empty', text: emptyText });

  const rowH = 32;
  const barH = 20;
  const labelW = 130;
  const valueW = 90;
  const width = 640;
  const height = items.length * rowH + 4;
  const plotW = width - labelW - valueW;
  const max = Math.max(...items.map((i) => i.value), 1);
  const tip = createTooltip(wrap);

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': 'Bar chart' });
  items.forEach((item, i) => {
    const y = i * rowH + 2;
    const w = Math.max((Math.max(item.value, 0) / max) * plotW, 1);
    root.append(svg('text', { x: labelW - 10, y: y + rowH / 2, class: 'axis-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, item.label));
    const bar = svg('path', { d: barPath(labelW, y + (rowH - barH) / 2, w, barH, 'h'), class: 'mark series-1' });
    root.append(bar);
    root.append(svg('text', { x: labelW + w + 8, y: y + rowH / 2, class: 'value-label', 'dominant-baseline': 'middle' }, format(item.value)));
    // Hit area covers the whole row, bigger than the bar.
    const hit = svg('rect', { x: 0, y, width, height: rowH, class: 'hit', tabindex: 0 });
    const show = (e) => {
      bar.classList.add('active');
      const p = e.clientX != null ? pointerIn(wrap, e) : { x: labelW + w, y: y };
      tip.show(item.label, [{ value: format(item.value), label: 'spent' }], p.x, p.y);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('focus', show);
    const hide = () => {
      bar.classList.remove('active');
      tip.hide();
    };
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    root.append(hit);
  });

  wrap.prepend(root);
  return el('div', {}, wrap, tableView(['Category', 'Amount'], items.map((i) => [i.label, format(i.value)])));
}

// ---- shared axis frame for column & line charts ---------------------------

function frame({ labels, min, max, format, height = 260 }) {
  const width = 640;
  const pad = { top: 12, right: 16, bottom: 28, left: 64 };
  const ticks = niceTicks(min, max);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const yOf = (v) => pad.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img' });
  for (const t of ticks) {
    const y = yOf(t);
    root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: t === 0 ? 'baseline' : 'grid' }));
    root.append(svg('text', { x: pad.left - 8, y, class: 'axis-label tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, format(t)));
  }
  // Thin out x labels so they never collide.
  const every = Math.ceil(labels.length / 8);
  return { root, width, height, pad, plotW, plotH, yOf, every };
}

// ---- grouped column chart --------------------------------------------------

// labels: ['Sep 26', …]; series: [{ name, values: [] }]
export function groupedColumnChart(labels, series, { format, tickFormat = format } = {}) {
  const wrap = el('div', { class: 'chart' });
  if (!labels.length) return el('p', { class: 'empty', text: 'No data yet' });
  const all = series.flatMap((s) => s.values);
  const f = frame({ labels, min: Math.min(0, ...all), max: Math.max(...all, 1), format: tickFormat });
  const band = f.plotW / labels.length;
  const gap = 2;
  const barW = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);
  const tip = createTooltip(wrap);

  labels.forEach((label, i) => {
    const x0 = f.pad.left + band * i + (band - groupW) / 2;
    const marks = series.map((s, si) => {
      const v = s.values[i];
      const top = f.yOf(Math.max(v, 0));
      const h = Math.max(Math.abs(f.yOf(v) - f.yOf(0)), 0.5);
      const mark = svg('path', { d: barPath(x0 + si * (barW + gap), top, barW, h, 'v'), class: `mark series-${si + 1}` });
      f.root.append(mark);
      return mark;
    });
    if (i % f.every === 0) {
      f.root.append(svg('text', { x: f.pad.left + band * i + band / 2, y: f.height - 8, class: 'axis-label', 'text-anchor': 'middle' }, label));
    }
    const hit = svg('rect', { x: f.pad.left + band * i, y: f.pad.top, width: band, height: f.plotH, class: 'hit', tabindex: 0 });
    const show = (e) => {
      marks.forEach((m) => m.classList.add('active'));
      const p = e.clientX != null ? pointerIn(wrap, e) : { x: x0, y: f.pad.top + 20 };
      tip.show(label, series.map((s, si) => ({ value: format(s.values[i]), label: s.name, seriesIndex: si })), p.x, p.y);
    };
    const hide = () => {
      marks.forEach((m) => m.classList.remove('active'));
      tip.hide();
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    f.root.append(hit);
  });

  wrap.prepend(f.root);
  return el('div', {},
    legend(series, 'rect'),
    wrap,
    tableView(['Month', ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => format(s.values[i]))])));
}

// ---- line chart ------------------------------------------------------------

// series: [{ name, values: [] }] (null values leave a gap)
// references: optional [{ value, label }] drawn as horizontal lines (e.g. the FIRE target)
export function lineChart(labels, series, { format, tickFormat = format, references = [], xTitle = '', minZero = true } = {}) {
  const wrap = el('div', { class: 'chart' });
  if (!labels.length) return el('p', { class: 'empty', text: 'No data yet' });
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  references = references.filter((r) => Number.isFinite(r.value));
  for (const r of references) all.push(r.value);
  if (!all.length) return el('p', { class: 'empty', text: 'No data yet' });
  const f = frame({ labels, min: minZero ? Math.min(0, ...all) : Math.min(...all), max: Math.max(...all), format: tickFormat });
  const step = labels.length > 1 ? f.plotW / (labels.length - 1) : 0;
  const xOf = (i) => f.pad.left + (labels.length > 1 ? step * i : f.plotW / 2);

  references.forEach((r, i) => {
    const y = f.yOf(r.value);
    f.root.append(svg('line', { x1: f.pad.left, x2: f.width - f.pad.right, y1: y, y2: y, class: 'reference' }));
    // Second label sits under its line so two close targets don't overlap.
    f.root.append(svg('text', { x: f.pad.left + 6, y: i === 0 ? y - 6 : y + 14, class: 'value-label' }, r.label));
  });

  series.forEach((s, si) => {
    let d = '';
    let penDown = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        penDown = false;
        return;
      }
      d += `${penDown ? 'L' : 'M'}${xOf(i)},${f.yOf(v)}`;
      penDown = true;
    });
    f.root.append(svg('path', { d, class: `line series-${si + 1}` }));
    // End dot + end label on the last value.
    const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null && Number.isFinite(v)).pop();
    if (last) {
      f.root.append(svg('circle', { cx: xOf(last[1]), cy: f.yOf(last[0]), r: 4, class: `dot series-${si + 1}` }));
    }
  });

  labels.forEach((label, i) => {
    if (i % f.every === 0) {
      f.root.append(svg('text', { x: xOf(i), y: f.height - 8, class: 'axis-label', 'text-anchor': 'middle' }, label));
    }
  });

  // Crosshair: snaps to the nearest x position and lists every series.
  const tip = createTooltip(wrap);
  const cross = svg('line', { y1: f.pad.top, y2: f.pad.top + f.plotH, class: 'crosshair', visibility: 'hidden' });
  f.root.append(cross);
  const overlay = svg('rect', { x: f.pad.left, y: f.pad.top, width: f.plotW, height: f.plotH, class: 'hit', tabindex: 0 });
  let focusIndex = labels.length - 1;
  const showAt = (i, px, py) => {
    cross.setAttribute('x1', xOf(i));
    cross.setAttribute('x2', xOf(i));
    cross.setAttribute('visibility', 'visible');
    const scale = wrap.getBoundingClientRect().width / f.width;
    tip.show(`${xTitle}${labels[i]}`, series.map((s, si) => ({ value: s.values[i] == null ? '–' : format(s.values[i]), label: s.name, seriesIndex: series.length > 1 ? si : null })), px ?? xOf(i) * scale, py ?? f.pad.top * scale + 30);
  };
  overlay.addEventListener('pointermove', (e) => {
    const p = pointerIn(wrap, e);
    const scale = wrap.getBoundingClientRect().width / f.width;
    const i = Math.round((p.x / scale - f.pad.left) / (step || 1));
    focusIndex = Math.max(0, Math.min(labels.length - 1, i));
    showAt(focusIndex, p.x, p.y);
  });
  overlay.addEventListener('focus', () => showAt(focusIndex));
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      focusIndex = Math.max(0, Math.min(labels.length - 1, focusIndex + (e.key === 'ArrowRight' ? 1 : -1)));
      showAt(focusIndex);
      e.preventDefault();
    }
  });
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hide();
  };
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('blur', hide);
  f.root.append(overlay);

  wrap.prepend(f.root);
  return el('div', {},
    legend(series, 'line'),
    wrap,
    tableView([xTitle.trim() || 'Period', ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => (s.values[i] == null ? '–' : format(s.values[i])))])));
}
