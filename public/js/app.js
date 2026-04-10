// ==================== STATE ====================
const API_BASE = '';
let currentProduct = null;
let productsCache = [];
let selectedReceiverCity = null; // { code, name, searchString }

// ==================== LOG SYSTEM ====================
const AppLog = {
  _count: 0,
  _errorCount: 0,
  _panelVisible: false,

  _getTime() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _addEntry(tag, tagClass, message) {
    this._count++;
    const body = document.getElementById('log-body');
    if (!body) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
      <span class="log-time">${this._getTime()}</span>
      <span class="log-tag ${tagClass}">${tag}</span>
      <span class="log-msg">${message}</span>
    `;
    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;

    // Update counter
    const counter = document.getElementById('log-counter');
    if (counter) counter.textContent = `${this._count} записей`;
  },

  _updateBadge() {
    const badge = document.getElementById('log-badge');
    if (!badge) return;
    if (this._errorCount > 0 && !this._panelVisible) {
      badge.textContent = this._errorCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  info(msg) {
    this._addEntry('INFO', 'log-tag-info', this._escapeHtml(msg));
  },

  ok(msg) {
    this._addEntry('OK', 'log-tag-ok', this._escapeHtml(msg));
  },

  warn(msg) {
    this._addEntry('WARN', 'log-tag-warn', this._escapeHtml(msg));
  },

  error(msg, detail = '') {
    this._errorCount++;
    let html = this._escapeHtml(msg);
    if (detail) html += `<span class="log-detail">${this._escapeHtml(detail)}</span>`;
    this._addEntry('ERR', 'log-tag-err', html);
    this._updateBadge();
  },

  request(method, url, bodyData = null) {
    let html = `<span class="log-status">${method}</span> <span class="log-url">${this._escapeHtml(url)}</span>`;
    if (bodyData) {
      const jsonStr = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData, null, 2);
      if (jsonStr.length <= 500) {
        html += `<span class="log-json">${this._escapeHtml(jsonStr)}</span>`;
      } else {
        html += `<span class="log-json">${this._escapeHtml(jsonStr.slice(0, 500))}...</span>`;
      }
    }
    this._addEntry('REQ', 'log-tag-req', html);
  },

  response(status, url, data = null, elapsed = null) {
    const isOk = status >= 200 && status < 400;
    let html = `<span class="log-status ${isOk ? 'log-status-ok' : 'log-status-err'}">${status}</span> `;
    html += `<span class="log-url">${this._escapeHtml(url)}</span>`;
    if (elapsed !== null) html += ` <span class="log-detail" style="display:inline">(${elapsed}ms)</span>`;

    if (data) {
      const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      if (jsonStr.length <= 800) {
        html += `<span class="log-json">${this._escapeHtml(jsonStr)}</span>`;
      } else {
        html += `<span class="log-json">${this._escapeHtml(jsonStr.slice(0, 800))}...\n[обрезано]</span>`;
      }
    }

    if (!isOk) {
      this._errorCount++;
      this._addEntry('ERR', 'log-tag-err', html);
      this._updateBadge();
    } else {
      this._addEntry('RES', 'log-tag-res', html);
    }
  },

  clear() {
    const body = document.getElementById('log-body');
    if (body) body.innerHTML = '';
    this._count = 0;
    this._errorCount = 0;
    const counter = document.getElementById('log-counter');
    if (counter) counter.textContent = '0 записей';
    this._updateBadge();
    this.info('Лог очищен');
  },

  setPanelVisible(v) {
    this._panelVisible = v;
    if (v) {
      this._errorCount = 0;
      this._updateBadge();
    }
  }
};

// Wrapped fetch with logging
async function loggedFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let bodyData = null;
  if (options.body) {
    try { bodyData = JSON.parse(options.body); } catch { bodyData = options.body; }
  }
  AppLog.request(method, url, bodyData);

  const t0 = performance.now();
  try {
    const resp = await fetch(url, options);
    const elapsed = Math.round(performance.now() - t0);
    const clone = resp.clone();
    try {
      const data = await clone.json();
      AppLog.response(resp.status, url, data, elapsed);
    } catch {
      AppLog.response(resp.status, url, null, elapsed);
    }
    return resp;
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    AppLog.error(`Сетевая ошибка: ${method} ${url}`, err.message + ` (${elapsed}ms)`);
    throw err;
  }
}

function initLog() {
  const toggleBtn = document.getElementById('nav-log-toggle');
  const panel = document.getElementById('log-panel');
  const collapseBtn = document.getElementById('log-collapse-btn');
  const clearBtn = document.getElementById('log-clear-btn');

  toggleBtn.addEventListener('click', () => {
    const isHidden = panel.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !isHidden);
    AppLog.setPanelVisible(!isHidden);
  });

  collapseBtn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  clearBtn.addEventListener('click', () => {
    AppLog.clear();
  });

  AppLog.info('Приложение загружено. Калькулятор ТК готов к работе.');
}

// ==================== DOM READY ====================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCalculator();
  initProducts();
  initModal();
  initLog();
  initCityAutocomplete();
  loadProducts();
});

// ==================== TABS ====================
function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// ==================== CITY AUTOCOMPLETE ====================
function initCityAutocomplete() {
  const cityInput = document.getElementById('calc-receiver-city');
  const dropdown = document.getElementById('city-dropdown');
  let debounceTimer = null;
  let currentRequest = 0;

  cityInput.addEventListener('input', () => {
    const query = cityInput.value.trim();
    selectedReceiverCity = null; // Reset selection when user types
    
    // Update visual state
    cityInput.classList.remove('city-selected');

    if (query.length < 2) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const requestId = ++currentRequest;
      
      try {
        const resp = await fetch(`${API_BASE}/api/dellin/cities?q=${encodeURIComponent(query)}`);
        const cities = await resp.json();

        // Ignore stale responses
        if (requestId !== currentRequest) return;

        if (cities.length === 0) {
          dropdown.innerHTML = '<div class="dropdown-empty">Город не найден. Проверьте написание.</div>';
          dropdown.classList.remove('hidden');
          return;
        }

        dropdown.innerHTML = cities.slice(0, 10).map(city => {
          const displayName = city.name || '';
          const region = city.region ? ` (${city.region})` : '';
          const terminalBadge = city.isTerminal ? '<span class="dropdown-badge">🏭 Терминал</span>' : '';
          return `<div class="dropdown-item" data-code="${escapeHtml(city.code || '')}" data-name="${escapeHtml(displayName)}" data-search="${escapeHtml(displayName)}">
            <span class="dropdown-city-name">${escapeHtml(displayName)}</span>
            <span class="dropdown-city-region">${escapeHtml(region)}</span>
            ${terminalBadge}
          </div>`;
        }).join('');

        dropdown.classList.remove('hidden');

        // Add click handlers
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            selectCity(item.dataset.code, item.dataset.name, item.dataset.search);
          });
        });
      } catch (err) {
        console.error('City search error:', err);
      }
    }, 300);
  });

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.city-input-wrapper')) {
      dropdown.classList.add('hidden');
    }
  });

  // Keyboard navigation
  cityInput.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    const activeItem = dropdown.querySelector('.dropdown-item.active');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeItem) {
        items[0]?.classList.add('active');
      } else {
        activeItem.classList.remove('active');
        const next = activeItem.nextElementSibling;
        if (next && next.classList.contains('dropdown-item')) next.classList.add('active');
        else items[0]?.classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeItem) {
        activeItem.classList.remove('active');
        const prev = activeItem.previousElementSibling;
        if (prev && prev.classList.contains('dropdown-item')) prev.classList.add('active');
        else items[items.length - 1]?.classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeItem) {
        selectCity(activeItem.dataset.code, activeItem.dataset.name, activeItem.dataset.search);
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });
}

function selectCity(code, name, searchString) {
  const cityInput = document.getElementById('calc-receiver-city');
  const dropdown = document.getElementById('city-dropdown');
  
  selectedReceiverCity = { code, name, searchString };
  cityInput.value = name;
  cityInput.classList.add('city-selected');
  dropdown.classList.add('hidden');
  
  AppLog.ok(`Выбран город: ${name} (код: ${code})`);
  showToast(`Город: ${name}`, 'success');
}

// ==================== PRODUCTS CRUD ====================
async function loadProducts() {
  try {
    AppLog.info('Загрузка базы товаров...');
    const resp = await loggedFetch(`${API_BASE}/api/products`);
    productsCache = await resp.json();
    AppLog.ok(`Загружено товаров: ${productsCache.length}`);
    renderProductsList();
  } catch (err) {
    AppLog.error('Не удалось загрузить товары', err.message);
    showToast('Ошибка загрузки товаров', 'error');
  }
}

function renderProductsList(filter = '') {
  const list = document.getElementById('products-list');
  const empty = document.getElementById('products-empty');
  
  let products = productsCache;
  if (filter) {
    const q = filter.toLowerCase();
    products = products.filter(p => 
      p.article.toLowerCase().includes(q) || 
      p.name.toLowerCase().includes(q) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  if (products.length === 0 && !filter) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.classList.remove('hidden');
    return;
  }

  if (products.length === 0 && filter) {
    list.innerHTML = `
      <div class="products-empty">
        <p>Ничего не найдено по запросу «${escapeHtml(filter)}»</p>
      </div>
    `;
    return;
  }

  let html = '';
  products.forEach((p, i) => {
    html += `
      <div class="product-card" data-article="${escapeHtml(p.article)}" style="animation-delay: ${i * 0.05}s">
        <div class="product-article">${escapeHtml(p.article)}</div>
        <div class="product-info">
          <div class="product-name">${escapeHtml(p.name)}</div>
          <div class="product-dims">
            <span>📐 ${p.length}×${p.width}×${p.height} м</span>
            <span>⚖️ ${p.weight} кг</span>
            <span>📦 ${p.volume.toFixed(4)} м³</span>
            ${p.quantity > 1 ? `<span>🔢 ${p.quantity} шт</span>` : ''}
          </div>
        </div>
        ${p.category ? `<div class="product-category">${escapeHtml(p.category)}</div>` : '<div></div>'}
        <div class="product-actions">
          <button class="btn btn-accent btn-sm" onclick="editProduct('${escapeHtml(p.article)}')" title="Редактировать">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="useInCalc('${escapeHtml(p.article)}')" title="Рассчитать доставку">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <rect x="2" y="1" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M5 5h6M5 8h4M5 11h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct('${escapeHtml(p.article)}')" title="Удалить">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
}

function initProducts() {
  const searchInput = document.getElementById('product-search');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderProductsList(searchInput.value.trim());
    }, 200);
  });

  document.getElementById('add-product-btn').addEventListener('click', () => openModal());
  document.getElementById('add-first-product-btn')?.addEventListener('click', () => openModal());
}

