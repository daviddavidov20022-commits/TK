// ==================== STATE ====================
const API_BASE = '';
let currentProduct = null;
let currentKit = null;
let calcMode = 'product'; // 'product' or 'kit'
let productsCache = [];
let kitsCache = [];
let selectedSenderCity = null;
let selectedReceiverCity = null;

// ==================== LOG SYSTEM ====================
const AppLog = {
  _count: 0, _errorCount: 0, _panelVisible: false,
  _getTime() { return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); },
  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
  _add(tag, cls, msg) {
    this._count++;
    const body = document.getElementById('log-body');
    if (!body) return;
    const e = document.createElement('div'); e.className = 'log-entry';
    e.innerHTML = `<span class="log-time">${this._getTime()}</span><span class="log-tag ${cls}">${tag}</span><span class="log-msg">${msg}</span>`;
    body.appendChild(e); body.scrollTop = body.scrollHeight;
    const c = document.getElementById('log-counter'); if (c) c.textContent = `${this._count} записей`;
  },
  _badge() {
    const b = document.getElementById('log-badge'); if (!b) return;
    if (this._errorCount > 0 && !this._panelVisible) { b.textContent = this._errorCount; b.classList.remove('hidden'); } else b.classList.add('hidden');
  },
  info(m) { this._add('INFO', 'log-tag-info', this._esc(m)); },
  ok(m) { this._add('OK', 'log-tag-ok', this._esc(m)); },
  warn(m) { this._add('WARN', 'log-tag-warn', this._esc(m)); },
  error(m, d = '') { this._errorCount++; this._add('ERR', 'log-tag-err', this._esc(m) + (d ? `<span class="log-detail">${this._esc(d)}</span>` : '')); this._badge(); },
  request(method, url, body = null) { let h = `<span class="log-status">${method}</span> <span class="log-url">${this._esc(url)}</span>`; if (body) { const j = typeof body === 'string' ? body : JSON.stringify(body, null, 2); h += `<span class="log-json">${this._esc(j.slice(0, 500))}</span>`; } this._add('REQ', 'log-tag-req', h); },
  response(status, url, data = null, ms = null) { const ok = status >= 200 && status < 400; let h = `<span class="log-status ${ok ? 'log-status-ok' : 'log-status-err'}">${status}</span> <span class="log-url">${this._esc(url)}</span>`; if (ms !== null) h += ` <span class="log-detail" style="display:inline">(${ms}ms)</span>`; if (data) { const j = typeof data === 'string' ? data : JSON.stringify(data, null, 2); h += `<span class="log-json">${this._esc(j.slice(0, 800))}</span>`; } if (!ok) { this._errorCount++; this._add('ERR', 'log-tag-err', h); this._badge(); } else this._add('RES', 'log-tag-res', h); },
  clear() { const b = document.getElementById('log-body'); if (b) b.innerHTML = ''; this._count = 0; this._errorCount = 0; const c = document.getElementById('log-counter'); if (c) c.textContent = '0 записей'; this._badge(); this.info('Лог очищен'); },
  setPanelVisible(v) { this._panelVisible = v; if (v) { this._errorCount = 0; this._badge(); } }
};

async function loggedFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  let body = null; if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
  AppLog.request(method, url, body);
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts); const ms = Math.round(performance.now() - t0);
    const cl = r.clone(); try { const d = await cl.json(); AppLog.response(r.status, url, d, ms); } catch { AppLog.response(r.status, url, null, ms); }
    return r;
  } catch (e) { AppLog.error(`Сетевая ошибка: ${method} ${url}`, e.message); throw e; }
}

// ==================== DOM READY ====================
document.addEventListener('DOMContentLoaded', () => {
  initTabs(); initCalculator(); initProducts(); initKits();
  initModal(); initKitModal(); initLog();
  initCityAutocomplete('calc-sender-city', 'sender-city-dropdown', (code, name, cityID) => {
    selectedSenderCity = { code, name, cityID }; document.getElementById('calc-sender-city').classList.add('city-selected');
  });
  initCityAutocomplete('calc-receiver-city', 'city-dropdown', (code, name, cityID) => {
    selectedReceiverCity = { code, name, cityID }; document.getElementById('calc-receiver-city').classList.add('city-selected');
    showToast(`Город: ${name}`, 'success');
  });
  initSenderCitySave();
  loadProducts(); loadKits(); loadSavedSenderCity();
});

