require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'products.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== PRODUCT DATABASE ====================

function readProducts() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeProducts(products) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

// GET all products
app.get('/api/products', (req, res) => {
  const products = readProducts();
  res.json(products);
});

// GET product by article
app.get('/api/products/:article', (req, res) => {
  const products = readProducts();
  const product = products.find(p => p.article === req.params.article);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  res.json(product);
});

// POST create product
app.post('/api/products', (req, res) => {
  const products = readProducts();
  const { article, name, weight, length, width, height, quantity, category, notes } = req.body;

  if (!article || !name || !weight || !length || !width || !height) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }

  if (products.find(p => p.article === article)) {
    return res.status(409).json({ error: 'Товар с таким артикулом уже существует' });
  }

  const product = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    article,
    name,
    weight: parseFloat(weight),
    length: parseFloat(length),
    width: parseFloat(width),
    height: parseFloat(height),
    volume: parseFloat((parseFloat(length) * parseFloat(width) * parseFloat(height)).toFixed(6)),
    quantity: parseInt(quantity) || 1,
    category: category || '',
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

// PUT update product
app.put('/api/products/:article', (req, res) => {
  const products = readProducts();
  const idx = products.findIndex(p => p.article === req.params.article);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });

  const { name, weight, length, width, height, quantity, category, notes } = req.body;

  if (name) products[idx].name = name;
  if (weight) products[idx].weight = parseFloat(weight);
  if (length) products[idx].length = parseFloat(length);
  if (width) products[idx].width = parseFloat(width);
  if (height) products[idx].height = parseFloat(height);
  if (quantity !== undefined) products[idx].quantity = parseInt(quantity);
  if (category !== undefined) products[idx].category = category;
  if (notes !== undefined) products[idx].notes = notes;

  products[idx].volume = parseFloat(
    (products[idx].length * products[idx].width * products[idx].height).toFixed(6)
  );
  products[idx].updatedAt = new Date().toISOString();

  writeProducts(products);
  res.json(products[idx]);
});

// DELETE product
app.delete('/api/products/:article', (req, res) => {
  let products = readProducts();
  const idx = products.findIndex(p => p.article === req.params.article);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });

  products.splice(idx, 1);
  writeProducts(products);
  res.json({ success: true });
});

// ==================== DELLIN (Деловые Линии) API ====================

let dellinSessionID = null;

async function dellinAuth() {
  if (!process.env.DELLIN_APP_KEY || !process.env.DELLIN_LOGIN) {
    throw new Error('Деловые Линии: API ключи не настроены. Заполните .env файл.');
  }
  try {
    const resp = await fetch('https://api.dellin.ru/v1/customers/login.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        login: process.env.DELLIN_LOGIN,
        password: process.env.DELLIN_PASSWORD
      })
    });
    const data = await resp.json();
    if (data.sessionID) {
      dellinSessionID = data.sessionID;
      return data.sessionID;
    }
    throw new Error(data.errors ? JSON.stringify(data.errors) : 'Ошибка авторизации ДЛ');
  } catch (err) {
    throw new Error('Ошибка авторизации Деловые Линии: ' + err.message);
  }
}

