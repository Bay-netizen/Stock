/* ============================================
   State
   ============================================ */
let currentQuery = '';
let currentSort = { key: 'no', dir: 'asc' };

const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const resultCount = document.getElementById('resultCount');
const emptyState = document.getElementById('emptyState');
const emptyQuery = document.getElementById('emptyQuery');
const tableScrollEl = document.querySelector('.table-scroll');
const quickFilters = document.getElementById('quickFilters');

/* ============================================
   Formatting helpers
   ============================================ */
function formatPrice(n) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Highlight the matched substring inside a field (case-insensitive)
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark>${match}</mark>${after}`;
}

/* ============================================
   Scoring: relevance rank for a query against a product
   Lower score = better match. Returns null if no match at all.
   ============================================ */
function scoreProduct(p, query) {
  if (!query) return 0;

  const q = query.trim().toLowerCase();
  const code = p.code.toLowerCase();
  const name = p.name.toLowerCase();
  const noStr = String(p.no);

  // Exact matches first
  if (code === q) return 0;
  if (noStr === q) return 1;

  // Starts-with matches
  if (code.startsWith(q)) return 10;
  if (name.startsWith(q)) return 12;

  // Contains matches
  const codeIdx = code.indexOf(q);
  if (codeIdx !== -1) return 20 + codeIdx;

  const nameIdx = name.indexOf(q);
  if (nameIdx !== -1) return 30 + nameIdx * 0.1;

  // Word-boundary match within name (split on spaces)
  const words = name.split(/\s+/);
  for (const w of words) {
    if (w.startsWith(q)) return 25;
  }

  // Numeric-only query: match against number found anywhere in code or name
  if (/^\d+$/.test(q)) {
    if (code.includes(q)) return 40 + codeIdx;
    // check numbers embedded in name (like model numbers VS195821)
    const nameDigits = name.replace(/[^\d]/g, ' ');
    if (nameDigits.includes(q)) return 45;
  }

  return null; // no match
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

  // If there's an active search query, default order is by relevance score
  // unless the user explicitly clicked a column header to sort.
  if (currentSort.explicit) {
    results.sort((a, b) => {
      const ka = a.p[currentSort.key];
      const kb = b.p[currentSort.key];
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
   Render
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

  const rowsHtml = items.map(p => `
    <tr>
      <td class="col-no">${p.no}</td>
      <td class="col-code">${highlight(p.code, currentQuery)}</td>
      <td class="col-name">${highlight(p.name, currentQuery)}</td>
      <td class="col-unit">${escapeHtml(p.unit)}</td>
      <td class="col-price">${formatPrice(p.price)}</td>
    </tr>
  `).join('');

  tableBody.innerHTML = rowsHtml;
}

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
  currentSort.explicit = false; // typing resets to relevance order
  document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));

  // Clear active chip state if the text no longer matches a chip
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
   Init
   ============================================ */
document.querySelector('.chip[data-filter=""]').classList.add('active');
render();