// ==================== TABS ====================
function initTabs() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'none') return;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const tab = document.getElementById(`tab-${btn.dataset.tab}`);
      if (tab) tab.classList.add('active');
    });
  });
}

function initLog() {
  document.getElementById('log-collapse-btn').addEventListener('click', () => document.getElementById('log-panel').classList.toggle('collapsed'));
  document.getElementById('log-clear-btn').addEventListener('click', () => AppLog.clear());
  document.getElementById('nav-log-toggle').addEventListener('click', () => {
    const p = document.getElementById('log-panel'); const h = p.classList.toggle('hidden');
    document.getElementById('nav-log-toggle').classList.toggle('active', !h);
    AppLog.setPanelVisible(!h);
  });
  AppLog.info('Приложение загружено. Калькулятор ТК готов к работе.');
}

// ==================== CITY AUTOCOMPLETE ====================
function initCityAutocomplete(inputId, dropdownId, onSelect) {
  const inp = document.getElementById(inputId), dd = document.getElementById(dropdownId);
  if (!inp || !dd) return;
  let debounce = null, reqId = 0;

  inp.addEventListener('input', () => {
    const q = inp.value.trim(); inp.classList.remove('city-selected');
    if (q.length < 2) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const rid = ++reqId;
      try {
        const r = await fetch(`${API_BASE}/api/dellin/cities?q=${encodeURIComponent(q)}`);
        const cities = await r.json();
        if (rid !== reqId) return;
        if (cities.length === 0) { dd.innerHTML = '<div class="dropdown-empty">Город не найден</div>'; dd.classList.remove('hidden'); return; }
        dd.innerHTML = cities.slice(0, 10).map(c =>
          `<div class="dropdown-item" data-code="${esc(c.code)}" data-name="${esc(c.name)}" data-cityid="${c.cityID}">
            <span class="dropdown-city-name">${esc(c.name)}</span>
            <span class="dropdown-city-region">${c.region ? ` (${esc(c.region)})` : ''}</span>
            ${c.isTerminal ? '<span class="dropdown-badge">🏭</span>' : ''}
          </div>`
        ).join('');
        dd.classList.remove('hidden');
        dd.querySelectorAll('.dropdown-item').forEach(i => {
          i.addEventListener('click', () => { inp.value = i.dataset.name; dd.classList.add('hidden'); onSelect(i.dataset.code, i.dataset.name, i.dataset.cityid); });
        });
      } catch (e) { console.error(e); }
    }, 300);
  });

  document.addEventListener('click', e => { if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${dropdownId}`)) dd.classList.add('hidden'); });
  inp.addEventListener('keydown', e => {
    const items = dd.querySelectorAll('.dropdown-item'), active = dd.querySelector('.dropdown-item.active');
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!active) items[0]?.classList.add('active'); else { active.classList.remove('active'); (active.nextElementSibling || items[0])?.classList.add('active'); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (active) { active.classList.remove('active'); (active.previousElementSibling || items[items.length - 1])?.classList.add('active'); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (active) { inp.value = active.dataset.name; dd.classList.add('hidden'); onSelect(active.dataset.code, active.dataset.name, active.dataset.cityid); } }
    else if (e.key === 'Escape') dd.classList.add('hidden');
  });
}

// ==================== SENDER CITY SAVE/LOAD ====================
function initSenderCitySave() {
  document.getElementById('save-sender-btn')?.addEventListener('click', async () => {
    if (!selectedSenderCity) { showToast('Сначала выберите город', 'error'); return; }
    try {
      await loggedFetch(`${API_BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senderCity: selectedSenderCity }) });
      localStorage.setItem('senderCity', JSON.stringify(selectedSenderCity));
      document.getElementById('sender-saved-hint').textContent = '✅ сохранено';
      showToast(`Склад «${selectedSenderCity.name}» сохранён!`, 'success');
    } catch (e) { showToast('Ошибка сохранения', 'error'); }
  });
}

async function loadSavedSenderCity() {
  try {
    const r = await fetch(`${API_BASE}/api/settings`); const s = await r.json();
    if (s.senderCity?.code) {
      selectedSenderCity = s.senderCity;
      document.getElementById('calc-sender-city').value = s.senderCity.name;
      document.getElementById('calc-sender-city').classList.add('city-selected');
      document.getElementById('sender-saved-hint').textContent = '✅ сохранено';
      return;
    }
  } catch (e) {}
  try { const saved = localStorage.getItem('senderCity'); if (saved) { selectedSenderCity = JSON.parse(saved); document.getElementById('calc-sender-city').value = selectedSenderCity.name; document.getElementById('calc-sender-city').classList.add('city-selected'); } } catch (e) {}
}

