/* ============================================
   State
   ============================================ */
let currentQuery = '';
let currentSort = { key: 'no', dir: 'asc' };
let qtyMap = {};          // { code: qty }  — populated from Firestore in realtime
let history = [];         // [{ code, name, unit, delta, mode, note, after, ts, userEmail }]
let activeAdjustCode = null;
let adjustMode = 'in';
let currentHistoryRange = 'today';
let currentUser = null;

let unsubStock = null;
let unsubHistory = null;
let stockLoaded = false;
let historyLoaded = false;

/* ============================================
   DOM refs
   ============================================ */
const authCheckScreen = document.getElementById('authCheckScreen');

const appRoot = document.getElementById('appRoot');
const userBadge = document.getElementById('userBadge');
const logoutBtn = document.getElementById('logoutBtn');
const syncBanner = document.getElementById('syncBanner');

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
const historySummary = document.getElementById('historySummary');
const historyAllBtn = document.getElementById('historyAllBtn');
const historyTabs = document.getElementById('historyTabs');

/* ============================================
   Auth flow — this page requires a logged-in user.
   If nobody is logged in, bounce to login.html.
   ============================================ */
onAuthChange((user) => {
  currentUser = user;

  if (user) {
    authCheckScreen.hidden = true;
    appRoot.hidden = false;
    userBadge.textContent = user.email;
    startListeners();
  } else {
    stopListeners();
    window.location.replace('login.html');
  }
});

logoutBtn.addEventListener('click', () => {
  fbLogout();
});

/* ============================================
   Firestore listeners
   ============================================ */
function startListeners() {
  stockLoaded = false;
  historyLoaded = false;
  updateSyncBanner();

  unsubStock = listenStock((map) => {
    qtyMap = map;
    stockLoaded = true;
    updateSyncBanner();
    render();
  }, (err) => console.error('อ่านข้อมูลจำนวนไม่สำเร็จ', err));

  unsubHistory = listenHistory((list) => {
    history = list;
    historyLoaded = true;
    updateSyncBanner();
    if (!adjustOverlay.hidden && activeAdjustCode) renderHistoryFor(activeAdjustCode);
    if (!allHistoryOverlay.hidden) renderAllHistory();
  }, (err) => console.error('อ่านประวัติไม่สำเร็จ', err));
}

function stopListeners() {
  if (unsubStock) { unsubStock(); unsubStock = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }
  qtyMap = {};
  history = [];
}

function updateSyncBanner() {
  syncBanner.hidden = stockLoaded && historyLoaded;
}

