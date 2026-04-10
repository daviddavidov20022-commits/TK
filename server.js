require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'products.json');
const KITS_FILE = path.join(DATA_DIR, 'kits.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

// Ensure directories exist
[DATA_DIR, IMAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(IMAGES_DIR));

// ==================== IMAGE UPLOAD ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ==================== HELPERS ====================
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
}

function writeJSON(file, data) {
  try {
    if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) { console.error('Write error:', err); }
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); }
  catch { return {}; }
}

// ==================== PRODUCTS CRUD ====================
app.get('/api/products', (req, res) => res.json(readJSON(DATA_FILE)));

app.get('/api/products/:article', (req, res) => {
  const p = readJSON(DATA_FILE).find(p => p.article === req.params.article);
  if (!p) return res.status(404).json({ error: 'Товар не найден' });
  res.json(p);
});

app.post('/api/products', (req, res) => {
  const products = readJSON(DATA_FILE);
  const { article, name, weight, length, width, height, quantity, category, notes, image } = req.body;
  if (!article || !name || !weight || !length || !width || !height)
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  if (products.find(p => p.article === article))
    return res.status(400).json({ error: 'Товар с таким артикулом уже существует' });

  const product = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    article, name, image: image || '',
    weight: parseFloat(weight), length: parseFloat(length),
    width: parseFloat(width), height: parseFloat(height),
    volume: parseFloat((parseFloat(length) * parseFloat(width) * parseFloat(height)).toFixed(6)),
    quantity: parseInt(quantity) || 1,
    category: category || '', notes: notes || '',
    createdAt: new Date().toISOString()
  };
  products.push(product);
  writeJSON(DATA_FILE, products);
  res.json(product);
});

app.put('/api/products/:article', (req, res) => {
  const products = readJSON(DATA_FILE);
  const idx = products.findIndex(p => p.article === req.params.article);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });
  const { name, weight, length, width, height, quantity, category, notes, image } = req.body;
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
    notes: notes !== undefined ? notes : products[idx].notes,
    image: image !== undefined ? image : products[idx].image
  };
  writeJSON(DATA_FILE, products);
  res.json(products[idx]);
});

app.delete('/api/products/:article', (req, res) => {
  let products = readJSON(DATA_FILE);
  const idx = products.findIndex(p => p.article === req.params.article);
  if (idx === -1) return res.status(404).json({ error: 'Товар не найден' });
  products.splice(idx, 1);
  writeJSON(DATA_FILE, products);
  res.json({ success: true });
});

// ==================== KITS CRUD ====================
app.get('/api/kits', (req, res) => res.json(readJSON(KITS_FILE)));

app.get('/api/kits/:id', (req, res) => {
  const kit = readJSON(KITS_FILE).find(k => k.id === req.params.id || k.article === req.params.id);
  if (!kit) return res.status(404).json({ error: 'Комплект не найден' });
  // Enrich with product details
  const products = readJSON(DATA_FILE);
  const enrichedItems = kit.items.map(item => {
    const product = products.find(p => p.article === item.article);
    return { ...item, product: product || null };
  });
  res.json({ ...kit, items: enrichedItems });
});

app.post('/api/kits', (req, res) => {
  const kits = readJSON(KITS_FILE);
  const { article, name, image, items } = req.body;
  if (!article || !name || !items || items.length === 0)
    return res.status(400).json({ error: 'Заполните артикул, название и добавьте товары' });
  if (kits.find(k => k.article === article))
    return res.status(400).json({ error: 'Комплект с таким артикулом уже существует' });

  // Calculate totals
  const products = readJSON(DATA_FILE);
  let totalWeight = 0, totalVolume = 0, totalPlaces = 0;
  for (const item of items) {
    const product = products.find(p => p.article === item.article);
    if (product) {
      const qty = item.quantity || 1;
      totalWeight += product.weight * qty;
      totalVolume += product.volume * qty;
      totalPlaces += qty;
    }
  }

  const kit = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    article, name, image: image || '',
    items, // [{ article: "ART-001", quantity: 2 }, ...]
    totalWeight: parseFloat(totalWeight.toFixed(2)),
    totalVolume: parseFloat(totalVolume.toFixed(6)),
    totalPlaces,
    createdAt: new Date().toISOString()
  };
  kits.push(kit);
  writeJSON(KITS_FILE, kits);
  res.json(kit);
});

