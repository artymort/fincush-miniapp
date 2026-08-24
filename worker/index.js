const TIME_ZONE = "Asia/Yekaterinburg";
const MORNING_CRON = "0 6 * * *";
const EVENING_CRON = "0 15 * * *";
const MAX_INIT_DATA_AGE_SECONDS = 7 * 24 * 60 * 60;

function createInitialState() {
  return {
    startingBalance: 495.28,
    goal: 30000,
    dailyTarget: 250,
    startDate: "2026-08-23",
    deadline: "2026-12-23",
    eveningReminder: true,
    habit: {
      rating: 50,
      reserveRubles: 0,
      missedStreak: 0,
      lastChange: 0,
    },
    processedDays: [],
    transactions: [
      {
        id: "initial-balance",
        type: "initial",
        amount: 495.28,
        date: "2026-08-22T05:00:00.000Z",
        title: "Стартовый баланс",
      },
    ],
  };
}

function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00+05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function currentBalance(state) {
  return state.transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function amountOn(state, day) {
  return state.transactions
    .filter((item) => item.type === "deposit" && dateKey(new Date(item.date)) === day)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function addDeposit(state, { amount, id = crypto.randomUUID(), date = new Date().toISOString() }) {
  state.transactions ||= [];
  state.habit ||= { rating: 50, reserveRubles: 0, missedStreak: 0, lastChange: 0 };

  const existing = state.transactions.find((item) => item.id === id);
  if (existing) return { state, transaction: existing, created: false };

  const day = dateKey(new Date(date));
  const before = amountOn(state, day);
  const after = before + amount;
  const target = Math.max(50, Number(state.dailyTarget || 250));
  const extraBefore = Math.max(0, before - target);
  const extraAfter = Math.max(0, after - target);
  const transaction = {
    id,
    type: "deposit",
    amount: Math.round(amount * 100) / 100,
    date,
    title: "Пополнение накопительного счета",
  };

  state.transactions.push(transaction);
  state.habit.reserveRubles = Number(state.habit.reserveRubles || 0) + extraAfter - extraBefore;

  if (before < target && after >= target) {
    state.habit.rating = Math.min(100, Number(state.habit.rating || 0) + 2);
    state.habit.lastChange = 2;
    state.habit.missedStreak = 0;
  }

  return { state, transaction, created: true };
}

function removeDeposit(state, transactionId) {
  state.transactions ||= [];
  state.habit ||= { rating: 50, reserveRubles: 0, missedStreak: 0, lastChange: 0 };
  const index = state.transactions.findIndex(
    (item) => item.id === transactionId && item.type === "deposit",
  );
  if (index < 0) return null;

  const transaction = state.transactions[index];
  const day = dateKey(new Date(transaction.date));
  const before = amountOn(state, day);
  const after = Math.max(0, before - Number(transaction.amount || 0));
  const target = Math.max(50, Number(state.dailyTarget || 250));
  const extraBefore = Math.max(0, before - target);
  const extraAfter = Math.max(0, after - target);

  state.transactions.splice(index, 1);
  state.habit.reserveRubles = Math.max(
    0,
    Number(state.habit.reserveRubles || 0) - (extraBefore - extraAfter),
  );
  if (before >= target && after < target) {
    state.habit.rating = Math.max(0, Number(state.habit.rating || 0) - 2);
  }
  state.habit.lastChange = 0;
  return transaction;
}

function shouldSendMorning(state, today) {
  return today >= state.startDate && amountOn(state, today) === 0;
}

function daysUntil(deadline, today = dateKey()) {
  const start = new Date(`${today}T12:00:00+05:00`);
  const end = new Date(`${deadline}T12:00:00+05:00`);
  return Math.max(1, Math.ceil((end - start) / 86400000));
}

function suggestDailyTarget(state, goal, deadline, today = dateKey()) {
  const remaining = Math.max(0, Number(goal) - currentBalance(state));
  if (!remaining) return Number(state.dailyTarget || 250);
  return Math.max(50, Math.ceil(remaining / daysUntil(deadline, today) / 50) * 50);
}

function publicState(state) {
  return {
    startingBalance: Number(state.startingBalance),
    goal: Number(state.goal),
    dailyTarget: Number(state.dailyTarget),
    startDate: state.startDate,
    deadline: state.deadline,
    eveningReminder: Boolean(state.eveningReminder),
    habit: {
      rating: Number(state.habit?.rating || 0),
      reserveRubles: Number(state.habit?.reserveRubles || 0),
      missedStreak: Number(state.habit?.missedStreak || 0),
      lastChange: Number(state.habit?.lastChange || 0),
    },
    transactions: Array.isArray(state.transactions) ? state.transactions : [],
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export class FincushState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async load() {
    const stored = await this.ctx.storage.get("state");
    if (stored) return stored;
    const initial = createInitialState();
    await this.ctx.storage.put("state", initial);
    return initial;
  }

  async save(state) {
    await this.ctx.storage.put("state", state);
    return state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const state = await this.load();

    if (request.method === "GET" && path === "/state") {
      return json({ state: publicState(state) });
    }

    if (request.method === "POST" && path === "/deposit") {
      const body = await readJson(request);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
        return json({ error: "Некорректная сумма" }, 400);
      }

      const clientId = String(body.clientId || "").trim();
      if (clientId && !/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) {
        return json({ error: "Некорректный идентификатор операции" }, 400);
      }

      const requestedDate = body.occurredAt ? new Date(body.occurredAt) : new Date();
      const now = new Date();
      const validDate = Number.isFinite(requestedDate.getTime()) &&
        requestedDate.getTime() <= now.getTime() + 5 * 60 * 1000 &&
        dateKey(requestedDate) >= state.startDate;
      if (!validDate) return json({ error: "Некорректная дата операции" }, 400);

      const added = addDeposit(state, {
        amount,
        id: clientId || crypto.randomUUID(),
        date: requestedDate.toISOString(),
      });

      await this.save(state);
      return json({
        state: publicState(state),
        created: added.created,
        transaction: added.transaction,
      });
    }

    if (request.method === "DELETE" && path.startsWith("/deposit/")) {
      const transactionId = decodeURIComponent(path.slice("/deposit/".length));
      const deleted = removeDeposit(state, transactionId);
      if (!deleted) return json({ error: "Пополнение не найдено" }, 404);
      await this.save(state);
      return json({ state: publicState(state), deletedId: transactionId });
    }

    if (request.method === "POST" && path === "/goal") {
      const body = await readJson(request);
      const goal = Math.round(Number(body.goal));
      const deadline = String(body.deadline || "");
      const today = dateKey();

      if (!Number.isFinite(goal) || goal <= currentBalance(state)) {
        return json({ error: "Цель должна быть больше текущего баланса" }, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline <= today) {
        return json({ error: "Дата завершения должна быть позже сегодняшней" }, 400);
      }

      state.goal = goal;
      state.deadline = deadline;
      state.dailyTarget = suggestDailyTarget(state, goal, deadline, today);
      await this.save(state);
      return json({ state: publicState(state) });
    }

    if (request.method === "POST" && path === "/settings") {
      const body = await readJson(request);
      if (typeof body.eveningReminder === "boolean") state.eveningReminder = body.eveningReminder;
      await this.save(state);
      return json({ state: publicState(state) });
    }

    if (request.method === "POST" && path === "/reset") {
      const initial = createInitialState();
      await this.save(initial);
      return json({ state: publicState(initial) });
    }

    if (request.method === "POST" && path === "/morning") {
      const body = await readJson(request);
      const today = String(body.today || dateKey());
      const yesterday = shiftDate(today, -1);
      let previousStatus = "none";

      state.habit.lastChange = 0;
      state.processedDays ||= [];

      if (
        yesterday >= state.startDate &&
        !state.processedDays.includes(yesterday)
      ) {
        const deposited = amountOn(state, yesterday);
        const target = Math.max(50, Number(state.dailyTarget || 250));

        if (deposited < target) {
          if (Number(state.habit.reserveRubles || 0) >= target) {
            state.habit.reserveRubles -= target;
            previousStatus = "protected";
          } else {
            state.habit.rating = Math.max(0, Number(state.habit.rating || 0) - 5);
            state.habit.lastChange = -5;
            state.habit.missedStreak = Number(state.habit.missedStreak || 0) + 1;
            previousStatus = "missed";
          }
        } else {
          state.habit.missedStreak = 0;
          previousStatus = "completed";
        }

        state.processedDays.push(yesterday);
        state.processedDays = state.processedDays.slice(-180);
        await this.save(state);
      }

      return json({
        shouldSend: shouldSendMorning(state, today),
        previousStatus,
        state: publicState(state),
      });
    }

    if (request.method === "POST" && path === "/evening") {
      const body = await readJson(request);
      const today = String(body.today || dateKey());
      return json({
        shouldSend:
          today >= state.startDate &&
          Boolean(state.eveningReminder) &&
          amountOn(state, today) === 0,
        state: publicState(state),
      });
    }

    return json({ error: "Not found" }, 404);
  }
}

function stateStub(env) {
  return env.FINCUSH_STATE.get(env.FINCUSH_STATE.idFromName("personal"));
}

async function importHmacKey(raw) {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function calculateInitDataHash(initData, botToken) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") || "";
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const firstKey = await importHmacKey(encoder.encode("WebAppData"));
  const secret = await crypto.subtle.sign("HMAC", firstKey, encoder.encode(botToken));
  const validationKey = await importHmacKey(secret);
  const calculatedHash = bytesToHex(
    await crypto.subtle.sign("HMAC", validationKey, encoder.encode(dataCheckString)),
  );
  return { calculatedHash, receivedHash };
}

async function validateInitData(initData, env) {
  if (!initData || !env.TELEGRAM_BOT_TOKEN) throw new Error("missing_init_data");
  const { calculatedHash, receivedHash } = await calculateInitDataHash(
    initData,
    env.TELEGRAM_BOT_TOKEN,
  );

  if (!timingSafeEqual(calculatedHash, receivedHash.toLowerCase())) throw new Error("invalid_hash");

  const params = new URLSearchParams(initData);
  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age < -60 || age > MAX_INIT_DATA_AGE_SECONDS) {
    throw new Error("expired_init_data");
  }

  const user = JSON.parse(params.get("user") || "{}");
  if (!user.id || String(user.id) !== String(env.ALLOWED_TELEGRAM_ID)) {
    throw new Error("forbidden_user");
  }
  return user;
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const production = (() => {
    try {
      return new URL(env.MINI_APP_URL).origin;
    } catch {
      return "";
    }
  })();
  if (origin === production || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
  return production;
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    "Vary": "Origin",
  };
}

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
  return result.result;
}

function miniAppUrl(env, action = "", amount = 0) {
  const url = new URL(env.MINI_APP_URL);
  url.searchParams.set("v", "20260824-8");
  if (action) url.searchParams.set("action", action);
  if (amount > 0) url.searchParams.set("amount", String(amount));
  return url.toString();
}

function openAppKeyboard(env, options = {}) {
  const { text = "Открыть Fincush", action = "", amount = 0 } = options;
  return {
    inline_keyboard: [[{ text, web_app: { url: miniAppUrl(env, action, amount) } }]],
  };
}

async function handleTelegramUpdate(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const update = await readJson(request);
  const message = update.message;
  if (!message?.from?.id || String(message.from.id) !== String(env.ALLOWED_TELEGRAM_ID)) {
    return json({ ok: true });
  }

  const text = String(message.text || "");
  if (text.startsWith("/start") || text.startsWith("/app")) {
    await telegramApi(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "Fincush помогает ежедневно пополнять финансовую подушку и следить за прогрессом.",
      reply_markup: openAppKeyboard(env),
    });
  }
  return json({ ok: true });
}