/* ============================================
   Qty helpers
   ============================================ */
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
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDateHeader(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('th-TH', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
}

function isSameDay(ts1, ts2) {
  const a = new Date(ts1);
  const b = new Date(ts2);
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
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
   Quantity mutation core (writes to Firestore, transactional)
   ============================================ */
async function applyDelta(product, delta, note) {
  const after = await fbAdjustQty(product.code, delta, {
    code: product.code,
    name: product.name,
    unit: product.unit,
    note: note || '',
    userEmail: currentUser ? currentUser.email : ''
  }, getQty(product.code));

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
    btn.disabled = true;
    applyDelta(product, 1, '')
      .catch(err => { console.error('บันทึกไม่สำเร็จ', err); alert('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); })
      .finally(() => { btn.disabled = false; });
  } else if (action === 'dec') {
    const before = getQty(product.code);
    if (before <= 0) return;
    btn.disabled = true;
    applyDelta(product, -1, '')
      .catch(err => { console.error('บันทึกไม่สำเร็จ', err); alert('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); })
      .finally(() => { btn.disabled = false; });
  } else if (action === 'detail') {
    openAdjustModal(product);
  }
});

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

  const confirmBtn = document.getElementById('adjustConfirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'กำลังบันทึก...';

  const delta = adjustMode === 'in' ? amount : -amount;
  const noteVal = adjustNote.value.trim();

  applyDelta(product, delta, noteVal)
    .then((after) => {
      adjustCurrentQty.textContent = after;
      adjustAmount.value = '';
      adjustNote.value = '';
    })
    .catch(err => {
      console.error('บันทึกไม่สำเร็จ', err);
      alert('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    })
    .finally(() => {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'บันทึก';
    });
});

/* ============================================
   History rendering (per-product, in adjust modal)
   ============================================ */
function renderHistoryFor(code) {
  const entries = history.filter(h => h.code === code).slice(0, 20);

  if (entries.length === 0) {
    historyList.innerHTML = '<p class="history-empty">ยังไม่มีประวัติ</p>';
    return;
  }

  historyList.innerHTML = entries.map(entryHtml).join('');
}

function entryHtml(h) {
  const sign = h.delta >= 0 ? '+' : '';
  const who = h.userEmail ? escapeHtml(h.userEmail.split('@')[0]) : '';
  return `
    <div class="history-entry ${h.mode}">
      <div class="history-entry-left">
        <span class="history-entry-note">${h.note ? escapeHtml(h.note) : (h.mode === 'in' ? 'ของเข้า' : 'ของออก')}</span>
        <span class="history-entry-time">${formatTime(h.ts)}${who ? ' · ' + who : ''}</span>
      </div>
      <div class="history-entry-right">
        <span class="history-entry-delta">${sign}${h.delta}</span>
        <span class="history-entry-after">คงเหลือ ${h.after}</span>
      </div>
    </div>
  `;
}

/* ============================================
   All-history modal (date-grouped, tabbed by range)
   ============================================ */
function getHistoryForRange(range) {
  const now = Date.now();
  if (range === 'today') {
    return history.filter(h => isSameDay(h.ts, now));
  }
  if (range === 'week') {
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return history.filter(h => h.ts >= weekAgo);
  }
  return history;
}

function renderAllHistory() {
  const entries = getHistoryForRange(currentHistoryRange);

  const inCount = entries.filter(h => h.mode === 'in').length;
  const outCount = entries.filter(h => h.mode === 'out').length;
  historySummary.textContent = entries.length
    ? `ของเข้า ${inCount} ครั้ง · ของออก ${outCount} ครั้ง · รวม ${entries.length} รายการ`
    : '';

  if (entries.length === 0) {
    allHistoryList.innerHTML = '<p class="history-empty">ไม่มีประวัติในช่วงนี้</p>';
    return;
  }

  // Group by date (entries already sorted desc by ts from Firestore query)
  const groups = [];
  let currentGroup = null;
  entries.forEach(h => {
    if (!currentGroup || !isSameDay(currentGroup.ts, h.ts)) {
      currentGroup = { ts: h.ts, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(h);
  });

  const today = Date.now();
  allHistoryList.innerHTML = groups.map(g => {
    const label = isSameDay(g.ts, today) ? `วันนี้ · ${formatDateHeader(g.ts)}` : formatDateHeader(g.ts);
    const itemsHtml = g.items.map(h => `
      <div class="history-entry ${h.mode}">
        <div class="history-entry-left">
          <span class="history-entry-name">${escapeHtml(h.name)}</span>
          <span class="history-entry-note">${h.note ? escapeHtml(h.note) : (h.mode === 'in' ? 'ของเข้า' : 'ของออก')} · ${escapeHtml(h.code)}</span>
          <span class="history-entry-time">${formatTime(h.ts)}${h.userEmail ? ' · ' + escapeHtml(h.userEmail.split('@')[0]) : ''}</span>
        </div>
        <div class="history-entry-right">
          <span class="history-entry-delta">${h.delta >= 0 ? '+' : ''}${h.delta}</span>
          <span class="history-entry-after">คงเหลือ ${h.after}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="history-date-group">
        <div class="history-date-header">${label}</div>
        ${itemsHtml}
      </div>
    `;
  }).join('');
}

function openAllHistory() {
  currentHistoryRange = 'today';
  document.querySelectorAll('.history-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.range === 'today');
  });
  renderAllHistory();
  allHistoryOverlay.hidden = false;
}

historyTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.history-tab');
  if (!btn) return;
  currentHistoryRange = btn.dataset.range;
  document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderAllHistory();
});

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