app.put('/api/kits/:id', (req, res) => {
  const kits = readJSON(KITS_FILE);
  const idx = kits.findIndex(k => k.id === req.params.id || k.article === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Комплект не найден' });

  const { name, image, items } = req.body;
  const products = readJSON(DATA_FILE);
  let totalWeight = 0, totalVolume = 0, totalPlaces = 0;
  const useItems = items || kits[idx].items;
  for (const item of useItems) {
    const product = products.find(p => p.article === item.article);
    if (product) {
      const qty = item.quantity || 1;
      totalWeight += product.weight * qty;
      totalVolume += product.volume * qty;
      totalPlaces += qty;
    }
  }

  kits[idx] = {
    ...kits[idx],
    name: name || kits[idx].name,
    image: image !== undefined ? image : kits[idx].image,
    items: useItems,
    totalWeight: parseFloat(totalWeight.toFixed(2)),
    totalVolume: parseFloat(totalVolume.toFixed(6)),
    totalPlaces
  };
  writeJSON(KITS_FILE, kits);
  res.json(kits[idx]);
});

app.delete('/api/kits/:id', (req, res) => {
  let kits = readJSON(KITS_FILE);
  const idx = kits.findIndex(k => k.id === req.params.id || k.article === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Комплект не найден' });
  kits.splice(idx, 1);
  writeJSON(KITS_FILE, kits);
  res.json({ success: true });
});

// ==================== SETTINGS ====================
app.get('/api/settings', (req, res) => res.json(readSettings()));
app.post('/api/settings', (req, res) => {
  const updated = { ...readSettings(), ...req.body };
  writeJSON(SETTINGS_FILE, updated);
  res.json(updated);
});

// ==================== DELLIN AUTH ====================
let dellinSessionID = null;

async function dellinAuth() {
  if (!process.env.DELLIN_LOGIN || !process.env.DELLIN_PASSWORD) return;
  try {
    const resp = await fetch('https://api.dellin.ru/v3/auth/login.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appkey: process.env.DELLIN_APP_KEY, login: process.env.DELLIN_LOGIN, password: process.env.DELLIN_PASSWORD })
    });
    const data = await resp.json();
    if (data.data?.sessionID) { dellinSessionID = data.data.sessionID; console.log('Dellin auth OK'); }
    else console.warn('Dellin auth failed:', JSON.stringify(data.errors || data));
  } catch (err) { console.warn('Dellin auth error:', err.message); }
}

// ==================== DELLIN CITIES ====================
app.get('/api/dellin/cities', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) return res.json([]);
    if (!process.env.DELLIN_APP_KEY) return res.json([]);
    const resp = await fetch('https://api.dellin.ru/v2/public/kladr.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appkey: process.env.DELLIN_APP_KEY, q: query })
    });
    const data = await resp.json();
    if (data.cities?.length > 0) {
      res.json(data.cities.map(c => ({
        code: c.code, name: c.searchString || c.aString,
        fullName: c.aString, region: c.region_name || '',
        isTerminal: c.isTerminal === 1, cityID: c.cityID
      })));
    } else res.json([]);
  } catch (err) { res.json([]); }
});

// ==================== DELLIN CALCULATOR ====================
async function getDefaultTerminal(cityID) {
  const resp = await fetch('https://api.dellin.ru/v1/public/request_terminals.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appkey: process.env.DELLIN_APP_KEY, cityID: String(cityID) })
  });
  const data = await resp.json();
  if (data.terminals?.length > 0) {
    const def = data.terminals.find(t => t.default) || data.terminals[0];
    return { id: def.id, name: def.name, address: def.address, city: def.city };
  }
  return null;
}

async function lookupCity(query) {
  const resp = await fetch('https://api.dellin.ru/v2/public/kladr.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appkey: process.env.DELLIN_APP_KEY, q: query })
  });
  const data = await resp.json();
  return data.cities?.[0] || null;
}