// ==================== IMAGE UPLOAD HELPER ====================
function initImageUpload(areaId, fileInputId, urlInputId, previewContainerId, previewImgId, removeBtnId, placeholderId) {
  const area = document.getElementById(areaId), fileInput = document.getElementById(fileInputId);
  const urlInput = document.getElementById(urlInputId), previewContainer = document.getElementById(previewContainerId);
  const previewImg = document.getElementById(previewImgId), removeBtn = document.getElementById(removeBtnId);
  const placeholder = document.getElementById(placeholderId);
  if (!area) return;

  area.addEventListener('click', e => { if (e.target.closest('.image-remove-btn')) return; fileInput.click(); });
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); if (e.dataTransfer.files.length) uploadImageFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadImageFile(fileInput.files[0]); });
  removeBtn.addEventListener('click', e => { e.stopPropagation(); urlInput.value = ''; previewContainer.classList.add('hidden'); placeholder.classList.remove('hidden'); previewImg.src = ''; });

  async function uploadImageFile(file) {
    if (file.size > 5 * 1024 * 1024) { showToast('Файл слишком большой (макс. 5 МБ)', 'error'); return; }
    const fd = new FormData(); fd.append('image', file);
    try {
      const r = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
      const d = await r.json();
      if (d.url) { urlInput.value = d.url; previewImg.src = d.url; previewContainer.classList.remove('hidden'); placeholder.classList.add('hidden'); showToast('Фото загружено!', 'success'); }
      else showToast(d.error || 'Ошибка загрузки', 'error');
    } catch (e) { showToast('Ошибка загрузки фото', 'error'); }
  }
}

// ==================== PRODUCTS ====================
async function loadProducts() {
  try { const r = await loggedFetch(`${API_BASE}/api/products`); productsCache = await r.json(); renderProductsList(); } catch (e) { showToast('Ошибка загрузки товаров', 'error'); }
}

function renderProductsList(filter = '') {
  const list = document.getElementById('products-list'), empty = document.getElementById('products-empty');
  let items = productsCache;
  if (filter) { const q = filter.toLowerCase(); items = items.filter(p => p.article.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)); }
  if (items.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = items.map((p, i) => `
    <div class="product-card" style="animation-delay: ${i * 0.03}s">
      <div class="product-card-img">${p.image ? `<img src="${p.image}" alt="${esc(p.name)}">` : '<div class="no-img">📦</div>'}</div>
      <div class="product-info">
        <div class="product-article">${esc(p.article)}</div>
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-dims">📐 ${p.length}×${p.width}×${p.height} м &nbsp; ⚖️ ${p.weight} кг &nbsp; 📦 ${p.volume.toFixed(4)} м³</div>
      </div>
      ${p.category ? `<div class="product-category">${esc(p.category)}</div>` : ''}
      <div class="product-actions">
        <button class="btn btn-accent btn-sm" onclick="editProduct('${esc(p.article)}')" title="Редактировать">✏️</button>
        <button class="btn btn-ghost btn-sm" onclick="useInCalc('${esc(p.article)}')" title="Рассчитать">📋</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${esc(p.article)}')" title="Удалить">✕</button>
      </div>
    </div>
  `).join('');
}

function initProducts() {
  document.getElementById('product-search')?.addEventListener('input', e => renderProductsList(e.target.value.trim()));
  document.getElementById('add-product-btn')?.addEventListener('click', () => openProductModal());
  document.getElementById('add-first-product-btn')?.addEventListener('click', () => openProductModal());
}

function editProduct(article) { const p = productsCache.find(x => x.article === article); if (p) openProductModal(p); }
function useInCalc(article) { document.querySelector('[data-tab="calculator"]').click(); setCalcMode('product'); document.getElementById('calc-article').value = article; findProductForCalc(); }

async function deleteProduct(article) {
  if (!confirm(`Удалить товар ${article}?`)) return;
  try { await loggedFetch(`${API_BASE}/api/products/${encodeURIComponent(article)}`, { method: 'DELETE' }); showToast('Товар удалён', 'success'); await loadProducts(); } catch (e) { showToast('Ошибка удаления', 'error'); }
}

