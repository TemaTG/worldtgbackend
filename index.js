require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.use(bodyParser.json());

// ======== Database connection ========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

// ensure table exists
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id        BIGINT NOT NULL,
      invoice_id     BIGINT NOT NULL,
      activation_id  BIGINT,
      status         TEXT   NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
  `);
})().catch(console.error);

const CRYPTO_API    = 'https://pay.crypt.bot/api/';
const CRYPTO_HEADER = { 'Crypto-Pay-API-Token': process.env.CRYPTOBOT_TOKEN };

// ======== 1. Mini‑app creates order ========
app.post('/create_order', async (req, res) => {
  try {
    const { user_id, country, service, price } = req.body;
    if (!user_id || !country || !service || !price)
      return res.status(400).json({ error: 'missing fields' });

    // 1.1 Create invoice in CryptoBot
    const invResp = await axios.post(
      CRYPTO_API + 'createInvoice',
      {
        asset: 'USDT',
        amount: price,
        description: `${country}-${service}`,
        hidden_message: 'Спасибо за покупку!',
        paid_btn_name: 'viewItem',
        paid_btn_url: 'https://t.me/ninecrp'
      },
      { headers: CRYPTO_HEADER }
    );

    const invoice = invResp.data.result;

    // 1.2 Save order
    await pool.query(
      'INSERT INTO orders (user_id, invoice_id, status) VALUES ($1,$2,$3)',
      [user_id, invoice.invoice_id, 'NEW']
    );

    res.json({ pay_url: invoice.pay_url });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: 'internal' });
  }
});

// ======== 2. Webhook from CryptoBot ========
app.post('/webhook/cryptobot', async (req, res) => {
  try {
    const { invoice_id, status } = req.body;
    if (status !== 'paid') return res.sendStatus(200);

    // move order NEW -> PAID (idempotent)
    const { rows } = await pool.query(
      "UPDATE orders SET status = 'PAID' WHERE invoice_id = $1 AND status = 'NEW' RETURNING *",
      [invoice_id]
    );
    if (!rows.length) return res.sendStatus(200);
    const order = rows[0];

    // 2.1 Buy number in SMSBower
    const url =
      'https://smsbower.online/stubs/handler_api.php' +
      `?api_key=${process.env.SMSBOWER_KEY}` +
      `&action=getNumber&service=${order.service}&country=${order.country}`;
    const smsResp = await axios.get(url);
    const txt = smsResp.data;

    if (txt.startsWith('ACCESS_NUMBER:')) {
      const [, activationId, number] = txt.split(':');
      await pool.query(
        "UPDATE orders SET activation_id = $1, status = 'WAIT_CODE' WHERE id = $2",
        [activationId, order.id]
      );

      await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
        chat_id: order.user_id,
        text: `Ваш номер: +${number}\nКод придёт в следующем сообщении`
      });
    } else {
      await pool.query("UPDATE orders SET status = 'FAILED' WHERE id = $1", [order.id]);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Backend listening on port', PORT));
