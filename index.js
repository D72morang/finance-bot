const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const http = require('http');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', err => console.log('Polling error:', err.code));

const pendingRegistration = {};

// ── HELPER: check if user is registered ──
async function checkUser(telegramId) {
  try {
    const res = await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({ type: 'check_user', telegramId })
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) {
    console.error('checkUser error:', e.message);
    return { registered: false };
  }
}

// ── HELPER: register new user ──
async function registerUser(telegramId, name) {
  try {
    const res = await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({ type: 'register', telegramId, name })
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) {
    console.error('registerUser error:', e.message);
    return { success: false };
  }
}

// ── /start command ──
bot.onText(/\/start/, async (msg) => {
  const telegramId = msg.from.id;
  const firstName = msg.from.first_name || 'Pengguna';

  const user = await checkUser(telegramId);

  if (user.registered) {
    bot.sendMessage(msg.chat.id,
      `👋 Selamat datang kembali, *${user.name}*!\n\n` +
      `🆔 User ID: \`${user.userId}\`\n` +
      `📦 Plan: ${user.plan === 'free' ? 'Free' : '⭐ Premium'}\n\n` +
      `Langsung catat pengeluaran kamu!\nContoh: _makan siang 75k_ atau _bensin 50000_`,
      { parse_mode: 'Markdown' }
    );
  } else {
    pendingRegistration[telegramId] = { step: 'waiting_name' };
    bot.sendMessage(msg.chat.id,
      `👋 Halo *${firstName}*! Selamat datang di Finance Tracker Bot 💰\n\n` +
      `Bot ini membantu kamu mencatat pengeluaran harian otomatis ke Google Sheets.\n\n` +
      `Untuk mulai, *kirim nama lengkap kamu:*`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /myid command ──
bot.onText(/\/myid/, async (msg) => {
  const user = await checkUser(msg.from.id);
  if (user.registered) {
    bot.sendMessage(msg.chat.id,
      `🆔 *User ID kamu:* \`${user.userId}\`\n👤 Nama: ${user.name}\n📦 Plan: ${user.plan}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(msg.chat.id, '❌ Kamu belum terdaftar. Ketik /start untuk mendaftar.');
  }
});

// ── Main message handler ──
bot.on('message', async (msg) => {
  const text = msg.text;
  const telegramId = msg.from.id;
  if (!text || text.startsWith('/')) return;

  // ── Handle registration flow ──
  if (pendingRegistration[telegramId]) {
    const state = pendingRegistration[telegramId];

    if (state.step === 'waiting_name') {
      const name = text.trim();
      const result = await registerUser(telegramId, name);
      delete pendingRegistration[telegramId];

      if (result.success) {
        if (ADMIN_ID) {
          bot.sendMessage(ADMIN_ID,
            `🆕 *User baru daftar!*\nNama: ${name}\nUser ID: ${result.userId}\nTelegram ID: ${telegramId}`,
            { parse_mode: 'Markdown' }
          );
        }
        bot.sendMessage(msg.chat.id,
          `✅ *Pendaftaran berhasil!*\n\n` +
          `👤 Nama: *${name}*\n` +
          `🆔 User ID: \`${result.userId}\`\n` +
          `📦 Plan: Free\n` +
          `📅 Terdaftar: ${new Date().toLocaleDateString('id-ID')}\n\n` +
          `Sekarang kamu bisa mulai mencatat pengeluaran!\n\n` +
          `*Contoh:*\n` +
          `• _makan siang 75k_\n` +
          `• _bensin 50000_\n` +
          `• _grab ke kantor 35k_\n` +
          `• _dinner $20 usd_`,
          { parse_mode: 'Markdown' }
        );
      } else if (result.reason === 'already_registered') {
        bot.sendMessage(msg.chat.id,
          `ℹ️ Kamu sudah terdaftar!\n🆔 User ID: \`${result.user.userId}\``,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(msg.chat.id,
          '❌ Pendaftaran gagal. Coba ketik /start lagi ya!'
        );
      }
      return;
    }
  }

  // ── Check registration before processing expense ──
  const user = await checkUser(telegramId);
  if (!user.registered) {
    bot.sendMessage(msg.chat.id,
      '❌ Kamu belum terdaftar.\n\nKetik /start untuk mendaftar terlebih dahulu.'
    );
    return;
  }

  // ── Process expense ──
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract expense from this message. Return ONLY valid JSON, no markdown, no code blocks. Keys: amount (number), currency (IDR/USD/SGD), category (Food/Transport/Entertainment/Shopping/Health/Business/Other), note (short description in Bahasa Indonesia).

Message: "${text}"`
      }]
    });

    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(raw);

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const kodeTransaksi = `${user.userId}x${String(now.getFullYear()).slice(2)}${pad(now.getMonth()+1)}${pad(now.getDate())}y${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const kategoriMap = {
      Food: 'Makan & Minum', Transport: 'Transportasi',
      Entertainment: 'Hiburan', Shopping: 'Belanja',
      Health: 'Kesehatan', Business: 'Bisnis', Other: 'Lainnya'
    };

    await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({
        ...json,
        type: 'transaction',
        userId: user.userId,
        telegramId,
        timestamp: now.toISOString(),
        raw: text
      })
    });

    bot.sendMessage(msg.chat.id,
      `✅ *Transaksi kamu berhasil dicatat!*\n\n` +
      `User ID: \`${user.userId}\`\n` +
      `Kode Transaksi: \`${kodeTransaksi}\`\n\n` +
      `Toko/Sumber: ${json.note}\n` +
      `Items: ${json.note}\n` +
      `Total: -${Number(json.amount).toLocaleString('id-ID')}\n` +
      `Tanggal: ${dateStr}\n` +
      `Kategori: ${kategoriMap[json.category] || json.category}`,
      { parse_mode: 'Markdown' }
    );

  } catch (err) {
    console.error('Error:', err.message);
    bot.sendMessage(msg.chat.id, '❌ Gagal memproses. Coba lagi ya!');
  }
});
bot.onText(/\/dashboard/, async (msg) => {
  const user = await checkUser(msg.from.id);
  if (!user.registered) {
    bot.sendMessage(msg.chat.id, '❌ Kamu belum terdaftar. Ketik /start untuk mendaftar.');
    return;
  }
  bot.sendMessage(msg.chat.id, '📊 Buka dashboard pengeluaran kamu:', {
    reply_markup: {
      inline_keyboard: [[{
        text: '📊 Lihat Dashboard',
        web_app: { url: 'https://d72morang.github.io/finance-bot/webapp.html' }
      }]]
    }
  });
});
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);