// ==================== PRODUCT MODAL ====================
function initModal() {
  initImageUpload('image-upload-area', 'form-image-file', 'form-image-url', 'image-preview-container', 'image-preview', 'image-remove-btn', 'image-placeholder');
  document.getElementById('modal-close-btn').addEventListener('click', closeProductModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeProductModal);
  document.getElementById('product-modal-overlay').addEventListener('click', e => { if (e.target.id === 'product-modal-overlay') closeProductModal(); });
  ['form-length', 'form-width', 'form-height'].forEach(id => document.getElementById(id).addEventListener('input', updateVolumePreview));

  document.getElementById('product-form').addEventListener('submit', async e => {
    e.preventDefault();
    const editing = document.getElementById('form-editing-article').value;
    const data = {
      article: document.getElementById('form-article').value.trim(), name: document.getElementById('form-name').value.trim(),
      length: parseFloat(document.getElementById('form-length').value), width: parseFloat(document.getElementById('form-width').value),
      height: parseFloat(document.getElementById('form-height').value), weight: parseFloat(document.getElementById('form-weight').value),
      quantity: parseInt(document.getElementById('form-quantity').value) || 1, category: document.getElementById('form-category').value.trim(),
      notes: document.getElementById('form-notes').value.trim(), image: document.getElementById('form-image-url').value
    };
    try {
      const url = editing ? `${API_BASE}/api/products/${encodeURIComponent(editing)}` : `${API_BASE}/api/products`;
      const r = await loggedFetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await r.json();
      if (!r.ok) { showToast(result.error || 'Ошибка', 'error'); return; }
      showToast(editing ? 'Товар обновлён' : 'Товар добавлен', 'success');
      closeProductModal(); await loadProducts();
    } catch (e) { showToast('Ошибка сохранения', 'error'); }
  });
}

function openProductModal(product = null) {
  const overlay = document.getElementById('product-modal-overlay');
  document.getElementById('modal-title').textContent = product ? 'Редактировать товар' : 'Добавить товар';
  const artInput = document.getElementById('form-article');
  if (product) {
    document.getElementById('form-editing-article').value = product.article;
    artInput.value = product.article; artInput.disabled = true;
    document.getElementById('form-name').value = product.name;
    document.getElementById('form-length').value = product.length;
    document.getElementById('form-width').value = product.width;
    document.getElementById('form-height').value = product.height;
    document.getElementById('form-weight').value = product.weight;
    document.getElementById('form-quantity').value = product.quantity || 1;
    document.getElementById('form-category').value = product.category || '';
    document.getElementById('form-notes').value = product.notes || '';
    document.getElementById('form-image-url').value = product.image || '';
    if (product.image) {
      document.getElementById('image-preview').src = product.image;
      document.getElementById('image-preview-container').classList.remove('hidden');
      document.getElementById('image-placeholder').classList.add('hidden');
    } else {
      document.getElementById('image-preview-container').classList.add('hidden');
      document.getElementById('image-placeholder').classList.remove('hidden');
    }
  } else {
    document.getElementById('form-editing-article').value = '';
    document.getElementById('product-form').reset(); artInput.disabled = false;
    document.getElementById('form-quantity').value = 1;
    document.getElementById('form-image-url').value = '';
    document.getElementById('image-preview-container').classList.add('hidden');
    document.getElementById('image-placeholder').classList.remove('hidden');
  }
  updateVolumePreview(); overlay.classList.remove('hidden');
}

function closeProductModal() { document.getElementById('product-modal-overlay').classList.add('hidden'); }

function updateVolumePreview() {
  const l = parseFloat(document.getElementById('form-length').value) || 0;
  const w = parseFloat(document.getElementById('form-width').value) || 0;
  const h = parseFloat(document.getElementById('form-height').value) || 0;
  document.getElementById('volume-display').textContent = (l * w * h) > 0 ? `${(l * w * h).toFixed(4)} м³` : '— м³';
}

// ==================== KITS ====================
async function loadKits() {
  try { const r = await loggedFetch(`${API_BASE}/api/kits`); kitsCache = await r.json(); renderKitsList(); updateKitSelect(); } catch (e) { console.error('Kits load error:', e); }
}

