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
  try {
    if (!fs.existsSync(path.dirname(DATA_FILE))) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf-8');
  } catch (err) {
    console.error('Ошибка сохранения товаров:', err);
  }
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
    return res.status(400).json({ error: 'Товар с таким артикулом уже существует' });
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
  res.json(product);
});

// PUT update product
app.put('/api/products/:article', (req, res) => {
  const products = readProducts();
  const idx = products.findIndex(p => p.article === req.params.article);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });

  const { name, weight, length, width, height, quantity, category, notes } = req.body;
  products[idx] = {
    ...products[idx],
    name: name || products[idx].name,
    weight: parseFloat(weight) || products[idx].weight,
    length: parseFloat(length) || products[idx].length,
    width: parseFloat(width) || products[idx].width,
    height: parseFloat(height) || products[idx].height,
    volume: parseFloat((parseFloat(length) * parseFloat(width) * parseFloat(height)).toFixed(6)),
    quantity: parseInt(quantity) || products[idx].quantity,
    category: category !== undefined ? category : products[idx].category,
    notes: notes !== undefined ? notes : products[idx].notes
  };

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

// ==================== DELLIN AUTH ====================

let dellinSessionID = null;

async function dellinAuth() {
  if (!process.env.DELLIN_LOGIN || !process.env.DELLIN_PASSWORD) {
    console.warn('Dellin auth skipped: no login/password in .env');
    return;
  }
  try {
    const resp = await fetch('https://api.dellin.ru/v3/auth/login.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        login: process.env.DELLIN_LOGIN,
        password: process.env.DELLIN_PASSWORD
      })
    });
    const data = await resp.json();
    if (data.data && data.data.sessionID) {
      dellinSessionID = data.data.sessionID;
      console.log('Dellin auth OK, sessionID:', dellinSessionID.slice(0, 8) + '...');
    } else {
      console.warn('Dellin auth failed:', JSON.stringify(data.errors || data));
    }
  } catch (err) {
    console.warn('Dellin auth error:', err.message);
  }
}

// ==================== DELLIN SEARCH CITIES ====================

app.get('/api/dellin/cities', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) return res.json([]);

    if (!process.env.DELLIN_APP_KEY) {
      console.error('DELLIN_APP_KEY is not set!');
      return res.json([]);
    }

    const resp = await fetch('https://api.dellin.ru/v2/public/kladr.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        q: query
      })
    });
    const data = await resp.json();
    
    if (data.cities && data.cities.length > 0) {
      // Map to a clean format for the frontend
      const cities = data.cities.map(c => ({
        code: c.code,
        name: c.searchString || c.aString,
        fullName: c.aString,
        region: c.region_name || '',
        isTerminal: c.isTerminal === 1,
        cityID: c.cityID
      }));
      res.json(cities);
    } else {
      console.warn('Dellin KLADR: no cities found for query:', query);
      res.json([]);
    }
  } catch (err) {
    console.error('Dellin cities search error:', err.message);
    res.json([]);
  }
});

// ==================== DELLIN SEARCH STREETS ====================

app.get('/api/dellin/streets', async (req, res) => {
  try {
    const { cityID, q } = req.query;
    if (!cityID || !q || q.length < 2) return res.json([]);

    const resp = await fetch('https://api.dellin.ru/v1/public/streets.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        cityID: cityID,
        q: q
      })
    });
    const data = await resp.json();
    res.json(data.streets || []);
  } catch (err) {
    console.error('Dellin streets search error:', err.message);
    res.json([]);
  }
});

// ==================== DELLIN TERMINALS ====================

app.get('/api/dellin/terminals', async (req, res) => {
  try {
    const { cityID } = req.query;
    if (!cityID) return res.json([]);

    const resp = await fetch('https://api.dellin.ru/v1/public/request_terminals.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: process.env.DELLIN_APP_KEY,
        cityID: cityID
      })
    });
    const data = await resp.json();
    // Return terminal list
    const terminals = [];
    if (data.terminals) {
      for (const t of data.terminals) {
        terminals.push({
          id: t.id,
          name: t.name,
          address: t.address,
          cityID: t.cityID
        });
      }
    }
    res.json(terminals);
  } catch (err) {
    console.error('Dellin terminals error:', err.message);
    res.json([]);
  }
});

// ==================== DELLIN CALCULATOR ====================