// Dellin calculator endpoint
app.post('/api/calculate/dellin', async (req, res) => {
  try {
    const { senderCity, receiverAddress, cargo } = req.body;

    if (!dellinSessionID && process.env.DELLIN_LOGIN) {
      try {
        await dellinAuth();
      } catch (err) {
        console.warn('Dellin auth error, using public API (no personal discounts):', err.message);
      }
    }

    // Calculate for all variants
    const variants = [
      { derival: 'terminal', arrival: 'terminal', label: 'Терминал → Терминал' },
      { derival: 'terminal', arrival: 'address', label: 'Терминал → Адрес' },
      { derival: 'address', arrival: 'terminal', label: 'Адрес → Терминал' },
      { derival: 'address', arrival: 'address', label: 'Адрес → Адрес' }
    ];

    const results = [];

    for (const variant of variants) {
      try {
        const requestBody = {
          appkey: process.env.DELLIN_APP_KEY,
          delivery: {
            deliveryType: { type: 'auto' },
            derival: {
              variant: variant.derival,
              city: senderCity || process.env.SENDER_CITY || 'Москва'
            },
            arrival: {
              variant: variant.arrival
            }
          },
          cargo: {
            quantity: cargo.quantity || 1,
            length: cargo.length,
            width: cargo.width,
            height: cargo.height,
            totalVolume: cargo.volume || (cargo.length * cargo.width * cargo.height * (cargo.quantity || 1)),
            totalWeight: cargo.weight * (cargo.quantity || 1)
          }
        };

        if (dellinSessionID) {
          requestBody.sessionID = dellinSessionID;
        }

        // Use address search for address variants
        if (variant.derival === 'address') {
          requestBody.delivery.derival.address = {
            search: process.env.SENDER_ADDRESS || process.env.SENDER_CITY || 'Москва'
          };
          requestBody.delivery.derival.time = {
            worktimeStart: '09:00',
            worktimeEnd: '18:00'
          };
        } else {
          requestBody.delivery.derival.address = {
            search: process.env.SENDER_CITY || 'Москва'
          };
        }

        if (variant.arrival === 'address') {
          requestBody.delivery.arrival.address = {
            search: receiverAddress
          };
          requestBody.delivery.arrival.time = {
            worktimeStart: '09:00',
            worktimeEnd: '21:00'
          };
        } else {
          requestBody.delivery.arrival.address = {
            search: receiverAddress
          };
        }

        const resp = await fetch('https://api.dellin.ru/v2/calculator.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await resp.json();

        if (data.data) {
          results.push({
            variant: variant.label,
            derivalType: variant.derival,
            arrivalType: variant.arrival,
            price: data.data.price || data.data.priceMinimal,
            priceMin: data.data.priceMinimal,
            priceMax: data.data.priceMaximal,
            deliveryDays: data.data.orderDates?.deliveryDate || null,
            arrivalDate: data.data.orderDates?.arrivalDate || null,
            derivalDate: data.data.orderDates?.derivalDate || null,
            insurance: data.data.insurance || null,
            raw: data.data
          });
        } else if (data.errors) {
          results.push({
            variant: variant.label,
            error: Array.isArray(data.errors) ? data.errors.map(e => e.title || e).join(', ') : JSON.stringify(data.errors)
          });
        }
      } catch (err) {
        results.push({
          variant: variant.label,
          error: err.message
        });
      }
    }

    res.json({
      carrier: 'dellin',
      carrierName: 'Деловые Линии',
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PEK (ПЭК) API ====================

// PEK public calculator (no auth needed)
app.post('/api/calculate/pek', async (req, res) => {
  try {
    const { senderCity, receiverCity, cargo } = req.body;

    // First, get city IDs from PEK directory
    const townsResp = await fetch('https://pecom.ru/ru/calc/towns.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    const towns = await townsResp.json();

    // Find sender city ID
    let senderCityId = null;
    let receiverCityId = null;

    const senderName = (senderCity || process.env.SENDER_CITY || 'Москва').toLowerCase();
    const receiverName = (receiverCity || '').toLowerCase();

    // Towns is an object where keys are IDs
    for (const [id, name] of Object.entries(towns)) {
      const townName = name.toLowerCase();
      if (townName.includes(senderName) || senderName.includes(townName)) {
        if (!senderCityId) senderCityId = id;
      }
      if (townName.includes(receiverName) || receiverName.includes(townName)) {
        if (!receiverCityId) receiverCityId = id;
      }
    }

    if (!senderCityId) {
      return res.status(400).json({ error: `Город отправления "${senderCity || process.env.SENDER_CITY}" не найден в справочнике ПЭК` });
    }
    if (!receiverCityId) {
      return res.status(400).json({ error: `Город получения "${receiverCity}" не найден в справочнике ПЭК` });
    }

    // Calculate volume in cubic meters
    const volumeM3 = cargo.length * cargo.width * cargo.height * (cargo.quantity || 1);
    const totalWeight = cargo.weight * (cargo.quantity || 1);

    // Build request params
    const params = new URLSearchParams({
      places_count: cargo.quantity || 1,
      'places[0][length]': cargo.length,
      'places[0][width]': cargo.width,
      'places[0][height]': cargo.height,
      'places[0][volume]': (cargo.length * cargo.width * cargo.height).toFixed(4),
      'places[0][weight]': cargo.weight,
      'places[0][is_oversized]': 0,
      take: JSON.stringify({
        town: senderCityId,
        tent: false,
        org: false,
        manipulator: false
      }),
      deliver: JSON.stringify({
        town: receiverCityId,
        tent: false,
        org: false, 
        manipulator: false
      }),
      plombir: 0,
      stacking: 0,
      insurance_sum: 0,
      is_gazelle: 0
    });

    const calcUrl = `https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php?${params.toString()}`;

    const calcResp = await fetch(calcUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://pecom.ru/'
      }
    });
    const calcData = await calcResp.json();

    // Parse PEK response - they return different service types
    const results = [];

    if (calcData.autotracing) {
      // autotracing contains multiple service options
      if (calcData.autotracing.auto) {
        results.push({
          variant: 'Авто (склад → склад)',
          derivalType: 'terminal',
          arrivalType: 'terminal',
          price: calcData.autotracing.auto.price || calcData.autotracing.auto.pricediscount,
          deliveryDays: calcData.autotracing.auto.periods || null
        });
      }
      if (calcData.autotracing.autozabor) {
        results.push({
          variant: 'Авто (забор → склад)',
          derivalType: 'address',
          arrivalType: 'terminal',
          price: calcData.autotracing.autozabor.price || calcData.autotracing.autozabor.pricediscount,
          deliveryDays: calcData.autotracing.autozabor.periods || null
        });
      }
      if (calcData.autotracing.autodelivery) {
        results.push({
          variant: 'Авто (склад → доставка)',
          derivalType: 'terminal',
          arrivalType: 'address',
          price: calcData.autotracing.autodelivery.price || calcData.autotracing.autodelivery.pricediscount,
          deliveryDays: calcData.autotracing.autodelivery.periods || null
        });
      }
      if (calcData.autotracing.autozabordelivery) {
        results.push({
          variant: 'Авто (забор → доставка)',
          derivalType: 'address',
          arrivalType: 'address',
          price: calcData.autotracing.autozabordelivery.price || calcData.autotracing.autozabordelivery.pricediscount,
          deliveryDays: calcData.autotracing.autozabordelivery.periods || null
        });
      }
    }

    // Avia options
    if (calcData.avia) {
      if (calcData.avia.price) {
        results.push({
          variant: 'Авиа',
          derivalType: 'terminal',
          arrivalType: 'terminal',
          price: calcData.avia.price,
          deliveryDays: calcData.avia.periods || null
        });
      }
    }

    // If we got raw numbered entries (alternative response format)
    if (results.length === 0 && typeof calcData === 'object') {
      for (const [key, val] of Object.entries(calcData)) {
        if (val && typeof val === 'object' && val.price) {
          results.push({
            variant: val.name || `Вариант ${key}`,
            price: val.price,
            deliveryDays: val.periods || val.transit || null
          });
        }
      }
    }

    res.json({
      carrier: 'pek',
      carrierName: 'ПЭК',
      results,
      raw: calcData
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка расчёта ПЭК: ' + err.message });
  }
});

// ==================== DELLIN SEARCH CITIES ====================

app.get('/api/dellin/cities', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) return res.json([]);

    const resp = await fetch('https://api.dellin.ru/v1/public/places.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        q: query
      })
    });
    const data = await resp.json();
    res.json(data.cities || []);
  } catch (err) {
    res.json([]);
  }
});

// ==================== PEK SEARCH CITIES ====================

let pekTownsCache = null;

app.get('/api/pek/cities', async (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase();
    if (query.length < 2) return res.json([]);

    if (!pekTownsCache) {
      const resp = await fetch('https://pecom.ru/ru/calc/towns.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        }
      });
      pekTownsCache = await resp.json();
    }

    const results = [];
    for (const [id, name] of Object.entries(pekTownsCache)) {
      if (name.toLowerCase().includes(query)) {
        results.push({ id, name });
        if (results.length >= 20) break;
      }
    }
    res.json(results);
  } catch (err) {
    res.json([]);
  }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`\n🚚 Калькулятор ТК запущен: http://localhost:${PORT}`);
  console.log(`📦 База товаров: ${DATA_FILE}`);
  console.log(`\nAPI Деловые Линии: ${process.env.DELLIN_APP_KEY ? '✅ ключ настроен' : '❌ заполните .env'}`);
  console.log(`API ПЭК: ${process.env.PEK_API_KEY ? '✅ ключ настроен' : 'ℹ️ используется публичный API'}\n`);
});