function renderKitsList(filter = '') {
  const list = document.getElementById('kits-list'), empty = document.getElementById('kits-empty');
  let items = kitsCache;
  if (filter) { const q = filter.toLowerCase(); items = items.filter(k => k.article.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)); }
  if (items.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = items.map((k, i) => `
    <div class="product-card kit-card" style="animation-delay: ${i * 0.03}s">
      <div class="product-card-img">${k.image ? `<img src="${k.image}" alt="${esc(k.name)}">` : '<div class="no-img">📋</div>'}</div>
      <div class="product-info">
        <div class="product-article">${esc(k.article)}</div>
        <div class="product-name">${esc(k.name)}</div>
        <div class="product-dims">📦 ${k.totalPlaces} мест &nbsp; ⚖️ ${k.totalWeight} кг &nbsp; 📐 ${k.totalVolume.toFixed(4)} м³ &nbsp; 🔢 ${k.items.length} товар(ов)</div>
      </div>
      <div class="product-actions">
        <button class="btn btn-accent btn-sm" onclick="editKit('${esc(k.id)}')" title="Редактировать">✏️</button>
        <button class="btn btn-ghost btn-sm" onclick="useKitInCalc('${esc(k.id)}')" title="Рассчитать">📋</button>
        <button class="btn btn-danger btn-sm" onclick="deleteKit('${esc(k.id)}')" title="Удалить">✕</button>
      </div>
    </div>
  `).join('');
}

function initKits() {
  document.getElementById('kit-search')?.addEventListener('input', e => renderKitsList(e.target.value.trim()));
  document.getElementById('add-kit-btn')?.addEventListener('click', () => openKitModal());
  document.getElementById('add-first-kit-btn')?.addEventListener('click', () => openKitModal());
}

function editKit(id) { const k = kitsCache.find(x => x.id === id); if (k) openKitModal(k); }
function useKitInCalc(id) { document.querySelector('[data-tab="calculator"]').click(); setCalcMode('kit'); document.getElementById('calc-kit-select').value = id; onKitSelected(id); }

async function deleteKit(id) {
  if (!confirm('Удалить комплект?')) return;
  try { await loggedFetch(`${API_BASE}/api/kits/${id}`, { method: 'DELETE' }); showToast('Комплект удалён', 'success'); await loadKits(); } catch (e) { showToast('Ошибка удаления', 'error'); }
}

function updateKitSelect() {
  const sel = document.getElementById('calc-kit-select');
  sel.innerHTML = '<option value="">— Выберите комплект —</option>' + kitsCache.map(k => `<option value="${k.id}">${esc(k.article)} — ${esc(k.name)} (${k.totalPlaces} мест, ${k.totalWeight} кг)</option>`).join('');
}

async function onKitSelected(id) {
  if (!id) { document.getElementById('kit-preview').classList.add('hidden'); currentKit = null; return; }
  try {
    const r = await loggedFetch(`${API_BASE}/api/kits/${id}`); const kit = await r.json();
    currentKit = kit;
    document.getElementById('kit-preview-name').textContent = kit.name;
    const img = document.getElementById('kit-preview-img');
    if (kit.image) { img.src = kit.image; img.classList.remove('hidden'); } else img.classList.add('hidden');
    document.getElementById('kit-preview-totals').textContent = `📦 ${kit.totalPlaces} мест • ⚖️ ${kit.totalWeight} кг • 📐 ${kit.totalVolume.toFixed(4)} м³`;
    document.getElementById('kit-items-list').innerHTML = kit.items.map(item => {
      const p = item.product;
      if (!p) return `<div class="kit-item-row"><span>❓ ${esc(item.article)} — не найден</span></div>`;
      return `<div class="kit-item-row">
        <div class="kit-item-img">${p.image ? `<img src="${p.image}" alt="">` : '📦'}</div>
        <div class="kit-item-info">
          <strong>${esc(p.name)}</strong>
          <span>${p.length}×${p.width}×${p.height} м, ${p.weight} кг</span>
        </div>
        <div class="kit-item-qty">×${item.quantity}</div>
      </div>`;
    }).join('');
    document.getElementById('kit-preview').classList.remove('hidden');
    document.getElementById('calc-quantity').value = 1;
  } catch (e) { showToast('Ошибка загрузки комплекта', 'error'); }
}