function editProduct(article) {
  const product = productsCache.find(p => p.article === article);
  if (!product) return;
  openModal(product);
}

function useInCalc(article) {
  // Switch to calculator tab
  document.querySelector('[data-tab="calculator"]').click();
  
  // Fill in the article
  document.getElementById('calc-article').value = article;
  findProductForCalc();
}

async function deleteProduct(article) {
  if (!confirm(`Удалить товар ${article}?`)) return;
  
  try {
    AppLog.info(`Удаление товара: ${article}`);
    const resp = await loggedFetch(`${API_BASE}/api/products/${encodeURIComponent(article)}`, {
      method: 'DELETE'
    });
    
    if (!resp.ok) throw new Error('Ошибка удаления');
    
    AppLog.ok(`Товар ${article} удалён`);
    showToast(`Товар ${article} удалён`, 'success');
    await loadProducts();
  } catch (err) {
    AppLog.error(`Не удалось удалить товар ${article}`, err.message);
    showToast('Ошибка удаления товара', 'error');
  }
}

// ==================== MODAL ====================
function initModal() {
  const overlay = document.getElementById('product-modal-overlay');
  const form = document.getElementById('product-form');
  
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Volume auto-calc
  ['form-length', 'form-width', 'form-height'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateVolumePreview);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const editingArticle = document.getElementById('form-editing-article').value;
    const data = {
      article: document.getElementById('form-article').value.trim(),
      name: document.getElementById('form-name').value.trim(),
      length: parseFloat(document.getElementById('form-length').value),
      width: parseFloat(document.getElementById('form-width').value),
      height: parseFloat(document.getElementById('form-height').value),
      weight: parseFloat(document.getElementById('form-weight').value),
      quantity: parseInt(document.getElementById('form-quantity').value) || 1,
      category: document.getElementById('form-category').value.trim(),
      notes: document.getElementById('form-notes').value.trim()
    };

    try {
      AppLog.info(`${editingArticle ? 'Обновление' : 'Создание'} товара: ${data.article}`);
      let resp;
      if (editingArticle) {
        resp = await loggedFetch(`${API_BASE}/api/products/${encodeURIComponent(editingArticle)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } else {
        resp = await loggedFetch(`${API_BASE}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }

      const result = await resp.json();
      
      if (!resp.ok) {
        AppLog.error(`Ошибка сохранения товара`, result.error || 'Неизвестная ошибка');
        showToast(result.error || 'Ошибка сохранения', 'error');
        return;
      }

      AppLog.ok(`Товар ${data.article} ${editingArticle ? 'обновлён' : 'создан'}`);
      showToast(editingArticle ? 'Товар обновлён' : 'Товар добавлен', 'success');
      closeModal();
      await loadProducts();
    } catch (err) {
      AppLog.error('Ошибка сохранения товара', err.message);
      showToast('Ошибка сохранения: ' + err.message, 'error');
    }
  });
}