function reminderText(result, evening = false) {
  const state = result.state;
  const balance = currentBalance(state).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const target = Number(state.dailyTarget).toLocaleString("ru-RU");

  if (evening) {
    return `Сегодня пополнение ещё не подтверждено. Если перевод уже сделан, отметьте его в Fincush. План на день — ${target} ₽.`;
  }

  let prefix = "";
  if (result.previousStatus === "protected") prefix = "Вчера был день без полного взноса, но резерв защитил рейтинг.\n\n";
  if (result.previousStatus === "missed") {
    const streak = Number(state.habit.missedStreak || 1);
    prefix = streak >= 3
      ? `Уже ${streak} дня подряд без полного взноса. Рейтинг снижен.\n\n`
      : "Вчера был пропуск — рейтинг снижен на 5 пунктов.\n\n";
  }
  return `${prefix}Ежедневный шаг — ${target} ₽. Сейчас в подушке ${balance} ₽.`;
}

function depositConfirmationText(state, transaction) {
  const amount = Number(transaction.amount).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  });
  const balance = currentBalance(state).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Пополнение подтверждено: <b>+${amount} ₽</b>\nБаланс подушки: <b>${balance} ₽</b>`;
}

async function sendScheduledReminder(env, cron, scheduledTime) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.ALLOWED_TELEGRAM_ID) return;
  const today = dateKey(new Date(scheduledTime));
  const path = cron === EVENING_CRON ? "/evening" : "/morning";
  const response = await stateStub(env).fetch(`https://state${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ today }),
  });
  const result = await response.json();
  if (!result.shouldSend) return;

  await telegramApi(env, "sendMessage", {
    chat_id: env.ALLOWED_TELEGRAM_ID,
    text: reminderText(result, cron === EVENING_CRON),
    reply_markup: openAppKeyboard(env, {
      text: cron === EVENING_CRON ? "Подтвердить перевод" : `Внести ${Number(result.state.dailyTarget).toLocaleString("ru-RU")} ₽`,
      action: "deposit",
      amount: Number(result.state.dailyTarget),
    }),
  });
}