// ==================== KIT MODAL ====================
function initKitModal() {
  initImageUpload('kit-image-upload-area', 'kit-form-image-file', 'kit-form-image-url', 'kit-image-preview-container', 'kit-image-preview', 'kit-image-remove-btn', 'kit-image-placeholder');
  document.getElementById('kit-modal-close-btn').addEventListener('click', closeKitModal);
  document.getElementById('kit-modal-cancel-btn').addEventListener('click', closeKitModal);
  document.getElementById('kit-modal-overlay').addEventListener('click', e => { if (e.target.id === 'kit-modal-overlay') closeKitModal(); });
  document.getElementById('kit-add-item-btn').addEventListener('click', () => addKitItemRow());

  document.getElementById('kit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const editing = document.getElementById('kit-form-editing-id').value;
    const items = getKitItemsFromEditor();
    if (items.length === 0) { showToast('Добавьте хотя бы один товар', 'error'); return; }
    const data = {
      article: document.getElementById('kit-form-article').value.trim(), name: document.getElementById('kit-form-name').value.trim(),
      image: document.getElementById('kit-form-image-url').value, items
    };
    try {
      const url = editing ? `${API_BASE}/api/kits/${editing}` : `${API_BASE}/api/kits`;
      const r = await loggedFetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await r.json();
      if (!r.ok) { showToast(result.error || 'Ошибка', 'error'); return; }
      showToast(editing ? 'Комплект обновлён' : 'Комплект создан', 'success');
      closeKitModal(); await loadKits();
    } catch (e) { showToast('Ошибка сохранения', 'error'); }
  });
}

function openKitModal(kit = null) {
  document.getElementById('kit-modal-title').textContent = kit ? 'Редактировать комплект' : 'Создать комплект';
  const artInput = document.getElementById('kit-form-article');
  if (kit) {
    document.getElementById('kit-form-editing-id').value = kit.id;
    artInput.value = kit.article; artInput.disabled = true;
    document.getElementById('kit-form-name').value = kit.name;
    document.getElementById('kit-form-image-url').value = kit.image || '';
    if (kit.image) { document.getElementById('kit-image-preview').src = kit.image; document.getElementById('kit-image-preview-container').classList.remove('hidden'); document.getElementById('kit-image-placeholder').classList.add('hidden'); }
    else { document.getElementById('kit-image-preview-container').classList.add('hidden'); document.getElementById('kit-image-placeholder').classList.remove('hidden'); }
    const editor = document.getElementById('kit-items-editor'); editor.innerHTML = '';
    kit.items.forEach(item => addKitItemRow(item.article, item.quantity));
  } else {
    document.getElementById('kit-form-editing-id').value = '';
    document.getElementById('kit-form').reset(); artInput.disabled = false;
    document.getElementById('kit-form-image-url').value = '';
    document.getElementById('kit-image-preview-container').classList.add('hidden');
    document.getElementById('kit-image-placeholder').classList.remove('hidden');
    document.getElementById('kit-items-editor').innerHTML = '';
    addKitItemRow();
  }
  updateKitTotals();
  document.getElementById('kit-modal-overlay').classList.remove('hidden');
}

function closeKitModal() { document.getElementById('kit-modal-overlay').classList.add('hidden'); }

function addKitItemRow(article = '', quantity = 1) {
  const editor = document.getElementById('kit-items-editor');
  const row = document.createElement('div'); row.className = 'kit-editor-row';
  row.innerHTML = `
    <select class="kit-product-select">
      <option value="">— Выберите товар —</option>
      ${productsCache.map(p => `<option value="${esc(p.article)}" ${p.article === article ? 'selected' : ''}>${esc(p.article)} — ${esc(p.name)} (${p.weight} кг)</option>`).join('')}
    </select>
    <input type="number" class="kit-qty-input" value="${quantity}" min="1" max="99" title="Количество">
    <button type="button" class="btn btn-danger btn-sm kit-remove-btn">✕</button>
  `;
  editor.appendChild(row);
  row.querySelector('.kit-remove-btn').addEventListener('click', () => { row.remove(); updateKitTotals(); });
  row.querySelector('.kit-product-select').addEventListener('change', updateKitTotals);
  row.querySelector('.kit-qty-input').addEventListener('input', updateKitTotals);
}

function getKitItemsFromEditor() {
  return [...document.querySelectorAll('.kit-editor-row')].map(row => {
    const article = row.querySelector('.kit-product-select').value;
    const quantity = parseInt(row.querySelector('.kit-qty-input').value) || 1;
    return article ? { article, quantity } : null;
  }).filter(Boolean);
}

function updateKitTotals() {
  const items = getKitItemsFromEditor();
  let totalW = 0, totalV = 0, totalP = 0;
  items.forEach(item => {
    const p = productsCache.find(x => x.article === item.article);
    if (p) { totalW += p.weight * item.quantity; totalV += p.volume * item.quantity; totalP += item.quantity; }
  });
  document.getElementById('kit-total-places').textContent = totalP;
  document.getElementById('kit-total-weight').textContent = `${totalW.toFixed(1)} кг`;
  document.getElementById('kit-total-volume').textContent = `${totalV.toFixed(4)} м³`;
}

