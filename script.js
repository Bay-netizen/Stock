/* ============================================
   Storage keys
   ============================================ */
const STORAGE_QTY_KEY = 'stationery_stock_qty_v1';
const STORAGE_HISTORY_KEY = 'stationery_stock_history_v1';
const MAX_HISTORY = 500; // cap so localStorage doesn't grow unbounded

/* ============================================
   State
   ============================================ */
let currentQuery = '';
let currentSort = { key: 'no', dir: 'asc' };
let qtyMap = loadQtyMap();       // { code: qty }
let history = loadHistory();     // [{ code, name, unit, delta, mode, note, after, ts }]
let activeAdjustCode = null;
let adjustMode = 'in';

const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const resultCount = document.getElementById('resultCount');
const emptyState = document.getElementById('emptyState');
const emptyQuery = document.getElementById('emptyQuery');
const quickFilters = document.getElementById('quickFilters');

const adjustOverlay = document.getElementById('adjustOverlay');
const adjustProductName = document.getElementById('adjustProductName');
const adjustCurrentQty = document.getElementById('adjustCurrentQty');
const adjustUnit = document.getElementById('adjustUnit');
const adjustAmount = document.getElementById('adjustAmount');
const adjustNote = document.getElementById('adjustNote');
const modeInBtn = document.getElementById('modeIn');
const modeOutBtn = document.getElementById('modeOut');
const historyList = document.getElementById('historyList');

const allHistoryOverlay = document.getElementById('allHistoryOverlay');
const allHistoryList = document.getElementById('allHistoryList');
const historyAllBtn = document.getElementById('historyAllBtn');

/* ============================================
   Persistence helpers
   ============================================ */