app.post('/api/calculate/dellin', async (req, res) => {
  try {
    const { senderCityCode, receiverCityCode, receiverAddress, receiverStreetCode, cargo } = req.body;

    if (!process.env.DELLIN_APP_KEY) {
      return res.status(400).json({ error: 'Не настроен DELLIN_APP_KEY. Добавьте его в переменные окружения.' });
    }

    // Try to authenticate if we have credentials
    if (!dellinSessionID && process.env.DELLIN_LOGIN) {
      try {
        await dellinAuth();
      } catch (err) {
        console.warn('Dellin auth error, using public API:', err.message);
      }
    }

    const senderCode = senderCityCode || process.env.SENDER_CITY_CODE || null;
    const senderCitySearch = process.env.SENDER_CITY || 'Москва';

    // If we don't have a sender city code, look it up
    let actualSenderCode = senderCode;
    if (!actualSenderCode) {
      try {
        const placesResp = await fetch('https://api.dellin.ru/v1/public/places.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appkey: process.env.DELLIN_APP_KEY, q: senderCitySearch })
        });
        const placesData = await placesResp.json();
        if (placesData.cities && placesData.cities.length > 0) {
          actualSenderCode = placesData.cities[0].code;
        }
      } catch (e) {
        console.error('Failed to lookup sender city:', e.message);
      }
    }

    if (!actualSenderCode) {
      return res.status(400).json({ error: 'Не удалось определить город отправления' });
    }

    if (!receiverCityCode) {
      return res.status(400).json({ error: 'Не указан город получения. Выберите город из подсказок.' });
    }

    // Get tomorrow's date for produceDate
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Skip weekends
    const dow = tomorrow.getDay();
    if (dow === 0) tomorrow.setDate(tomorrow.getDate() + 1); // Sunday -> Monday
    if (dow === 6) tomorrow.setDate(tomorrow.getDate() + 2); // Saturday -> Monday
    const produceDate = tomorrow.toISOString().split('T')[0];

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
              produceDate: produceDate,
              variant: variant.derival,
              city: actualSenderCode
            },
            arrival: {
              variant: variant.arrival,
              city: receiverCityCode
            }
          },
          cargo: {
            quantity: String(cargo.quantity || 1),
            length: String(cargo.length),
            width: String(cargo.width),
            height: String(cargo.height),
            totalVolume: String(cargo.volume || parseFloat((cargo.length * cargo.width * cargo.height * (cargo.quantity || 1)).toFixed(6))),
            totalWeight: String(cargo.weight * (cargo.quantity || 1)),
            oversizedWeight: String(cargo.weight * (cargo.quantity || 1)),
            oversizedVolume: String(cargo.volume || parseFloat((cargo.length * cargo.width * cargo.height * (cargo.quantity || 1)).toFixed(6))),
            freight: [{
              length: String(cargo.length),
              width: String(cargo.width),
              height: String(cargo.height),
              weight: String(cargo.weight),
              quantity: String(cargo.quantity || 1)
            }]
          }
        };

        if (dellinSessionID) {
          requestBody.sessionID = dellinSessionID;
        }

        // For address variants, add address details
        if (variant.derival === 'address') {
          requestBody.delivery.derival.address = {
            search: process.env.SENDER_ADDRESS || senderCitySearch
          };
          requestBody.delivery.derival.time = {
            worktimeStart: '09:00',
            worktimeEnd: '18:00'
          };
        }

        if (variant.arrival === 'address') {
          const addressSearch = receiverAddress || '';
          if (receiverStreetCode) {
            requestBody.delivery.arrival.address = {
              street: receiverStreetCode,
              house: '1'
            };
          } else if (addressSearch) {
            requestBody.delivery.arrival.address = {
              search: addressSearch
            };
          } else {
            // Skip address variants if no address provided
            results.push({
              variant: variant.label,
              error: 'Укажите адрес для расчёта доставки до двери'
            });
            continue;
          }
          requestBody.delivery.arrival.time = {
            worktimeStart: '09:00',
            worktimeEnd: '21:00'
          };
        }

        console.log(`Dellin request [${variant.label}]:`, JSON.stringify(requestBody).slice(0, 500));

        const resp = await fetch('https://api.dellin.ru/v2/calculator.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await resp.json();
        console.log(`Dellin response [${variant.label}]:`, JSON.stringify(data).slice(0, 300));

        if (data.data && data.data.price) {
          results.push({
            variant: variant.label,
            derivalType: variant.derival,
            arrivalType: variant.arrival,
            price: data.data.price,
            priceMin: data.data.priceMinimal,
            priceMax: data.data.priceMaximal,
            deliveryDays: data.data.orderDates?.deliveryDate || null,
            arrivalDate: data.data.orderDates?.arrivalDate || null,
            derivalDate: data.data.orderDates?.derivalDate || null,
            insurance: data.data.insurance || null
          });
        } else if (data.errors) {
          const errMsg = Array.isArray(data.errors)
            ? data.errors.map(e => e.title || e.detail || JSON.stringify(e)).join(', ')
            : JSON.stringify(data.errors);
          results.push({
            variant: variant.label,
            error: errMsg
          });
        } else {
          results.push({
            variant: variant.label,
            error: 'Нет данных в ответе API'
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

// PEK uses the official public JSON API
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

    // Parse PEK response
    const results = [];

    if (calcData.autotracing) {
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
    if (calcData.avia && calcData.avia.price) {
      results.push({
        variant: 'Авиа',
        derivalType: 'terminal',
        arrivalType: 'terminal',
        price: calcData.avia.price,
        deliveryDays: calcData.avia.periods || null
      });
    }

    // Fallback for alternative response format
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
