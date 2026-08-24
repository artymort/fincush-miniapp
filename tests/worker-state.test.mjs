import test from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker/index.js";

test("initial balance is preserved and goal math is stable", () => {
  const state = __test.createInitialState();
  assert.equal(__test.currentBalance(state), 495.28);
  assert.equal(state.goal - __test.currentBalance(state), 29504.72);
});

test("date helper uses Yekaterinburg calendar day", () => {
  const utcEvening = new Date("2026-08-22T21:30:00.000Z");
  assert.equal(__test.dateKey(utcEvening), "2026-08-23");
});

test("daily target is recalculated in rounded 50-ruble steps", () => {
  const state = __test.createInitialState();
  const target = __test.suggestDailyTarget(state, 30_000, "2026-12-23", "2026-08-23");
  assert.equal(target, 250);
});

test("shiftDate follows local calendar boundaries", () => {
  assert.equal(__test.shiftDate("2026-08-23", -1), "2026-08-22");
  assert.equal(__test.shiftDate("2026-12-31", 1), "2027-01-01");
});

test("amountOn includes only deposits from the selected local day", () => {
  const state = __test.createInitialState();
  state.transactions.push(
    { type: "deposit", amount: 300, date: "2026-08-23T06:00:00.000Z" },
    { type: "deposit", amount: 200, date: "2026-08-24T06:00:00.000Z" },
  );
  assert.equal(__test.amountOn(state, "2026-08-23"), 300);
});

test("deposit is idempotent and deleting it restores balance and rating", () => {
  const state = __test.createInitialState();
  const operation = {
    amount: 250,
    id: "deposit-20260823-1102",
    date: "2026-08-23T06:02:00.000Z",
  };

  assert.equal(__test.addDeposit(state, operation).created, true);
  assert.equal(__test.addDeposit(state, operation).created, false);
  assert.equal(__test.currentBalance(state), 745.28);
  assert.equal(state.habit.rating, 52);

  const deleted = __test.removeDeposit(state, operation.id);
  assert.equal(deleted.amount, 250);
  assert.equal(__test.currentBalance(state), 495.28);
  assert.equal(state.habit.rating, 50);
  assert.equal(state.habit.reserveRubles, 0);
});

test("deleting an accelerated deposit removes only its reserve contribution", () => {
  const state = __test.createInitialState();
  __test.addDeposit(state, {
    amount: 250,
    id: "daily-target-20260823",
    date: "2026-08-23T06:00:00.000Z",
  });
  __test.addDeposit(state, {
    amount: 300,
    id: "extra-deposit-20260823",
    date: "2026-08-23T07:00:00.000Z",
  });
  assert.equal(state.habit.reserveRubles, 300);

  __test.removeDeposit(state, "extra-deposit-20260823");
  assert.equal(__test.currentBalance(state), 745.28);
  assert.equal(state.habit.rating, 52);
  assert.equal(state.habit.reserveRubles, 0);
});

test("morning reminder is skipped after an early deposit", () => {
  const state = __test.createInitialState();
  assert.equal(__test.shouldSendMorning(state, "2026-08-24"), true);

  __test.addDeposit(state, {
    amount: 250,
    id: "early-deposit-20260824",
    date: "2026-08-24T03:15:00.000Z",
  });
  assert.equal(__test.shouldSendMorning(state, "2026-08-24"), false);
});

test("deposit confirmation includes amount and resulting balance", () => {
  const state = __test.createInitialState();
  const transaction = __test.addDeposit(state, {
    amount: 250,
    id: "notified-deposit-20260824",
    date: "2026-08-24T06:00:00.000Z",
  }).transaction;

  assert.equal(
    __test.depositConfirmationText(state, transaction),
    "Пополнение подтверждено: <b>+250 ₽</b>\nБаланс подушки: <b>745,28 ₽</b>",
  );
});

test("Telegram HMAC validation matches the documented token example", async () => {
  const initData = "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";
  const token = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";
  const result = await __test.calculateInitDataHash(initData, token);
  assert.equal(result.calculatedHash, result.receivedHash);
});

test("Telegram HMAC input retains the modern signature field", async () => {
  const base = "user=%7B%22id%22%3A279058397%7D&auth_date=1760000000&hash=unused";
  const token = "123456:test-token";
  const withoutSignature = await __test.calculateInitDataHash(base, token);
  const withSignature = await __test.calculateInitDataHash(
    `${base}&signature=modern-ed25519-value`,
    token,
  );
  assert.notEqual(withSignature.calculatedHash, withoutSignature.calculatedHash);
});
