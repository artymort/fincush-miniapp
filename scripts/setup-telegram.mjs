const required = [
  "TELEGRAM_BOT_TOKEN",
  "ALLOWED_TELEGRAM_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "MINI_APP_URL",
  "WORKER_API_URL",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.ALLOWED_TELEGRAM_ID;
const miniAppUrlValue = new URL(process.env.MINI_APP_URL);
miniAppUrlValue.searchParams.set("v", "20260823-4");
const miniAppUrl = miniAppUrlValue.toString();
const workerUrl = process.env.WORKER_API_URL.replace(/\/$/, "");
const api = `https://api.telegram.org/bot${token}`;

async function telegram(method, payload) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${method}: ${result.description || response.statusText}`);
  return result.result;
}

await telegram("setWebhook", {
  url: `${workerUrl}/telegram/webhook`,
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ["message"],
  drop_pending_updates: false,
});

await telegram("setChatMenuButton", {
  chat_id: chatId,
  menu_button: {
    type: "web_app",
    text: "Открыть Fincush",
    web_app: { url: miniAppUrl },
  },
});

await telegram("setMyCommands", {
  commands: [
    { command: "start", description: "Открыть Fincush" },
    { command: "app", description: "Показать кнопку Mini App" },
  ],
  scope: { type: "chat", chat_id: chatId },
});

await telegram("sendMessage", {
  chat_id: chatId,
  text: "Fincush подключён. Mini App доступен по кнопке ниже.",
  reply_markup: {
    inline_keyboard: [[{ text: "Открыть Fincush", web_app: { url: miniAppUrl } }]],
  },
});

console.log("Telegram webhook and personal menu button configured.");
