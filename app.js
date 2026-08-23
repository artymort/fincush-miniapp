const STORAGE_KEY = "fincush-prototype-v3";
const DEFAULT_DAILY_TARGET = 250;
const API_URL = String(
  globalThis.FINCUSH_CONFIG?.API_URL ||
    document.querySelector('meta[name="fincush-api-url"]')?.content ||
    "",
).replace(/\/$/, "");

const INITIAL_STATE = {
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
  transactions: [
    {
      id: "initial-balance",
      type: "initial",
      amount: 495.28,
      date: "2026-08-22T10:00:00+05:00",
      title: "Стартовый баланс",
    },
  ],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function cloneInitialState() {
  return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return cloneInitialState();
    return {
      ...cloneInitialState(),
      ...saved,
      habit: { ...INITIAL_STATE.habit, ...(saved.habit || {}) },
      transactions: Array.isArray(saved.transactions)
        ? saved.transactions
        : cloneInitialState().transactions,
    };
  } catch {
    return cloneInitialState();
  }
}

let state = loadState();
let selectedAmount = Number(state.dailyTarget || DEFAULT_DAILY_TARGET);
let backendMode = false;
let pendingDeposit = null;

function telegramWebApp() {
  return globalThis.Telegram?.WebApp || null;
}

function telegramInitData() {
  return String(telegramWebApp()?.initData || "");
}

function applyServerState(nextState) {
  state = {
    ...cloneInitialState(),
    ...(nextState || {}),
    habit: { ...INITIAL_STATE.habit, ...(nextState?.habit || {}) },
    transactions: Array.isArray(nextState?.transactions)
      ? nextState.transactions
      : cloneInitialState().transactions,
  };
  selectedAmount = Number(state.dailyTarget || DEFAULT_DAILY_TARGET);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function apiRequest(path, options = {}) {
  const initData = telegramInitData();
  if (!API_URL || !initData) throw new Error("Telegram backend is unavailable");

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Сервер временно недоступен");
  return result;
}

async function loadRemoteState() {
  if (!API_URL || !telegramInitData()) return false;
  const localState = state;
  const result = await apiRequest("/api/state");
  let remoteState = result.state;

  const remoteDeposits = () => remoteState.transactions.filter((item) => item.type === "deposit");
  const legacyDeposits = localState.transactions.filter((item) => {
    if (item.type !== "deposit") return false;
    const occurredAt = new Date(item.date);
    if (!Number.isFinite(occurredAt.getTime())) return false;
    if (dateKey(occurredAt) < remoteState.startDate) return false;
    return !remoteDeposits().some((remote) => {
      if (remote.id === item.id) return true;
      const sameAmount = Math.abs(Number(remote.amount) - Number(item.amount)) < 0.001;
      const timeDistance = Math.abs(new Date(remote.date) - occurredAt);
      return sameAmount && timeDistance < 5 * 60 * 1000;
    });
  });

  for (const transaction of legacyDeposits) {
    const safeId = /^[a-zA-Z0-9_-]{8,100}$/.test(String(transaction.id || ""))
      ? String(transaction.id)
      : `legacy-${new Date(transaction.date).getTime()}-${Math.round(Number(transaction.amount) * 100)}`;
    const synced = await apiRequest("/api/deposits", {
      method: "POST",
      body: JSON.stringify({
        amount: Number(transaction.amount),
        clientId: safeId,
        occurredAt: transaction.date,
      }),
    });
    remoteState = synced.state;
  }

  applyServerState(remoteState);
  backendMode = true;
  return true;
}

function saveState() {
  if (!backendMode) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function requireConnectedBackend() {
  if (telegramInitData() && !backendMode) {
    throw new Error("Нет связи с сервером. Закройте Mini App и откройте её снова из сообщения бота");
  }
}

function formatMoney(amount, digits = 2) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(amount || 0));
}

function formatCompactMoney(amount) {
  const digits = Number(amount) % 1 === 0 ? 0 : 2;
  return `${formatMoney(amount, digits)} ₽`;
}

function dateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

function dateLabel(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatCalendarDate(date, includeYear = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "numeric",
    month: "long",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(`${date}T12:00:00+05:00`));
}

function dailyTarget() {
  return Math.max(50, Number(state.dailyTarget || DEFAULT_DAILY_TARGET));
}

function quickAmounts() {
  const base = dailyTarget();
  const step = Math.max(50, Math.ceil((base * 0.2) / 50) * 50);
  return [base, base + step, base + step * 2];
}