function openModal(product = null) {
  const overlay = document.getElementById('product-modal-overlay');
  const title = document.getElementById('modal-title');
  const articleInput = document.getElementById('form-article');
  
  if (product) {
    title.textContent = 'Редактировать товар';
    document.getElementById('form-editing-article').value = product.article;
    articleInput.value = product.article;
    articleInput.disabled = true;
    document.getElementById('form-name').value = product.name;
    document.getElementById('form-length').value = product.length;
    document.getElementById('form-width').value = product.width;
    document.getElementById('form-height').value = product.height;
    document.getElementById('form-weight').value = product.weight;
    document.getElementById('form-quantity').value = product.quantity || 1;
    document.getElementById('form-category').value = product.category || '';
    document.getElementById('form-notes').value = product.notes || '';
  } else {
    title.textContent = 'Добавить товар';
    document.getElementById('form-editing-article').value = '';
    document.getElementById('product-form').reset();
    articleInput.disabled = false;
    document.getElementById('form-quantity').value = 1;
  }

  updateVolumePreview();
  overlay.classList.remove('hidden');
  
  setTimeout(() => {
    (product ? document.getElementById('form-name') : articleInput).focus();
  }, 100);
}

function closeModal() {
  document.getElementById('product-modal-overlay').classList.add('hidden');
}