// ==================== CALCULATOR ====================
function initCalculator() {
  document.getElementById('calc-find-btn').addEventListener('click', findProductForCalc);
  document.getElementById('calc-article').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findProductForCalc(); } });
  document.getElementById('calc-submit-btn').addEventListener('click', doCalculation);
  document.getElementById('calc-kit-select').addEventListener('change', e => onKitSelected(e.target.value));
  document.querySelectorAll('input[name="carrier"]').forEach(input => {
    input.addEventListener('change', () => {
      document.querySelectorAll('.carrier-option').forEach(opt => opt.classList.toggle('active', opt.querySelector('input').checked));
    });
  });
  // Source toggle
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.addEventListener('click', () => setCalcMode(btn.dataset.source));
  });
}

function setCalcMode(mode) {
  calcMode = mode;
  document.querySelectorAll('.source-btn').forEach(b => b.classList.toggle('active', b.dataset.source === mode));
  document.getElementById('product-source').classList.toggle('hidden', mode !== 'product');
  document.getElementById('kit-source').classList.toggle('hidden', mode !== 'kit');
}

function findProductForCalc() {
  const article = document.getElementById('calc-article').value.trim();
  if (!article) { showToast('Введите артикул', 'info'); return; }
  const product = productsCache.find(p => p.article.toLowerCase() === article.toLowerCase());
  const preview = document.getElementById('product-preview');
  if (product) {
    currentProduct = product;
    document.getElementById('preview-name').textContent = product.name;
    document.getElementById('preview-dims').textContent = `${product.length}×${product.width}×${product.height} м`;
    document.getElementById('preview-weight').textContent = `${product.weight} кг`;
    document.getElementById('preview-volume').textContent = `${product.volume.toFixed(4)} м³`;
    const img = document.getElementById('preview-img');
    if (product.image) { img.src = product.image; img.classList.remove('hidden'); } else img.classList.add('hidden');
    document.getElementById('calc-quantity').value = product.quantity || 1;
    preview.classList.remove('hidden');
    showToast(`Товар: ${product.name}`, 'success');
  } else {
    currentProduct = null; preview.classList.add('hidden');
    showToast(`Товар «${article}» не найден`, 'error');
  }
}

async function doCalculation() {
  // Validate
  if (calcMode === 'product' && !currentProduct) { showToast('Найдите товар по артикулу', 'error'); return; }
  if (calcMode === 'kit' && !currentKit) { showToast('Выберите комплект', 'error'); return; }
  if (!selectedReceiverCity) { showToast('Выберите город получения', 'error'); document.getElementById('calc-receiver-city').focus(); return; }
  if (!selectedSenderCity) { showToast('Выберите город отправления', 'error'); document.getElementById('calc-sender-city').focus(); return; }

  const receiverAddress = document.getElementById('calc-receiver-address').value.trim();
  const carrier = document.querySelector('input[name="carrier"]:checked').value;
  const qtyMultiplier = parseInt(document.getElementById('calc-quantity').value) || 1;

  // Build cargo
  let cargo;
  if (calcMode === 'product') {
    cargo = {
      length: currentProduct.length, width: currentProduct.width, height: currentProduct.height,
      weight: currentProduct.weight, volume: currentProduct.volume, quantity: qtyMultiplier
    };
  } else {
    // Kit: use the largest dimensions among items, sum weight & volume
    let maxL = 0, maxW = 0, maxH = 0;
    currentKit.items.forEach(item => {
      if (item.product) {
        if (item.product.length > maxL) maxL = item.product.length;
        if (item.product.width > maxW) maxW = item.product.width;
        if (item.product.height > maxH) maxH = item.product.height;
      }
    });
    cargo = {
      length: maxL, width: maxW, height: maxH,
      weight: currentKit.totalWeight, volume: currentKit.totalVolume,
      quantity: currentKit.totalPlaces * qtyMultiplier
    };
  }

  // UI
  document.getElementById('results-empty').classList.add('hidden');
  document.getElementById('results-data').classList.add('hidden');
  document.getElementById('results-loading').classList.remove('hidden');
  document.getElementById('calc-submit-btn').disabled = true;
  AppLog.info(`Расчёт: ${selectedSenderCity.name} → ${selectedReceiverCity.name}`);

  const allResults = [];
  try {
    if (carrier === 'all' || carrier === 'dellin') {
      try {
        const r = await loggedFetch(`${API_BASE}/api/calculate/dellin`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderCityCode: selectedSenderCity.code, senderCityID: selectedSenderCity.cityID, receiverCityCode: selectedReceiverCity.code, receiverCityID: selectedReceiverCity.cityID, receiverAddress, cargo })
        });
        const d = await r.json(); allResults.push(d.error ? { carrier: 'dellin', carrierName: 'Деловые Линии', error: d.error, results: [] } : d);
      } catch (e) { allResults.push({ carrier: 'dellin', carrierName: 'Деловые Линии', error: e.message, results: [] }); }
    }
    if (carrier === 'all' || carrier === 'pek') {
      try {
        const r = await loggedFetch(`${API_BASE}/api/calculate/pek`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderCity: selectedSenderCity.name.split(',')[0].trim(), receiverCity: selectedReceiverCity.name.split(',')[0].trim(), cargo })
        });
        const d = await r.json(); allResults.push(d.error ? { carrier: 'pek', carrierName: 'ПЭК', error: d.error, results: [] } : d);
      } catch (e) { allResults.push({ carrier: 'pek', carrierName: 'ПЭК', error: e.message, results: [] }); }
    }
    renderResults(allResults);
  } finally {
    document.getElementById('results-loading').classList.add('hidden');
    document.getElementById('calc-submit-btn').disabled = false;
  }
}