function loadQtyMap() {
  try {
    const raw = localStorage.getItem(STORAGE_QTY_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error('อ่านข้อมูลจำนวนไม่สำเร็จ', e);
    return {};
  }
}

function saveQtyMap() {
  try {
    localStorage.setItem(STORAGE_QTY_KEY, JSON.stringify(qtyMap));
  } catch (e) {
    console.error('บันทึกข้อมูลจำนวนไม่สำเร็จ', e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('อ่านประวัติไม่สำเร็จ', e);
    return [];
  }
}

function saveHistory() {
  try {
    if (history.length > MAX_HISTORY) {
      history = history.slice(history.length - MAX_HISTORY);
    }
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('บันทึกประวัติไม่สำเร็จ', e);
  }
}

function getQty(code) {
  if (Object.prototype.hasOwnProperty.call(qtyMap, code)) {
    return qtyMap[code];
  }
  const product = PRODUCTS.find(p => p.code === code);
  return product ? product.qty : 0;
}

/* ============================================
   Formatting helpers
   ============================================ */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ============================================
   Scoring: relevance rank for a query against a product
   ============================================ */
function scoreProduct(p, query) {
  if (!query) return 0;

  const q = query.trim().toLowerCase();
  const code = p.code.toLowerCase();
  const name = p.name.toLowerCase();
  const noStr = String(p.no);

  if (code === q) return 0;
  if (noStr === q) return 1;

  if (code.startsWith(q)) return 10;
  if (name.startsWith(q)) return 12;

  const codeIdx = code.indexOf(q);
  if (codeIdx !== -1) return 20 + codeIdx;

  const nameIdx = name.indexOf(q);
  if (nameIdx !== -1) return 30 + nameIdx * 0.1;

  const words = name.split(/\s+/);
  for (const w of words) {
    if (w.startsWith(q)) return 25;
  }

  if (/^\d+$/.test(q)) {
    if (code.includes(q)) return 40 + codeIdx;
    const nameDigits = name.replace(/[^\d]/g, ' ');
    if (nameDigits.includes(q)) return 45;
  }

  return null;
}

/* ============================================
   Filter + sort pipeline
   ============================================ */
function getFilteredSorted() {
  let results;

  if (!currentQuery) {
    results = PRODUCTS.map(p => ({ p, score: 0 }));
  } else {
    results = PRODUCTS
      .map(p => ({ p, score: scoreProduct(p, currentQuery) }))
      .filter(r => r.score !== null);
  }

  if (currentSort.explicit) {
    results.sort((a, b) => {
      let ka = a.p[currentSort.key];
      let kb = b.p[currentSort.key];
      if (currentSort.key === 'qty') {
        ka = getQty(a.p.code);
        kb = getQty(b.p.code);
      }
      let cmp;
      if (typeof ka === 'number') {
        cmp = ka - kb;
      } else {
        cmp = String(ka).localeCompare(String(kb), 'th');
      }
      return currentSort.dir === 'asc' ? cmp : -cmp;
    });
  } else if (currentQuery) {
    results.sort((a, b) => a.score - b.score || a.p.no - b.p.no);
  } else {
    results.sort((a, b) => a.p.no - b.p.no);
  }

  return results.map(r => r.p);
}

/* ============================================
   Render table
   ============================================ */
function render() {
  const items = getFilteredSorted();

  resultCount.textContent = `${items.length.toLocaleString('th-TH')} รายการ`;

  if (items.length === 0) {
    tableBody.innerHTML = '';
    emptyState.hidden = false;
    emptyQuery.textContent = currentQuery;
    return;
  }

  emptyState.hidden = true;

  const rowsHtml = items.map(p => {
    const qty = getQty(p.code);
    const qtyClass = qty === 0 ? 'qty-zero' : (qty <= 5 ? 'qty-low' : '');
    return `
    <tr>
      <td class="col-no">${p.no}</td>
      <td class="col-code">${highlight(p.code, currentQuery)}</td>
      <td class="col-name">${highlight(p.name, currentQuery)}</td>
      <td class="col-unit">${escapeHtml(p.unit)}</td>
      <td class="col-qty ${qtyClass}" data-qty-cell="${p.code}">${qty}</td>
      <td class="col-actions">
        <div class="qty-controls">
          <button class="qty-btn qty-minus" data-action="dec" data-code="${p.code}" aria-label="ลด 1 ${escapeHtml(p.name)}">−</button>
          <button class="qty-btn qty-plus" data-action="inc" data-code="${p.code}" aria-label="เพิ่ม 1 ${escapeHtml(p.name)}">+</button>
          <button class="qty-detail-btn" data-action="detail" data-code="${p.code}">แก้ไข</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  tableBody.innerHTML = rowsHtml;
}

/* ============================================
   Quantity mutation core
   ============================================ */
function applyDelta(product, delta, note) {
  const before = getQty(product.code);
  let after = before + delta;
  if (after < 0) after = 0; // never go negative

  qtyMap[product.code] = after;
  saveQtyMap();

  const entry = {
    code: product.code,
    name: product.name,
    unit: product.unit,
    delta: after - before,
    mode: (after - before) >= 0 ? 'in' : 'out',
    note: note || '',
    after,
    ts: Date.now()
  };
  history.push(entry);
  saveHistory();

  return after;
}

/* ============================================
   Row +/- button + detail button handling
   ============================================ */
tableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const code = btn.dataset.code;
  const product = PRODUCTS.find(p => p.code === code);
  if (!product) return;

  const action = btn.dataset.action;

  if (action === 'inc') {
    applyDelta(product, 1, '');
    updateQtyCell(product);
  } else if (action === 'dec') {
    const before = getQty(product.code);
    if (before <= 0) return;
    applyDelta(product, -1, '');
    updateQtyCell(product);
  } else if (action === 'detail') {
    openAdjustModal(product);
  }
});

function updateQtyCell(product) {
  const cell = document.querySelector(`[data-qty-cell="${CSS.escape(product.code)}"]`);
  if (!cell) return;
  const qty = getQty(product.code);
  cell.textContent = qty;
  cell.classList.remove('qty-zero', 'qty-low');
  if (qty === 0) cell.classList.add('qty-zero');
  else if (qty <= 5) cell.classList.add('qty-low');
}

/* ============================================
   Adjust modal
   ============================================ */
function openAdjustModal(product) {
  activeAdjustCode = product.code;
  adjustMode = 'in';
  modeInBtn.classList.add('active');
  modeOutBtn.classList.remove('active');

  adjustProductName.textContent = `${product.name} (${product.code})`;
  adjustCurrentQty.textContent = getQty(product.code);
  adjustUnit.textContent = product.unit;
  adjustAmount.value = '';
  adjustNote.value = '';

  renderHistoryFor(product.code);

  adjustOverlay.hidden = false;
  setTimeout(() => adjustAmount.focus(), 50);
}

function closeAdjustModal() {
  adjustOverlay.hidden = true;
  activeAdjustCode = null;
}

document.getElementById('adjustClose').addEventListener('click', closeAdjustModal);
document.getElementById('adjustCancel').addEventListener('click', closeAdjustModal);
adjustOverlay.addEventListener('click', (e) => {
  if (e.target === adjustOverlay) closeAdjustModal();
});

modeInBtn.addEventListener('click', () => {
  adjustMode = 'in';
  modeInBtn.classList.add('active');
  modeOutBtn.classList.remove('active');
});

modeOutBtn.addEventListener('click', () => {
  adjustMode = 'out';
  modeOutBtn.classList.add('active');
  modeInBtn.classList.remove('active');
});

document.getElementById('adjustConfirm').addEventListener('click', () => {
  if (!activeAdjustCode) return;
  const product = PRODUCTS.find(p => p.code === activeAdjustCode);
  if (!product) return;

  const amountRaw = adjustAmount.value.trim();
  const amount = parseInt(amountRaw, 10);
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    adjustAmount.focus();
    adjustAmount.style.borderColor = 'var(--stamp-red)';
    setTimeout(() => { adjustAmount.style.borderColor = ''; }, 900);
    return;
  }

  const delta = adjustMode === 'in' ? amount : -amount;
  const after = applyDelta(product, delta, adjustNote.value.trim());

  adjustCurrentQty.textContent = after;
  adjustAmount.value = '';
  adjustNote.value = '';
  renderHistoryFor(product.code);
  updateQtyCell(product);
});

/* ============================================
   History rendering (per-product, in modal)
   ============================================ */
function renderHistoryFor(code) {
  const entries = history.filter(h => h.code === code).slice().reverse().slice(0, 20);

  if (entries.length === 0) {
    historyList.innerHTML = '<p class="history-empty">ยังไม่มีประวัติ</p>';
    return;
  }

  historyList.innerHTML = entries.map(entryHtml).join('');
}

function entryHtml(h) {
  const sign = h.delta >= 0 ? '+' : '';
  return `
    <div class="history-entry ${h.mode}">
      <div class="history-entry-left">
        <span class="history-entry-note">${h.note ? escapeHtml(h.note) : (h.mode === 'in' ? 'ของเข้า' : 'ของออก')}</span>
        <span class="history-entry-time">${formatTime(h.ts)}</span>
      </div>
      <div class="history-entry-right">
        <span class="history-entry-delta">${sign}${h.delta}</span>
        <span class="history-entry-after">คงเหลือ ${h.after}</span>
      </div>
    </div>
  `;
}

/* ============================================
   All-history modal
   ============================================ */
function openAllHistory() {
  const entries = history.slice().reverse().slice(0, 200);

  if (entries.length === 0) {
    allHistoryList.innerHTML = '<p class="history-empty">ยังไม่มีประวัติ</p>';
  } else {
    allHistoryList.innerHTML = entries.map(h => `
      <div class="history-entry ${h.mode}">
        <div class="history-entry-left">
          <span class="history-entry-name">${escapeHtml(h.name)}</span>
          <span class="history-entry-note">${h.note ? escapeHtml(h.note) : (h.mode === 'in' ? 'ของเข้า' : 'ของออก')} · ${escapeHtml(h.code)}</span>
          <span class="history-entry-time">${formatTime(h.ts)}</span>
        </div>
        <div class="history-entry-right">
          <span class="history-entry-delta">${h.delta >= 0 ? '+' : ''}${h.delta}</span>
          <span class="history-entry-after">คงเหลือ ${h.after}</span>
        </div>
      </div>
    `).join('');
  }

  allHistoryOverlay.hidden = false;
}

historyAllBtn.addEventListener('click', openAllHistory);
document.getElementById('allHistoryClose').addEventListener('click', () => {
  allHistoryOverlay.hidden = true;
});
allHistoryOverlay.addEventListener('click', (e) => {
  if (e.target === allHistoryOverlay) allHistoryOverlay.hidden = true;
});

/* ============================================
   Sort header clicks
   ============================================ */
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (currentSort.explicit && currentSort.key === key) {
      currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort = { key, dir: 'asc', explicit: true };
    }

    document.querySelectorAll('th.sortable').forEach(t => {
      t.classList.remove('sort-asc', 'sort-desc');
    });
    th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');

    render();
  });
});

/* ============================================
   Search input
   ============================================ */
searchInput.addEventListener('input', () => {
  currentQuery = searchInput.value;
  clearBtn.hidden = currentQuery.length === 0;
  currentSort.explicit = false;
  document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));

  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter !== '' && c.dataset.filter === currentQuery);
  });

  render();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentQuery = '';
  clearBtn.hidden = true;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === ''));
  searchInput.focus();
  render();
});

/* ============================================
   Quick filter chips
   ============================================ */
quickFilters.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;

  const filter = btn.dataset.filter;
  searchInput.value = filter;
  currentQuery = filter;
  clearBtn.hidden = filter.length === 0;
  currentSort.explicit = false;
  document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));

  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');

  render();
});

/* ============================================
   Keyboard: Esc closes modals
   ============================================ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!adjustOverlay.hidden) closeAdjustModal();
    if (!allHistoryOverlay.hidden) allHistoryOverlay.hidden = true;
  }
});

/* ============================================
   Init
   ============================================ */
document.querySelector('.chip[data-filter=""]').classList.add('active');
render();
