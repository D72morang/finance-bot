const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL;

bot.on('message', async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Extract expense from this message. Return ONLY valid JSON with keys: amount (number), currency (IDR/USD/SGD/etc), category (Food/Transport/Entertainment/Shopping/Health/Business/Other), note (short description).
      
Message: "${text}"`
    }]
  });

  const json = JSON.parse(res.content[0].text);
  
  await fetch(SHEETS_URL, {
    method: 'POST',
    body: JSON.stringify({
      ...json,
      timestamp: new Date().toISOString(),
      raw: text
    })
  });

  bot.sendMessage(msg.chat.id, 
    `✅ Logged!\n💰 ${json.amount.toLocaleString()} ${json.currency}\n🏷 ${json.category}\n📝 ${json.note}`
  );
});

try {
    // ... all the code above ...
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Sorry, I couldn\'t understand that. Try: "lunch 85k" or "grab 45k idr"');
  }