function daysUntil(deadline) {
  const today = new Date(`${dateKey(new Date())}T12:00:00+05:00`);
  const end = new Date(`${deadline}T12:00:00+05:00`);
  return Math.max(1, Math.ceil((end - today) / 86400000));
}

function suggestedDailyTarget(goal, deadline) {
  const remaining = Math.max(0, Number(goal) - currentBalance());
  if (remaining <= 0) return dailyTarget();
  return Math.max(50, Math.ceil(remaining / daysUntil(deadline) / 50) * 50);
}

function sumByType(type) {
  return state.transactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
}

function currentBalance() {
  return state.transactions.reduce(
    (sum, transaction) => sum + Number(transaction.amount),
    0,
  );
}

function userDeposits() {
  return sumByType("deposit");
}

function earnedInterest() {
  return sumByType("interest");
}

function progressPercent() {
  return Math.min(100, (currentBalance() / state.goal) * 100);
}

function uniqueDepositDays() {
  return new Set(
    state.transactions
      .filter((transaction) => transaction.type === "deposit")
      .map((transaction) => dateKey(transaction.date)),
  ).size;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function renderGoalConfiguration() {
  const goalText = formatCompactMoney(state.goal);
  const amounts = quickAmounts();
  const base = amounts[0];
  const percentages = amounts.map((amount) => Math.round(((amount - base) / base) * 100));

  setText("#heroGoalValue", `Цель · ${goalText}`);
  setText("#activityGoalValue", `Цель · ${goalText}`);
  setText("#activityStartDate", `Старт · ${formatCalendarDate(state.startDate)}`);
  setText("#settingsGoalValue", goalText);
  setText(
    "#settingsGoalDates",
    `С ${formatCalendarDate(state.startDate)} по ${formatCalendarDate(state.deadline, true)}`,
  );

  amounts.forEach((amount, index) => {
    const quickButton = $$('[data-quick-amount]')[index];
    const optionButton = $$(".amount-option")[index];
    if (quickButton) quickButton.dataset.quickAmount = amount;
    if (optionButton) optionButton.dataset.amount = amount;
    setText(`#quickAmount${index + 1}`, formatCompactMoney(amount));
    setText(`#sheetAmount${index + 1}`, formatCompactMoney(amount));
  });
  setText("#quickBadge2", `+${percentages[1]}%`);
  setText("#quickBadge3", `+${percentages[2]}%`);
  setText("#sheetBadge2", `+${percentages[1]}%`);
  setText("#sheetBadge3", `+${percentages[2]}%`);
}

function render() {
  const balance = currentBalance();
  const remaining = Math.max(0, state.goal - balance);
  const progress = progressPercent();
  const balanceText = `${formatMoney(balance)} ₽`;

  ["#balanceValue", "#activityBalance", "#historyBalance"].forEach((selector) => {
    const element = $(selector);
    if (!element) return;
    element.textContent = balanceText;
    element.classList.toggle("is-long", balanceText.length >= 11);
    element.classList.toggle("is-very-long", balanceText.length >= 15);
  });

  ["#progressBar", "#settingsProgress", "#ratingBar"].forEach((selector) => {
    const element = $(selector);
    if (element && selector !== "#ratingBar") element.style.width = `${progress}%`;
  });

  const donut = $("#goalDonut");
  if (donut) donut.style.setProperty("--goal-progress", `${progress}%`);

  setText("#goalPercent", `${Math.round(progress)}%`);
  setText("#remainingValue", `Осталось ${formatCompactMoney(remaining)}`);
  setText("#myDeposits", formatCompactMoney(userDeposits()));
  setText("#interestEarned", formatCompactMoney(earnedInterest()));
  const reminder = $("#eveningReminder");
  if (reminder) reminder.checked = state.eveningReminder;

  renderGoalConfiguration();
  renderRating();
  renderWeek();
  renderTransactions();
  updatePaceText();
}

function pluralize(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderRating() {
  const rating = Math.max(0, Math.min(100, Number(state.habit.rating || 0)));
  const target = dailyTarget();
  const reserveDays = Math.floor(Number(state.habit.reserveRubles || 0) / target);
  const days = uniqueDepositDays();

  let label = "Привычка формируется";
  if (rating < 35) label = "Нужно восстановить ритм";
  if (rating >= 70) label = "Стабильный ритм";
  if (rating >= 90) label = "Высокая дисциплина";

  setText("#ratingScore", rating);
  setText("#homeRating", rating);
  setText("#reserveDays", reserveDays);
  setText("#homeReserve", reserveDays);
  setText("#depositDays", days);
  setText("#ratingLabel", label);
  setText(
    "#ratingChange",
    state.habit.lastChange > 0
      ? `+${state.habit.lastChange} за сегодня`
      : state.habit.lastChange < 0
        ? `${state.habit.lastChange} за пропуск`
        : "Без изменений сегодня",
  );

  const ratingBar = $("#ratingBar");
  if (ratingBar) ratingBar.style.width = `${rating}%`;

  const reserveRubles = Number(state.habit.reserveRubles || 0);
  const reserveRemainder = target - (reserveRubles % target || target);
  setText(
    "#reserveText",
    reserveDays > 0
      ? `${reserveDays} ${pluralize(reserveDays, "день", "дня", "дней")} можно пропустить без снижения рейтинга`
      : reserveRubles > 0
        ? `До защищенного дня осталось ${formatCompactMoney(reserveRemainder)}`
        : `Сумма сверх ${formatCompactMoney(target)} превращается в защиту от будущих пропусков`,
  );
}

function startOfWeek(reference = new Date()) {
  const localDate = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Yekaterinburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(reference) + "T12:00:00+05:00",
  );
  const day = localDate.getDay() || 7;
  localDate.setDate(localDate.getDate() - day + 1);
  return localDate;
}

function renderWeek() {
  const weekCard = $("#weekCard");
  if (!weekCard) return;

  const deposits = state.transactions.filter((transaction) => transaction.type === "deposit");
  const depositedDays = new Set(deposits.map((transaction) => dateKey(transaction.date)));
  const monday = startOfWeek();
  const today = dateKey(new Date());
  const dayNames = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
  let weekTotal = 0;

  weekCard.innerHTML = dayNames
    .map((name, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const key = dateKey(date);
      const hasDeposit = depositedDays.has(key);
      const amount = deposits
        .filter((transaction) => dateKey(transaction.date) === key)
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      weekTotal += amount;
      const classes = ["day-cell"];
      if (hasDeposit) classes.push("is-done");
      if (key === today) classes.push("is-today");
      return `<div class="${classes.join(" ")}"><span>${name}</span><strong>${date.getDate()}</strong></div>`;
    })
    .join("");

  setText("#weekTotal", formatCompactMoney(weekTotal));
}

function transactionMarkup(transaction) {
  const meta = {
    initial: { icon: "◎", title: transaction.title || "Стартовый баланс", className: "initial" },
    deposit: { icon: "+", title: transaction.title || "Пополнение", className: "deposit" },
    interest: { icon: "%", title: transaction.title || "Проценты банка", className: "interest" },
  }[transaction.type] || { icon: "·", title: transaction.title || "Операция", className: "initial" };

  const deleteButton = transaction.type === "deposit"
    ? `<button class="transaction-delete" type="button" data-delete-transaction="${transaction.id}" aria-label="Удалить пополнение">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>
      </button>`
    : "";

  return `
    <article class="transaction-item">
      <div class="transaction-icon ${meta.className}">${meta.icon}</div>
      <div class="transaction-copy">
        <strong>${meta.title}</strong>
        <span>${dateLabel(transaction.date)}</span>
      </div>
      <div class="transaction-actions">
        <div class="transaction-amount">+${formatCompactMoney(transaction.amount)}</div>
        ${deleteButton}
      </div>
    </article>`;
}

function renderTransactions() {
  const transactions = [...state.transactions].sort(
    (first, second) => new Date(second.date) - new Date(first.date),
  );
  const recent = $("#recentTransactions");
  const all = $("#allTransactions");
  if (recent) recent.innerHTML = transactions.slice(0, 3).map(transactionMarkup).join("");
  if (all) all.innerHTML = transactions.map(transactionMarkup).join("");
}

function updatePaceText() {
  const remaining = Math.max(0, state.goal - currentBalance());
  if (remaining <= 0) {
    setText("#paceText", "Цель достигнута — можно создать следующую");
    return;
  }
  const target = dailyTarget();
  const daysAtBase = Math.ceil(remaining / target);
  setText(
    "#paceText",
    `При взносе ${formatCompactMoney(target)} цель будет закрыта примерно через ${daysAtBase} ${pluralize(daysAtBase, "день", "дня", "дней")}`,
  );
}

function navigate(screenName) {
  $$(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === screenName));
  $$("[data-nav]").forEach((button) => button.classList.toggle("is-active", button.dataset.nav === screenName));
  const app = $(".mini-app");
  if (app) app.scrollTo({ top: 0, behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateConfirmLabel(amount) {
  const label = $("#confirmTopup span");
  if (!label) return;
  label.textContent = `Подтвердить ${formatCompactMoney(amount)}`;
}

function openSheet(amount = dailyTarget()) {
  selectedAmount = amount;
  $$(".amount-option").forEach((button) => button.classList.toggle("is-selected", Number(button.dataset.amount) === amount));
  const custom = $("#customAmount");
  if (custom) custom.value = "";
  updateConfirmLabel(amount);
  const sheet = $("#topupSheet");
  const backdrop = $("#sheetBackdrop");
  if (sheet) {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
  }
  if (backdrop) {
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("is-open"));
  }
  document.body.classList.add("sheet-open");
}

function closeSheet() {
  const sheet = $("#topupSheet");
  const backdrop = $("#sheetBackdrop");
  sheet?.classList.remove("is-open");
  backdrop?.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
  window.setTimeout(() => {
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }, 260);
}

function setGoalEditorError(message = "") {
  const error = $("#goalEditorError");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function updateGoalPreview() {
  const goal = Number(String($("#goalAmountInput")?.value || "").replace(/\s/g, "").replace(",", "."));
  const deadline = $("#goalDeadlineInput")?.value;
  if (!Number.isFinite(goal) || goal <= currentBalance() || !deadline) {
    setText("#goalDailyPreview", "—");
    return;
  }
  setText("#goalDailyPreview", formatCompactMoney(suggestedDailyTarget(goal, deadline)));
  setGoalEditorError();
}

function openGoalEditor() {
  closeSheet();
  const amountInput = $("#goalAmountInput");
  const deadlineInput = $("#goalDeadlineInput");
  if (amountInput) amountInput.value = String(Math.round(state.goal));
  if (deadlineInput) {
    deadlineInput.value = state.deadline;
    const tomorrow = new Date(`${dateKey(new Date())}T12:00:00+05:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    deadlineInput.min = dateKey(tomorrow);
  }
  setGoalEditorError();
  updateGoalPreview();

  const sheet = $("#goalEditorSheet");
  const backdrop = $("#goalSheetBackdrop");
  if (sheet) {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
  }
  if (backdrop) {
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("is-open"));
  }
  document.body.classList.add("sheet-open");
}

function closeGoalEditor() {
  const sheet = $("#goalEditorSheet");
  const backdrop = $("#goalSheetBackdrop");
  sheet?.classList.remove("is-open");
  backdrop?.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
  window.setTimeout(() => {
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }, 260);
}

async function saveGoalChanges() {
  const goal = Number(String($("#goalAmountInput")?.value || "").replace(/\s/g, "").replace(",", "."));
  const deadline = $("#goalDeadlineInput")?.value;
  const today = dateKey(new Date());

  if (!Number.isFinite(goal) || goal <= currentBalance()) {
    setGoalEditorError(`Цель должна быть больше текущего баланса — ${formatCompactMoney(currentBalance())}`);
    return;
  }
  if (!deadline || deadline <= today) {
    setGoalEditorError("Выберите дату позже сегодняшнего дня");
    return;
  }

  try {
    requireConnectedBackend();
    if (backendMode) {
      const result = await apiRequest("/api/goal", {
        method: "POST",
        body: JSON.stringify({ goal, deadline }),
      });
      applyServerState(result.state);
    } else {
      state.goal = Math.round(goal);
      state.deadline = deadline;
      state.dailyTarget = suggestedDailyTarget(state.goal, state.deadline);
      selectedAmount = dailyTarget();
      saveState();
    }
    render();
    closeGoalEditor();
    showToast(
      `Новый дневной план — ${formatCompactMoney(state.dailyTarget)}`,
      "Цель обновлена",
    );
  } catch (error) {
    setGoalEditorError(error.message || "Не удалось сохранить цель");
  }
}

function amountDepositedOn(day) {
  return state.transactions
    .filter((transaction) => transaction.type === "deposit" && dateKey(transaction.date) === day)
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
}

async function confirmTopup() {
  const customValue = Number(String($("#customAmount")?.value || "").replace(",", "."));
  const amount = customValue > 0 ? customValue : selectedAmount;
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Укажите сумму пополнения");
    return;
  }

  try {
    requireConnectedBackend();
    if (backendMode) {
      const now = new Date();
      if (!pendingDeposit || pendingDeposit.amount !== amount) {
        pendingDeposit = {
          amount,
          clientId: globalThis.crypto?.randomUUID?.() || `deposit-${Date.now()}`,
          occurredAt: now.toISOString(),
        };
      }
      const result = await apiRequest("/api/deposits", {
        method: "POST",
        body: JSON.stringify(pendingDeposit),
      });
      applyServerState(result.state);
      pendingDeposit = null;
    } else {
      const now = new Date();
      const today = dateKey(now);
      const before = amountDepositedOn(today);
      const after = before + amount;
      const target = dailyTarget();
      const extraBefore = Math.max(0, before - target);
      const extraAfter = Math.max(0, after - target);

      state.transactions.push({
        id: globalThis.crypto?.randomUUID?.() || `deposit-${Date.now()}`,
        type: "deposit",
        amount,
        date: now.toISOString(),
        title: "Пополнение накопительного счета",
      });
      state.habit.reserveRubles += extraAfter - extraBefore;

      if (before < target && after >= target) {
        state.habit.rating = Math.min(100, state.habit.rating + 2);
        state.habit.lastChange = 2;
        state.habit.missedStreak = 0;
      }
      saveState();
    }

    render();
    closeSheet();
    showToast(`${formatCompactMoney(amount)} учтены в накоплениях`);
    celebrate();
    telegramWebApp()?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    showToast(error.message || "Не удалось сохранить пополнение", "Ошибка");
  }
}

function removeLocalDeposit(transactionId) {
  const transaction = state.transactions.find(
    (item) => item.id === transactionId && item.type === "deposit",
  );
  if (!transaction) return false;

  const day = dateKey(transaction.date);
  const before = amountDepositedOn(day);
  const after = Math.max(0, before - Number(transaction.amount || 0));
  const target = dailyTarget();
  const extraBefore = Math.max(0, before - target);
  const extraAfter = Math.max(0, after - target);
  state.transactions = state.transactions.filter((item) => item.id !== transactionId);
  state.habit.reserveRubles = Math.max(
    0,
    Number(state.habit.reserveRubles || 0) - (extraBefore - extraAfter),
  );
  if (before >= target && after < target) {
    state.habit.rating = Math.max(0, Number(state.habit.rating || 0) - 2);
  }
  state.habit.lastChange = 0;
  saveState();
  return true;
}

function confirmAction(message) {
  const webApp = telegramWebApp();
  if (webApp?.showConfirm) {
    return new Promise((resolve) => webApp.showConfirm(message, resolve));
  }
  return Promise.resolve(globalThis.confirm(message));
}

async function deleteTransaction(transactionId) {
  const transaction = state.transactions.find(
    (item) => item.id === transactionId && item.type === "deposit",
  );
  if (!transaction) return;
  const confirmed = await confirmAction(
    `Удалить пополнение ${formatCompactMoney(transaction.amount)}? Баланс и начисленный рейтинг будут пересчитаны.`,
  );
  if (!confirmed) return;

  try {
    requireConnectedBackend();
    if (backendMode) {
      const result = await apiRequest(`/api/deposits/${encodeURIComponent(transactionId)}`, {
        method: "DELETE",
      });
      applyServerState(result.state);
    } else {
      removeLocalDeposit(transactionId);
    }
    render();
    showToast(`${formatCompactMoney(transaction.amount)} удалены из накоплений`, "Операция отменена");
    telegramWebApp()?.HapticFeedback?.notificationOccurred("warning");
  } catch (error) {
    showToast(error.message || "Не удалось удалить операцию", "Ошибка");
  }
}

function showToast(message, title = "Готово") {
  const toast = $("#toast");
  if (!toast) return;
  toast.hidden = false;
  setText("#toastTitle", title);
  setText("#toastText", message);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, 2800);
}

function celebrate() {
  const layer = $("#celebration");
  if (!layer) return;
  layer.innerHTML = Array.from({ length: 16 }, (_, index) => {
    const left = 8 + Math.random() * 84;
    const delay = Math.random() * 0.18;
    const color = ["#6c42ff", "#b8ff63", "#ffb25f", "#2f6df6"][index % 4];
    const drift = Math.round(-90 + Math.random() * 180);
    return `<i class="confetti" style="left:${left}%;animation-delay:${delay}s;background:${color};--x:${drift}px"></i>`;
  }).join("");
  layer.classList.remove("is-active");
  void layer.offsetWidth;
  layer.classList.add("is-active");
  setTimeout(() => layer.classList.remove("is-active"), 1100);
}

function initSplash() {
  const splash = $("#appSplash");
  if (!splash) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    splash.classList.add("is-hidden");
    setTimeout(() => {
      splash.hidden = true;
    }, reduceMotion ? 0 : 430);
  }, reduceMotion ? 220 : 1000);
}

function bindEvents() {
  $("#openTopup")?.addEventListener("click", () => openSheet(dailyTarget()));
  $("#navTopup")?.addEventListener("click", () => openSheet(dailyTarget()));
  $("#closeTopup")?.addEventListener("click", closeSheet);
  $("#sheetBackdrop")?.addEventListener("click", closeSheet);
  $("#confirmTopup")?.addEventListener("click", confirmTopup);
  $("#openGoalEditor")?.addEventListener("click", openGoalEditor);
  $("#closeGoalEditor")?.addEventListener("click", closeGoalEditor);
  $("#goalSheetBackdrop")?.addEventListener("click", closeGoalEditor);
  $("#goalAmountInput")?.addEventListener("input", updateGoalPreview);
  $("#goalDeadlineInput")?.addEventListener("input", updateGoalPreview);
  $("#saveGoal")?.addEventListener("click", saveGoalChanges);

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-transaction]");
    if (button) deleteTransaction(button.dataset.deleteTransaction);
  });

  $$("[data-quick-amount]").forEach((button) => {
    button.addEventListener("click", () => openSheet(Number(button.dataset.quickAmount)));
  });

  $$(".amount-option").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAmount = Number(button.dataset.amount);
      updateConfirmLabel(selectedAmount);
      $$(".amount-option").forEach((item) => item.classList.toggle("is-selected", item === button));
      const custom = $("#customAmount");
      if (custom) custom.value = "";
    });
  });

  $("#customAmount")?.addEventListener("input", () => {
    const value = Number(String($("#customAmount").value || "").replace(",", "."));
    if ($("#customAmount").value) $$(".amount-option").forEach((button) => button.classList.remove("is-selected"));
    updateConfirmLabel(value > 0 ? value : selectedAmount);
  });

  $$("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  $$("[data-go-screen]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.goScreen)));

  $("#eveningReminder")?.addEventListener("change", async (event) => {
    const previous = state.eveningReminder;
    const enabled = event.target.checked;
    try {
      requireConnectedBackend();
      if (backendMode) {
        const result = await apiRequest("/api/settings", {
          method: "POST",
          body: JSON.stringify({ eveningReminder: enabled }),
        });
        applyServerState(result.state);
      } else {
        state.eveningReminder = enabled;
        saveState();
      }
      render();
      showToast(enabled ? "Вечернее напоминание включено" : "Вечернее напоминание выключено");
    } catch (error) {
      event.target.checked = previous;
      showToast(error.message || "Не удалось изменить напоминание", "Ошибка");
    }
  });

  $("#resetDemo")?.addEventListener("click", async () => {
    if (!confirm("Сбросить все тестовые пополнения и вернуть стартовый баланс?")) return;
    try {
      requireConnectedBackend();
      if (backendMode) {
        const result = await apiRequest("/api/reset", { method: "POST", body: "{}" });
        applyServerState(result.state);
      } else {
        state = cloneInitialState();
        saveState();
      }
      render();
      navigate("home");
      showToast(backendMode ? "Данные сброшены" : "Демо-данные сброшены");
    } catch (error) {
      showToast(error.message || "Не удалось сбросить данные", "Ошибка");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSheet();
      closeGoalEditor();
    }
  });
}

function handleLaunchAction() {
  const params = new URLSearchParams(location.search);
  if (params.get("action") !== "deposit") return;
  const requestedAmount = Number(params.get("amount"));
  openSheet(requestedAmount > 0 ? requestedAmount : dailyTarget());
  params.delete("action");
  params.delete("amount");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

function initTelegram() {
  try {
    const webApp = globalThis.Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready();
    webApp.expand();
    webApp.setHeaderColor("#f7f7fb");
    webApp.setBackgroundColor("#f7f7fb");
  } catch {
    // The local prototype also runs outside Telegram.
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  initTelegram();
  try {
    await loadRemoteState();
  } catch (error) {
    console.error("Fincush backend:", error);
    if (telegramInitData()) {
      setTimeout(() => showToast(error.message || "Не удалось синхронизировать данные", "Нет синхронизации"), 250);
    }
  }
  render();
  handleLaunchAction();
  initSplash();
});