async function handleApi(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    await validateInitData(request.headers.get("X-Telegram-Init-Data"), env);
  } catch (error) {
    const status = error.message === "forbidden_user" ? 403 : 401;
    const message = status === 403
      ? "Доступ разрешён только владельцу"
      : error.message === "expired_init_data"
        ? "Сессия Telegram устарела. Закройте Mini App и откройте её снова"
        : "Не удалось проверить сессию Telegram";
    return json({ error: message }, status, cors);
  }

  const url = new URL(request.url);
  let route = {
    "/api/state": "/state",
    "/api/deposits": "/deposit",
    "/api/goal": "/goal",
    "/api/settings": "/settings",
    "/api/reset": "/reset",
  }[url.pathname];
  if (request.method === "DELETE" && url.pathname.startsWith("/api/deposits/")) {
    route = `/deposit/${encodeURIComponent(decodeURIComponent(url.pathname.slice("/api/deposits/".length)))}`;
  }
  if (!route) return json({ error: "Not found" }, 404, cors);

  const body = request.method === "GET" ? undefined : await request.text();
  const response = await stateStub(env).fetch(`https://state${route}`, {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    body,
  });
  const result = await response.json();

  if (
    response.ok &&
    request.method === "POST" &&
    route === "/deposit" &&
    result.created &&
    result.transaction
  ) {
    try {
      await telegramApi(env, "sendMessage", {
        chat_id: env.ALLOWED_TELEGRAM_ID,
        text: depositConfirmationText(result.state, result.transaction),
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error("Deposit notification failed", error);
    }
  }

  return json(result, response.status, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "fincush-bot", time: new Date().toISOString() });
    }
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      return handleTelegramUpdate(request, env);
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return json({ error: "Not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron !== MORNING_CRON && controller.cron !== EVENING_CRON) return;
    ctx.waitUntil(sendScheduledReminder(env, controller.cron, controller.scheduledTime));
  },
};

export const __test = {
  addDeposit,
  amountOn,
  calculateInitDataHash,
  createInitialState,
  currentBalance,
  dateKey,
  depositConfirmationText,
  shiftDate,
  shouldSendMorning,
  suggestDailyTarget,
  removeDeposit,
};
