# WorldTG Backend – Render Auto‑Deploy

Полностью автоматический backend + воркер для Telegram Mini App **WorldTG**  
(оплаты через CryptoBot, покупка номеров через SMSBower, выдача кода в Telegram).

## 1. Локальный запуск

```bash
cp .env.example .env           # вставь свои токены и DATABASE_URL
npm install
npm run start                  # сервис  http://localhost:3000
npm run worker                 # воркер, параллельно
```

Для тестов вебхуков локально можно пробросить порт через `ngrok`:

```bash
ngrok http 3000
# скопируй HTTPS‑URL и поставь в CryptoBot → Edit Webhook
```

## 2. Деплой на Render

1. Fork / залей репозиторий в GitHub.  
2. В Render:
   * **New ↠ Web Service** – Build Cmd `npm i`, Start Cmd `npm start`.  
   * **+ Add Environment Variable** – перенеси все из `.env.example`.  
3. **New ↠ Background Worker** – Build Cmd `npm i`, Start Cmd `npm run worker`.  
4. Добавь URL `https://<service>.onrender.com/webhook/cryptobot` в настройках @CryptoBot.  
5. Готово! Оплата → номер → код → автопополнение баланса.

## 3. База данных

Render имеет бесплатный PostgreSQL Add‑On. После подключения скопируй DSN в `DATABASE_URL`.  
Таблица `orders` создаётся автоматически при первом старте.

## 4. Что дальше

* **Рефанды** — допиши функцию `cancelAndRefund`, если код не пришёл.  
* **Мониторинг** — Render Metrics + Logtail или любая APM.  
* **Очередь задач** — для масштабирования можно вынести polling в BullMQ + Redis Cloud.

Enjoy 🚀
