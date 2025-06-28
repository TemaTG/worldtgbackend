require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

const CRYPTO_API    = 'https://pay.crypt.bot/api/';
const CRYPTO_HEADER = { 'Crypto-Pay-API-Token': process.env.CRYPTOBOT_TOKEN };

async function pollSmsCodes() {
  const { rows } = await pool.query("SELECT * FROM orders WHERE status = 'WAIT_CODE'");
  for (const o of rows) {
    try {
      const resp = await axios.get('https://smsbower.online/stubs/handler_api.php', {
        params: {
          api_key: process.env.SMSBOWER_KEY,
          action: 'getStatus',
          id: o.activation_id
        }
      });
      const txt = resp.data;

      if (txt.startsWith('STATUS_OK:')) {
        const code = txt.split(':')[1];

        await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
          chat_id: o.user_id,
          text: `Код активации: ${code}`
        });

        await pool.query("UPDATE orders SET status = 'DONE' WHERE id = $1", [o.id]);
      } else {
        // timeout logic
        const timeoutMs = parseInt(process.env.TIMEOUT_MS || '120000', 10);
        if (Date.now() - new Date(o.created_at).getTime() > timeoutMs) {
          await cancelAndRefund(o);
        }
      }
    } catch (err) {
      console.error('pollSmsCodes error', err);
    }
  }
}

async function cancelAndRefund(order) {
  try {
    // cancel in SMSBower
    await axios.get('https://smsbower.online/stubs/handler_api.php', {
      params: {
        api_key: process.env.SMSBOWER_KEY,
        action: 'setStatus',
        status: 'cancel',
        id: order.activation_id
      }
    });

    // TODO: implement refund (transfer or createCheck)
    await pool.query("UPDATE orders SET status = 'REFUNDED' WHERE id = $1", [order.id]);
  } catch (e) {
    console.error('cancelAndRefund error', e);
  }
}

async function topupIfNeeded() {
  try {
    const balRes = await axios.get('https://smsbower.online/stubs/handler_api.php', {
      params: {
        api_key: process.env.SMSBOWER_KEY,
        action: 'getBalance'
      }
    });
    const balance = parseFloat(balRes.data.split(':')[1]);
    const threshold = parseFloat(process.env.TOPUP_THRESHOLD || '20');

    if (balance < threshold) {
      const walletRes = await axios.get(
        'https://smsbower.online/api/payment/getActualWalletAddress',
        {
          params: {
            api_key: process.env.SMSBOWER_KEY,
            coin: 'usdt',
            network: 'tron'
          }
        }
      );
      const wallet = walletRes.data.wallet_address;
      const amount = parseFloat(process.env.TOPUP_AMOUNT || '50');

      await axios.post(
        CRYPTO_API + 'transfer',
        { asset: 'USDT', amount, to: wallet, spend_id: `REFILL_${Date.now()}` },
        { headers: CRYPTO_HEADER }
      );

      console.log(`Sent ${amount} USDT to SMSBower wallet`);
    }
  } catch (err) {
    console.error('topupIfNeeded error', err);
  }
}

setInterval(pollSmsCodes, 4_000);   // every 4s
setInterval(topupIfNeeded, 60_000); // every 60s

console.log('Worker started');