function updateVolumePreview() {
  const l = parseFloat(document.getElementById('form-length').value) || 0;
  const w = parseFloat(document.getElementById('form-width').value) || 0;
  const h = parseFloat(document.getElementById('form-height').value) || 0;
  const vol = l * w * h;
  document.getElementById('volume-display').textContent = vol > 0 ? `${vol.toFixed(4)} м³` : '— м³';
}

// ==================== CALCULATOR ====================
function initCalculator() {
  document.getElementById('calc-find-btn').addEventListener('click', findProductForCalc);
  document.getElementById('calc-article').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findProductForCalc();
    }
  });

  document.getElementById('calc-submit-btn').addEventListener('click', doCalculation);

  // Carrier toggle active styling
  document.querySelectorAll('input[name="carrier"]').forEach(input => {
    input.addEventListener('change', () => {
      document.querySelectorAll('.carrier-option').forEach(opt => {
        opt.classList.toggle('active', opt.querySelector('input').checked);
      });
    });
  });
}

function findProductForCalc() {
  const article = document.getElementById('calc-article').value.trim();
  if (!article) {
    showToast('Введите артикул товара', 'info');
    return;
  }

  AppLog.info(`Поиск товара по артикулу: ${article}`);
  const product = productsCache.find(p => p.article.toLowerCase() === article.toLowerCase());
  
  const preview = document.getElementById('product-preview');
  
  if (product) {
    currentProduct = product;
    document.getElementById('preview-name').textContent = product.name;
    document.getElementById('preview-dims').textContent = `${product.length}×${product.width}×${product.height} м`;
    document.getElementById('preview-weight').textContent = `${product.weight} кг`;
    document.getElementById('preview-volume').textContent = `${product.volume.toFixed(4)} м³`;
    document.getElementById('calc-quantity').value = product.quantity || 1;
    preview.classList.remove('hidden');
    AppLog.ok(`Найден: ${product.name} [${product.length}×${product.width}×${product.height} м, ${product.weight} кг]`);
    showToast(`Товар найден: ${product.name}`, 'success');
  } else {
    currentProduct = null;
    preview.classList.add('hidden');
    AppLog.warn(`Товар с артикулом «${article}» не найден в базе (${productsCache.length} товаров)`);
    showToast(`Товар с артикулом «${article}» не найден`, 'error');
  }
}