function renderResults(allResults) {
  const container = document.getElementById('results-data');
  let cheapest = Infinity;
  allResults.forEach(cr => { if (cr.results) cr.results.forEach(r => { const p = parseFloat(r.price); if (!isNaN(p) && p > 0 && p < cheapest) cheapest = p; }); });

  let html = '';

  // Show kit breakdown if in kit mode
  if (calcMode === 'kit' && currentKit) {
    html += `<div class="kit-breakdown"><h3>📋 Состав комплекта «${esc(currentKit.name)}»</h3><div class="kit-breakdown-items">`;
    currentKit.items.forEach(item => {
      const p = item.product;
      if (!p) return;
      html += `<div class="kit-breakdown-item">
        <div class="kit-breakdown-img">${p.image ? `<img src="${p.image}">` : '📦'}</div>
        <div class="kit-breakdown-info"><strong>${esc(p.name)}</strong><span>${p.length}×${p.width}×${p.height} м, ${p.weight} кг</span></div>
        <div class="kit-breakdown-qty">×${item.quantity}</div>
      </div>`;
    });
    html += `</div><div class="kit-breakdown-totals">Итого: <strong>${currentKit.totalPlaces} мест</strong> • <strong>${currentKit.totalWeight} кг</strong> • <strong>${currentKit.totalVolume.toFixed(4)} м³</strong></div></div>`;
  }

  allResults.forEach(cr => {
    const isDL = cr.carrier === 'dellin';
    html += `<div class="carrier-results"><div class="carrier-header ${isDL ? 'dellin' : 'pek'}"><span class="carrier-logo">${isDL ? '🚛' : '📦'}</span>${cr.carrierName}</div>`;
    if (cr.error) html += `<div class="api-warning">⚠️ ${esc(cr.error)}</div>`;
    else if (!cr.results?.length) html += `<div class="api-warning">ℹ️ Нет вариантов</div>`;
    else {
      cr.results.forEach(r => {
        if (r.error) {
          html += `<div class="result-row"><div class="result-variant">${esc(r.variant)}</div><div></div><div class="result-price error">${esc(r.error)}</div></div>`;
        } else {
          const price = parseFloat(r.price), isCheap = price === cheapest && price > 0;
          html += `<div class="result-row ${isCheap ? 'result-cheapest' : ''}">
            <div class="result-variant"><span class="variant-icons">${r.derivalType === 'address' ? '🏠' : '🏭'}→${r.arrivalType === 'address' ? '🏠' : '🏭'}</span> ${esc(r.variant)}</div>
            <div class="result-days">${r.deliveryDays ? r.deliveryDays + ' дн.' : ''}</div>
            <div class="result-price">${price > 0 ? formatPrice(price) : '—'}</div>
          </div>`;
        }
      });
    }
    html += `</div>`;
  });
  container.innerHTML = html; container.classList.remove('hidden');
}

// ==================== UTILITIES ====================
function formatPrice(p) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(p); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container'), t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${{ success: '✅', error: '❌', info: 'ℹ️' }[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
  c.appendChild(t); setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 3500);
}
