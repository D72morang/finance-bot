const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const http = require('http');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Ignore 409 conflict during redeploys — resolves itself
bot.on('polling_error', (err) => {
  console.log('Polling error:', err.code);
});

bot.on('message', async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract expense from this message. Return ONLY valid JSON, no markdown, no code blocks. Keys: amount (number), currency (IDR/USD/SGD), category (Food/Transport/Entertainment/Shopping/Health/Business/Other), note (short description).

Message: "${text}"`
      }]
    });

    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(raw);

    await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({
        ...json,
        timestamp: new Date().toISOString(),
        raw: text
      })
    });

   const now = new Date();
const pad = n => String(n).padStart(2,'0');
const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
const kodeTransaksi = `${msg.from.id}x${String(now.getFullYear()).slice(2)}${pad(now.getMonth()+1)}${pad(now.getDate())}y${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const kategoriMap = {
  Food:'Makan & Minum', Transport:'Transportasi', Entertainment:'Hiburan',
  Shopping:'Belanja', Health:'Kesehatan', Business:'Bisnis', Other:'Lainnya'
};
const kategori = kategoriMap[json.category] || json.category;

bot.sendMessage(msg.chat.id,
  `✅ Transaksi kamu berhasil dicatat!\n\n` +
  `User ID: ${msg.from.id}\n` +
  `Kode Transaksi: ${kodeTransaksi}\n\n` +
  `Toko/Sumber: ${json.note}\n` +
  `Items: ${json.note}\n` +
  `Total: -${Number(json.amount).toLocaleString('id-ID')}\n` +
  `Tanggal: ${dateStr}\n` +
  `Kategori: ${kategori}`
);
  } catch (err) {
    console.error('Full error:', err);
bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    bot.sendMessage(msg.chat.id, '❌ Something went wrong. Please try again.');
  }
});

http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);