/* ============================================
   State
   ============================================ */
let currentQuery = '';
let currentSort = { key: 'no', dir: 'asc' };
let qtyMap = {};          // { code: qty }  — populated from Firestore in realtime
let history = [];         // [{ code, name, unit, delta, mode, note, after, ts, userEmail }]
let dynamicProducts = []; // products added at runtime via the admin "add product" modal
let ALL_PRODUCTS = PRODUCTS.slice(); // static list from data.js + dynamicProducts, rebuilt on change
let activeAdjustCode = null;
let adjustMode = 'in';
let currentUser = null;

// Only this account is allowed to adjust quantities. Everyone else gets a
// read-only view — no +/- or "แก้ไข" buttons.
const EDITOR_EMAIL = 'ruok512345@gmail.com';
function isEditor() {
  return !!currentUser && currentUser.email === EDITOR_EMAIL;
}

// Extra PIN required (on top of being the editor account) to add a brand
// new product — change this to whatever code you want to give staff.
const ADD_PRODUCT_PIN = '112233';

let unsubStock = null;
let unsubHistory = null;
let unsubProducts = null;
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
const historyAllBtn = document.getElementById('historyAllBtn');
const calGrid = document.getElementById('calGrid');
const calMonthLabel = document.getElementById('calMonthLabel');
const calPrevBtn = document.getElementById('calPrevBtn');
const calNextBtn = document.getElementById('calNextBtn');
const calDayDetail = document.getElementById('calDayDetail');
const calToggleBtn = document.getElementById('calToggleBtn');
const calToggleLabel = document.getElementById('calToggleLabel');
const calToggleChevron = document.getElementById('calToggleChevron');
const calCollapse = document.getElementById('calCollapse');

const addProductBtn = document.getElementById('addProductBtn');
const addProductOverlay = document.getElementById('addProductOverlay');
const addProductStep1 = document.getElementById('addProductStep1');
const addProductStep2 = document.getElementById('addProductStep2');
const newProductCode = document.getElementById('newProductCode');
const newProductName = document.getElementById('newProductName');
const newProductUnit = document.getElementById('newProductUnit');
const newProductQty = document.getElementById('newProductQty');
const addProductStep1Error = document.getElementById('addProductStep1Error');
const pinBoxes = Array.from(document.querySelectorAll('.pin-box'));
const addProductError = document.getElementById('addProductError');
const addProductSuccess = document.getElementById('addProductSuccess');
const addProductNext = document.getElementById('addProductNext');
const addProductBack = document.getElementById('addProductBack');
const addProductConfirm = document.getElementById('addProductConfirm');

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
    addProductBtn.hidden = !isEditor();
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
    if (!allHistoryOverlay.hidden) { renderCalendar(); renderDayDetail(); }
  }, (err) => console.error('อ่านประวัติไม่สำเร็จ', err));

  unsubProducts = listenProducts((list) => {
    dynamicProducts = list;
    rebuildAllProducts();
    render();
  }, (err) => console.error('อ่านรายการสินค้าที่เพิ่มไม่สำเร็จ', err));
}

function stopListeners() {
  if (unsubStock) { unsubStock(); unsubStock = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }
  if (unsubProducts) { unsubProducts(); unsubProducts = null; }
  qtyMap = {};
  history = [];
  dynamicProducts = [];
  rebuildAllProducts();
}