async function doCalculation() {
  if (!currentProduct) {
    showToast('Сначала найдите товар по артикулу', 'error');
    return;
  }

  const receiverCity = document.getElementById('calc-receiver-city').value.trim();
  const receiverAddress = document.getElementById('calc-receiver-address').value.trim();
  
  if (!receiverCity) {
    showToast('Введите город получения', 'error');
    document.getElementById('calc-receiver-city').focus();
    return;
  }

  // Check if city was selected from autocomplete
  if (!selectedReceiverCity) {
    showToast('Выберите город из выпадающего списка подсказок', 'error');
    document.getElementById('calc-receiver-city').focus();
    return;
  }

  const carrier = document.querySelector('input[name="carrier"]:checked').value;
  const quantity = parseInt(document.getElementById('calc-quantity').value) || 1;

  // Show loading
  document.getElementById('results-empty').classList.add('hidden');
  document.getElementById('results-data').classList.add('hidden');
  document.getElementById('results-loading').classList.remove('hidden');
  document.getElementById('calc-submit-btn').disabled = true;

  const cargo = {
    length: currentProduct.length,
    width: currentProduct.width,
    height: currentProduct.height,
    weight: currentProduct.weight,
    volume: currentProduct.volume,
    quantity: quantity
  };

  const allResults = [];

  AppLog.info(`Запуск расчёта: ТК=${carrier}, город=${receiverCity}, кол-во=${quantity}`);
  AppLog.info(`Груз: ${cargo.length}×${cargo.width}×${cargo.height} м, ${cargo.weight} кг, объём=${cargo.volume} м³`);

  try {
    // Dellin
    if (carrier === 'all' || carrier === 'dellin') {
      try {
        AppLog.info('Запрос к API Деловые Линии...');
        const resp = await loggedFetch(`${API_BASE}/api/calculate/dellin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiverCityCode: selectedReceiverCity.code,
            receiverAddress: receiverAddress || '',
            cargo
          })
        });
        const data = await resp.json();
        if (data.error) {
          AppLog.error('Деловые Линии: ошибка', data.error);
          allResults.push({ carrier: 'dellin', carrierName: 'Деловые Линии', error: data.error, results: [] });
        } else {
          const count = data.results ? data.results.length : 0;
          AppLog.ok(`Деловые Линии: получено ${count} вариантов`);
          allResults.push(data);
        }
      } catch (err) {
        AppLog.error('Деловые Линии: сетевая ошибка', err.message);
        allResults.push({ carrier: 'dellin', carrierName: 'Деловые Линии', error: err.message, results: [] });
      }
    }

    // PEK
    if (carrier === 'all' || carrier === 'pek') {
      try {
        AppLog.info('Запрос к API ПЭК...');
        const resp = await loggedFetch(`${API_BASE}/api/calculate/pek`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiverCity: selectedReceiverCity.name.split(',')[0].trim(),
            cargo
          })
        });
        const data = await resp.json();
        if (data.error) {
          AppLog.error('ПЭК: ошибка', data.error);
          allResults.push({ carrier: 'pek', carrierName: 'ПЭК', error: data.error, results: [] });
        } else {
          const count = data.results ? data.results.length : 0;
          AppLog.ok(`ПЭК: получено ${count} вариантов`);
          allResults.push(data);
        }
      } catch (err) {
        AppLog.error('ПЭК: сетевая ошибка', err.message);
        allResults.push({ carrier: 'pek', carrierName: 'ПЭК', error: err.message, results: [] });
      }
    }

    AppLog.ok(`Расчёт завершён. Всего результатов: ${allResults.length}`);
    renderResults(allResults);
  } catch (err) {
    AppLog.error('Критическая ошибка расчёта', err.message);
    showToast('Ошибка расчёта: ' + err.message, 'error');
  } finally {
    document.getElementById('results-loading').classList.add('hidden');
    document.getElementById('calc-submit-btn').disabled = false;
  }
}

function renderResults(allResults) {
  const container = document.getElementById('results-data');
  
  // Find cheapest price across all
  let cheapestPrice = Infinity;
  allResults.forEach(cr => {
    if (cr.results) {
      cr.results.forEach(r => {
        const price = parseFloat(r.price);
        if (!isNaN(price) && price > 0 && price < cheapestPrice) {
          cheapestPrice = price;
        }
      });
    }
  });

  let html = '';

  allResults.forEach(carrierResult => {
    const isDellin = carrierResult.carrier === 'dellin';
    const icon = isDellin ? '🚛' : '📦';
    const cssClass = isDellin ? 'dellin' : 'pek';

    html += `<div class="carrier-results">`;
    html += `<div class="carrier-header ${cssClass}">
      <span class="carrier-logo">${icon}</span>
      ${carrierResult.carrierName}
    </div>`;

    if (carrierResult.error) {
      html += `<div class="api-warning">
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path d="M10 2L1 18h18L10 2zm0 4l6.5 11h-13L10 6zm-1 4v4h2v-4H9zm0 5v2h2v-2H9z"/>
        </svg>
        ${escapeHtml(carrierResult.error)}
      </div>`;
    } else if (!carrierResult.results || carrierResult.results.length === 0) {
      html += `<div class="api-warning">
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"/>
        </svg>
        Нет доступных вариантов доставки
      </div>`;
    } else {
      carrierResult.results.forEach(r => {
        if (r.error) {
          html += `<div class="result-row">
            <div class="result-variant">${escapeHtml(r.variant)}</div>
            <div></div>
            <div class="result-price error">${escapeHtml(r.error)}</div>
          </div>`;
        } else {
          const price = parseFloat(r.price);
          const isCheapest = price === cheapestPrice && price > 0;
          const variantIcons = getVariantIcons(r.derivalType, r.arrivalType);
          
          html += `<div class="result-row ${isCheapest ? 'result-cheapest' : ''}">
            <div class="result-variant">
              <span class="variant-icons">${variantIcons}</span>
              ${escapeHtml(r.variant)}
            </div>
            <div class="result-days">${r.deliveryDays ? escapeHtml(String(r.deliveryDays)) + ' дн.' : ''}</div>
            <div class="result-price">${price > 0 ? formatPrice(price) : '—'}</div>
          </div>`;
        }
      });
    }

    html += `</div>`;
  });

  container.innerHTML = html;
  container.classList.remove('hidden');
}

function getVariantIcons(derival, arrival) {
  const from = derival === 'address' ? '🏠' : '🏭';
  const to = arrival === 'address' ? '🏠' : '🏭';
  return `${from}→${to}`;
}

// ==================== UTILITIES ====================
function formatPrice(price) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(price);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
