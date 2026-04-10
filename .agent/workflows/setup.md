---
description: Установка и запуск Калькулятора ТК (Деловые Линии + ПЭК)
---

# Установка и запуск проекта Калькулятор ТК

## Что уже сделано:
- ✅ `server.js` — Express сервер с API для товаров, расчётов ДЛ и ПЭК
- ✅ `public/index.html` — Главная страница с калькулятором и базой товаров
- ✅ `public/css/style.css` — Стили (тёмная тема, glassmorphism, анимации)
- ✅ `public/js/app.js` — Клиентская логика (CRUD товаров, расчёт доставки)
- ✅ `data/products.json` — Файл базы данных товаров
- ✅ `.env` и `.env.example` — Конфигурация API ключей
- ✅ `package.json` — Конфиг проекта

## Что нужно доделать:

// turbo-all

### 1. Обновить package.json — добавить start-скрипт
```
npm pkg set scripts.start="node server.js" scripts.dev="node --watch server.js"
```

### 2. Установить npm зависимости
```
npm install express cors dotenv node-fetch@2
```

### 3. Запустить сервер
```
npm run dev
```

### 4. Открыть в браузере
Открой http://localhost:3000 в браузере и проверь что всё работает.

## Настройка API ключей (файл .env):
- `DELLIN_APP_KEY` — ключ приложения Деловых Линий (получить на dev.dellin.ru)
- `DELLIN_LOGIN` / `DELLIN_PASSWORD` — логин/пароль от ДЛ
- `PEK_API_KEY` — ключ ПЭК (необязательно, публичный API работает без ключа)
- `SENDER_CITY` — ваш город отправления (по умолчанию Москва)

## Структура проекта:
```
kalTK/
├── server.js              # Express бэкенд (API товаров + прокси ДЛ/ПЭК)
├── package.json
├── .env                   # API ключи (НЕ коммитить!)
├── .env.example           # Шаблон .env
├── data/
│   └── products.json      # База товаров (JSON)
└── public/
    ├── index.html          # Главная страница
    ├── css/style.css       # Стили
    └── js/app.js           # Клиентский JS
```