// Merge the static catalog (data.js) with admin-added products, numbering
// the added ones after the last static "no" so they sort in at the end
// unless the person searches or sorts by name/code/qty.
function rebuildAllProducts() {
  const maxNo = PRODUCTS.reduce((m, p) => Math.max(m, p.no), 0);
  const extra = dynamicProducts.map((p, i) => ({
    no: maxNo + i + 1,
    code: p.code,
    name: p.name,
    unit: p.unit,
    qty: 0 // real qty always comes from qtyMap via getQty()
  }));
  ALL_PRODUCTS = PRODUCTS.concat(extra);
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
  const product = ALL_PRODUCTS.find(p => p.code === code);
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

function formatDayNumber(ts) {
  return new Date(ts).toLocaleDateString('th-TH', { day: '2-digit' });
}

function formatMonthShort(ts) {
  return new Date(ts).toLocaleDateString('th-TH', { month: 'short' });
}

function formatWeekday(ts) {
  return new Date(ts).toLocaleDateString('th-TH', { weekday: 'long' });
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
    results = ALL_PRODUCTS.map(p => ({ p, score: 0 }));
  } else {
    results = ALL_PRODUCTS
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
        ${isEditor() ? `
          <div class="qty-controls">
            <button class="qty-btn qty-minus" data-action="dec" data-code="${p.code}" aria-label="ลด 1 ${escapeHtml(p.name)}">−</button>
            <button class="qty-btn qty-plus" data-action="inc" data-code="${p.code}" aria-label="เพิ่ม 1 ${escapeHtml(p.name)}">+</button>
            <button class="qty-detail-btn" data-action="detail" data-code="${p.code}">แก้ไข</button>
          </div>
        ` : ''}
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
  if (!isEditor()) return; // read-only account — buttons shouldn't even exist, but block just in case

  const code = btn.dataset.code;
  const product = ALL_PRODUCTS.find(p => p.code === code);
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
  const product = ALL_PRODUCTS.find(p => p.code === activeAdjustCode);
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
   All-history modal — compact monthly calendar.
   Each day is one small cell with dot counts for
   เข้า/ออก; tapping a day shows its entries below
   instead of a long stacked list of cards.
   ============================================ */
let calViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedKey = null; // 'YYYY-MM-DD'

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function buildDayMap(entries) {
  const map = {};
  entries.forEach(h => {
    const key = dayKey(h.ts);
    if (!map[key]) map[key] = { in: 0, out: 0 };
    map[key][h.mode]++;
  });
  return map;
}

function renderCalendar() {
  const dayMap = buildDayMap(history);

  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  calMonthLabel.textContent = calViewDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  const startOffset = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(Date.now());

  let cellsHtml = '';
  for (let i = 0; i < startOffset; i++) {
    cellsHtml += '<div class="cal-cell cal-cell-empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dayKey(new Date(year, month, d).getTime());
    const data = dayMap[key];
    const classes = ['cal-cell'];
    if (key === todayKey) classes.push('cal-cell-today');
    if (key === calSelectedKey) classes.push('cal-cell-selected');
    if (data) classes.push('cal-cell-has-data');

    cellsHtml += `
      <button class="${classes.join(' ')}" data-key="${key}" ${data ? '' : 'disabled tabindex="-1"'}>
        <span class="cal-cell-num">${d}</span>
        ${data ? `
          <span class="cal-cell-dots">
            ${data.in ? `<span class="cal-dot cal-dot-in">${data.in}</span>` : ''}
            ${data.out ? `<span class="cal-dot cal-dot-out">${data.out}</span>` : ''}
          </span>
        ` : ''}
      </button>
    `;
  }

  calGrid.innerHTML = cellsHtml;

  calGrid.querySelectorAll('.cal-cell-has-data').forEach(cell => {
    cell.addEventListener('click', () => {
      calSelectedKey = cell.dataset.key;
      renderCalendar();
      renderDayDetail();
      setCalCollapsed(true); // fold the grid back up once a day is picked
    });
  });
}

function setCalCollapsed(collapsed) {
  calCollapse.hidden = collapsed;
  calToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  calToggleChevron.classList.toggle('cal-toggle-chevron-open', !collapsed);
}

function renderDayDetail() {
  if (!calSelectedKey) {
    calDayDetail.innerHTML = '<p class="history-empty">แตะวันที่เพื่อดูรายการ</p>';
    calToggleLabel.textContent = 'เลือกวันที่';
    return;
  }

  const entries = history
    .filter(h => dayKey(h.ts) === calSelectedKey)
    .sort((a, b) => b.ts - a.ts);

  const [y, m, d] = calSelectedKey.split('-').map(Number);
  const labelDate = new Date(y, m - 1, d);
  const todayKey = dayKey(Date.now());
  const yesterdayKey = dayKey(Date.now() - 24 * 60 * 60 * 1000);

  let dayTag = formatWeekday(labelDate.getTime());
  if (calSelectedKey === todayKey) dayTag = 'วันนี้';
  else if (calSelectedKey === yesterdayKey) dayTag = 'เมื่อวาน';

  calToggleLabel.textContent = `${dayTag} · ${formatDayNumber(labelDate.getTime())} ${formatMonthShort(labelDate.getTime())}`;

  if (entries.length === 0) {
    calDayDetail.innerHTML = '<p class="history-empty">ไม่มีประวัติในวันนี้</p>';
    return;
  }

  const dayIn = entries.filter(h => h.mode === 'in').length;
  const dayOut = entries.filter(h => h.mode === 'out').length;

  const itemsHtml = entries.map(h => `
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

  calDayDetail.innerHTML = `
    <div class="cal-day-detail-head">
      <span class="cal-day-detail-label">${dayTag} · ${formatDayNumber(labelDate.getTime())} ${formatMonthShort(labelDate.getTime())}</span>
      <span class="cal-day-detail-counts">เข้า ${dayIn} · ออก ${dayOut}</span>
    </div>
    <div class="cal-day-detail-list">${itemsHtml}</div>
  `;
}

function openAllHistory() {
  // Jump to the month/day of the most recent entry (list is sorted desc),
  // falling back to the current month if there's no history yet.
  if (history.length > 0) {
    const latestTs = history[0].ts;
    const d = new Date(latestTs);
    calViewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    calSelectedKey = dayKey(latestTs);
  } else {
    calViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    calSelectedKey = null;
  }
  renderCalendar();
  renderDayDetail();
  setCalCollapsed(true); // start folded — just show the day's list, not the grid
  allHistoryOverlay.hidden = false;
}

calPrevBtn.addEventListener('click', () => {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
  renderCalendar();
});
calNextBtn.addEventListener('click', () => {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
  renderCalendar();
});

calToggleBtn.addEventListener('click', () => {
  setCalCollapsed(!calCollapse.hidden);
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
    if (!addProductOverlay.hidden) closeAddProductModal();
  }
});

/* ============================================
   Init
   ============================================ */
document.querySelector('.chip[data-filter=""]').classList.add('active');
render();

/* ============================================
   Add-product modal (admin only) — step 1 collects
   the product details, step 2 asks for the special
   PIN as 6 individual digit boxes.
   ============================================ */
function openAddProductModal() {
  if (!isEditor()) return;
  newProductCode.value = '';
  newProductName.value = '';
  newProductUnit.value = '';
  newProductQty.value = '';
  addProductStep1Error.hidden = true;
  showAddProductStep(1);
  addProductOverlay.hidden = false;
  setTimeout(() => newProductCode.focus(), 50);
}

function closeAddProductModal() {
  addProductOverlay.hidden = true;
}

function showAddProductStep(step) {
  addProductStep1.hidden = step !== 1;
  addProductStep2.hidden = step !== 2;
}

function clearPinBoxes() {
  pinBoxes.forEach(box => {
    box.value = '';
    box.classList.remove('pin-box-filled', 'pin-box-error');
  });
}

function getPinValue() {
  return pinBoxes.map(b => b.value).join('');
}

addProductBtn.addEventListener('click', openAddProductModal);
document.getElementById('addProductClose').addEventListener('click', closeAddProductModal);
document.getElementById('addProductCancel').addEventListener('click', closeAddProductModal);
addProductOverlay.addEventListener('click', (e) => {
  if (e.target === addProductOverlay) closeAddProductModal();
});

/* ---- Step 1 -> Step 2 ---- */
addProductNext.addEventListener('click', () => {
  const code = newProductCode.value.trim();
  const name = newProductName.value.trim();
  const unit = newProductUnit.value.trim();
  const qtyRaw = newProductQty.value.trim();

  if (!code || !name || !unit) {
    addProductStep1Error.textContent = 'กรอกรหัสสินค้า ชื่อสินค้า และหน่วย ให้ครบก่อน';
    addProductStep1Error.hidden = false;
    return;
  }
  if (qtyRaw !== '' && (isNaN(parseInt(qtyRaw, 10)) || parseInt(qtyRaw, 10) < 0)) {
    addProductStep1Error.textContent = 'จำนวนเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ';
    addProductStep1Error.hidden = false;
    return;
  }
  if (ALL_PRODUCTS.some(p => p.code === code)) {
    addProductStep1Error.textContent = `รหัสสินค้า "${code}" มีอยู่แล้วในระบบ`;
    addProductStep1Error.hidden = false;
    return;
  }

  addProductStep1Error.hidden = true;
  addProductError.hidden = true;
  addProductSuccess.hidden = true;
  clearPinBoxes();
  showAddProductStep(2);
  setTimeout(() => pinBoxes[0].focus(), 50);
});

addProductBack.addEventListener('click', () => {
  addProductError.hidden = true;
  addProductSuccess.hidden = true;
  showAddProductStep(1);
  setTimeout(() => newProductCode.focus(), 50);
});

/* ---- Step 2: 6-box PIN entry ---- */
pinBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
    box.classList.toggle('pin-box-filled', box.value !== '');
    box.classList.remove('pin-box-error');
    if (box.value && i < pinBoxes.length - 1) {
      pinBoxes[i + 1].focus();
    }
    if (i === pinBoxes.length - 1 && getPinValue().length === pinBoxes.length) {
      addProductConfirm.click();
    }
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) {
      pinBoxes[i - 1].focus();
    }
  });

  box.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
    if (!text) return;
    e.preventDefault();
    text.split('').slice(0, pinBoxes.length).forEach((digit, idx) => {
      pinBoxes[idx].value = digit;
      pinBoxes[idx].classList.add('pin-box-filled');
    });
    const nextEmpty = pinBoxes.findIndex(b => !b.value);
    (nextEmpty === -1 ? pinBoxes[pinBoxes.length - 1] : pinBoxes[nextEmpty]).focus();
    if (getPinValue().length === pinBoxes.length) addProductConfirm.click();
  });
});

addProductConfirm.addEventListener('click', () => {
  if (!isEditor()) return;

  addProductError.hidden = true;
  addProductSuccess.hidden = true;

  const code = newProductCode.value.trim();
  const name = newProductName.value.trim();
  const unit = newProductUnit.value.trim();
  const qtyRaw = newProductQty.value.trim();
  const qty = qtyRaw === '' ? 0 : parseInt(qtyRaw, 10);
  const pin = getPinValue();

  if (pin.length !== pinBoxes.length) {
    addProductError.textContent = 'กรอก PIN ให้ครบ 6 หลัก';
    addProductError.hidden = false;
    return;
  }
  if (pin !== ADD_PRODUCT_PIN) {
    addProductError.textContent = 'รหัสพิเศษไม่ถูกต้อง';
    addProductError.hidden = false;
    pinBoxes.forEach(b => b.classList.add('pin-box-error'));
    clearPinBoxes();
    pinBoxes[0].focus();
    return;
  }
  if (ALL_PRODUCTS.some(p => p.code === code)) {
    addProductError.textContent = `รหัสสินค้า "${code}" มีอยู่แล้วในระบบ`;
    addProductError.hidden = false;
    showAddProductStep(1);
    return;
  }

  addProductConfirm.disabled = true;
  addProductConfirm.textContent = 'กำลังบันทึก...';

  fbAddProduct(code, name, unit, qty, currentUser ? currentUser.email : '')
    .then(() => {
      addProductSuccess.textContent = `เพิ่ม "${name}" เรียบร้อยแล้ว`;
      addProductSuccess.hidden = false;
      newProductCode.value = '';
      newProductName.value = '';
      newProductUnit.value = '';
      newProductQty.value = '';
      clearPinBoxes();
      showAddProductStep(1);
      setTimeout(() => newProductCode.focus(), 50);
    })
    .catch(err => {
      console.error('เพิ่มสินค้าไม่สำเร็จ', err);
      addProductError.textContent = (err && err.message === 'DUPLICATE_CODE')
        ? `รหัสสินค้า "${code}" มีอยู่แล้วในระบบ`
        : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
      addProductError.hidden = false;
    })
    .finally(() => {
      addProductConfirm.disabled = false;
      addProductConfirm.textContent = 'บันทึกสินค้าใหม่';
    });
});