app.post('/api/calculate/dellin', async (req, res) => {
  try {
    const { senderCityCode, senderCityID, receiverCityCode, receiverCityID, receiverAddress, cargo } = req.body;
    if (!process.env.DELLIN_APP_KEY) return res.status(400).json({ error: 'Не настроен DELLIN_APP_KEY.' });

    if (!dellinSessionID && process.env.DELLIN_LOGIN) {
      try { await dellinAuth(); } catch (err) { /* ignore */ }
    }

    // Resolve cities
    let senderCity = senderCityID ? { cityID: senderCityID, code: senderCityCode } : null;
    if (!senderCity) {
      const info = await lookupCity(process.env.SENDER_CITY || 'Москва');
      senderCity = info ? { cityID: info.cityID, code: info.code } : null;
    }
    let receiverCity = receiverCityID ? { cityID: receiverCityID, code: receiverCityCode } : null;
    if (!receiverCity && receiverCityCode) {
      const info = await lookupCity(receiverCityCode);
      receiverCity = info ? { cityID: info.cityID, code: info.code } : null;
    }
    if (!senderCity) return res.status(400).json({ error: 'Не удалось определить город отправления' });
    if (!receiverCity) return res.status(400).json({ error: 'Не указан город получения' });

    // Terminals
    let senderTerminal = null, receiverTerminal = null;
    try { senderTerminal = await getDefaultTerminal(senderCity.cityID); } catch (e) {}
    try { receiverTerminal = await getDefaultTerminal(receiverCity.cityID); } catch (e) {}

    // Date
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dow = tomorrow.getDay();
    if (dow === 0) tomorrow.setDate(tomorrow.getDate() + 1);
    if (dow === 6) tomorrow.setDate(tomorrow.getDate() + 2);
    const produceDate = tomorrow.toISOString().split('T')[0];

    // Cargo
    const totalWeight = cargo.weight * (cargo.quantity || 1);
    const totalVolume = cargo.volume || parseFloat((cargo.length * cargo.width * cargo.height * (cargo.quantity || 1)).toFixed(6));
    const cargoBody = {
      quantity: String(cargo.quantity || 1),
      length: String(cargo.length), width: String(cargo.width), height: String(cargo.height),
      totalVolume: String(totalVolume), totalWeight: String(totalWeight),
      oversizedWeight: String(totalWeight), oversizedVolume: String(totalVolume),
      freight: [{ length: String(cargo.length), width: String(cargo.width), height: String(cargo.height), weight: String(cargo.weight), quantity: String(cargo.quantity || 1) }]
    };

    const variants = [
      { derival: 'terminal', arrival: 'terminal', label: 'Терминал → Терминал' },
      { derival: 'terminal', arrival: 'address', label: 'Терминал → Адрес' },
      { derival: 'address', arrival: 'terminal', label: 'Адрес → Терминал' },
      { derival: 'address', arrival: 'address', label: 'Адрес → Адрес' }
    ];
    const results = [];

    for (const v of variants) {
      try {
        const rb = {
          appkey: process.env.DELLIN_APP_KEY,
          delivery: { deliveryType: { type: 'auto' }, derival: { produceDate, variant: v.derival }, arrival: { variant: v.arrival } },
          cargo: cargoBody
        };
        if (dellinSessionID) rb.sessionID = dellinSessionID;

        if (v.derival === 'terminal') {
          if (!senderTerminal) { results.push({ variant: v.label, error: 'Нет терминала ДЛ в городе отправления' }); continue; }
          rb.delivery.derival.terminalID = senderTerminal.id;
        } else {
          rb.delivery.derival.address = { search: process.env.SENDER_ADDRESS || senderTerminal?.city || 'Москва' };
          rb.delivery.derival.time = { worktimeStart: '09:00', worktimeEnd: '18:00' };
        }

        if (v.arrival === 'terminal') {
          if (!receiverTerminal) { results.push({ variant: v.label, error: 'Нет терминала ДЛ в городе получения' }); continue; }
          rb.delivery.arrival.terminalID = receiverTerminal.id;
        } else {
          if (!receiverAddress) { results.push({ variant: v.label, error: 'Укажите адрес для расчёта до двери' }); continue; }
          rb.delivery.arrival.address = { search: receiverAddress };
          rb.delivery.arrival.time = { worktimeStart: '09:00', worktimeEnd: '21:00' };
        }

        const resp = await fetch('https://api.dellin.ru/v2/calculator.json', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rb)
        });
        const data = await resp.json();

        if (data.data?.price) {
          let deliveryDays = null;
          if (data.data.orderDates) {
            const dates = data.data.orderDates;
            const from = dates.arrivalToOspSender || dates.derivalFromOspSender;
            const to = dates.giveoutFromOspReceiver || dates.arrivalToOspReceiver;
            if (from && to) deliveryDays = Math.ceil((new Date(to) - new Date(from)) / 86400000);
          }
          results.push({
            variant: v.label, derivalType: v.derival, arrivalType: v.arrival,
            price: data.data.price, deliveryDays,
            arrivalDate: data.data.orderDates?.giveoutFromOspReceiver || data.data.orderDates?.arrivalToOspReceiver || null,
            senderTerminal: senderTerminal?.name, receiverTerminal: receiverTerminal?.name
          });
        } else if (data.errors) {
          results.push({ variant: v.label, error: (Array.isArray(data.errors) ? data.errors.map(e => e.title || e.detail).join(', ') : JSON.stringify(data.errors)) });
        } else {
          results.push({ variant: v.label, error: 'Нет данных' });
        }
      } catch (err) { results.push({ variant: v.label, error: err.message }); }
    }

    res.json({ carrier: 'dellin', carrierName: 'Деловые Линии', senderTerminal: senderTerminal?.name, receiverTerminal: receiverTerminal?.name, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== PEK ====================
app.post('/api/calculate/pek', async (req, res) => {
  try {
    const { senderCity, receiverCity, cargo } = req.body;
    const hdrs = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json, text/plain, */*' };
    const townsResp = await fetch('https://pecom.ru/ru/calc/towns.php', { headers: hdrs });
    const towns = await townsResp.json();
    const senderName = (senderCity || process.env.SENDER_CITY || 'Москва').toLowerCase();
    const receiverName = (receiverCity || '').toLowerCase();
    let senderCityId = null, receiverCityId = null;
    for (const [id, name] of Object.entries(towns)) {
      const tn = name.toLowerCase();
      if (!senderCityId && (tn.includes(senderName) || senderName.includes(tn))) senderCityId = id;
      if (!receiverCityId && (tn.includes(receiverName) || receiverName.includes(tn))) receiverCityId = id;
    }
    if (!senderCityId) return res.status(400).json({ error: `Город "${senderCity}" не найден в ПЭК` });
    if (!receiverCityId) return res.status(400).json({ error: `Город "${receiverCity}" не найден в ПЭК` });

    const params = new URLSearchParams({
      places_count: cargo.quantity || 1, 'places[0][length]': cargo.length, 'places[0][width]': cargo.width,
      'places[0][height]': cargo.height, 'places[0][volume]': (cargo.length * cargo.width * cargo.height).toFixed(4),
      'places[0][weight]': cargo.weight, 'places[0][is_oversized]': 0,
      take: JSON.stringify({ town: senderCityId, tent: false, org: false, manipulator: false }),
      deliver: JSON.stringify({ town: receiverCityId, tent: false, org: false, manipulator: false }),
      plombir: 0, stacking: 0, insurance_sum: 0, is_gazelle: 0
    });
    const calcResp = await fetch(`https://calc.pecom.ru/bitrix/components/pecom/calc/ajax.php?${params}`, {
      headers: { ...hdrs, 'Referer': 'https://pecom.ru/' }
    });
    const cd = await calcResp.json();
    const results = [];
    if (cd.autotracing) {
      if (cd.autotracing.auto) results.push({ variant: 'Авто (склад → склад)', derivalType: 'terminal', arrivalType: 'terminal', price: cd.autotracing.auto.price || cd.autotracing.auto.pricediscount, deliveryDays: cd.autotracing.auto.periods || null });
      if (cd.autotracing.autozabor) results.push({ variant: 'Авто (забор → склад)', derivalType: 'address', arrivalType: 'terminal', price: cd.autotracing.autozabor.price || cd.autotracing.autozabor.pricediscount, deliveryDays: cd.autotracing.autozabor.periods || null });
      if (cd.autotracing.autodelivery) results.push({ variant: 'Авто (склад → доставка)', derivalType: 'terminal', arrivalType: 'address', price: cd.autotracing.autodelivery.price || cd.autotracing.autodelivery.pricediscount, deliveryDays: cd.autotracing.autodelivery.periods || null });
      if (cd.autotracing.autozabordelivery) results.push({ variant: 'Авто (забор → доставка)', derivalType: 'address', arrivalType: 'address', price: cd.autotracing.autozabordelivery.price || cd.autotracing.autozabordelivery.pricediscount, deliveryDays: cd.autotracing.autozabordelivery.periods || null });
    }
    if (cd.avia?.price) results.push({ variant: 'Авиа', derivalType: 'terminal', arrivalType: 'terminal', price: cd.avia.price, deliveryDays: cd.avia.periods || null });
    res.json({ carrier: 'pek', carrierName: 'ПЭК', results });
  } catch (err) { res.status(500).json({ error: 'Ошибка ПЭК: ' + err.message }); }
});

// ==================== PEK CITIES ====================
let pekTownsCache = null;
app.get('/api/pek/cities', async (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase();
    if (query.length < 2) return res.json([]);
    if (!pekTownsCache) {
      const resp = await fetch('https://pecom.ru/ru/calc/towns.php', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      pekTownsCache = await resp.json();
    }
    const results = [];
    for (const [id, name] of Object.entries(pekTownsCache)) {
      if (name.toLowerCase().includes(query)) { results.push({ id, name }); if (results.length >= 20) break; }
    }
    res.json(results);
  } catch { res.json([]); }
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`\n🚚 Калькулятор ТК: http://localhost:${PORT}`);
  console.log(`📦 Товары: ${DATA_FILE}`);
  console.log(`📦 Комплекты: ${KITS_FILE}`);
  console.log(`📸 Фото: ${IMAGES_DIR}`);
  console.log(`API ДЛ: ${process.env.DELLIN_APP_KEY ? '✅' : '❌'}`);
  console.log(`API ПЭК: ${process.env.PEK_API_KEY ? '✅' : 'ℹ️ публичный'}\n`);
});
