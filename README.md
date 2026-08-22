# Fincush

Персональная Telegram Mini App для ежедневного накопления. Интерфейс размещается на GitHub Pages, а бот, проверка доступа, напоминания и данные работают в Cloudflare Worker с Durable Object.

## Что уже реализовано

- стартовый баланс 495,28 ₽ и цель 30 000 ₽ с 23 августа по 23 декабря 2026 года;
- быстрые взносы 250 / 300 / 350 ₽ и произвольная сумма;
- ежедневное напоминание в 11:00 и повторное в 20:00 по Екатеринбургу, только если взнос не подтверждён;
- рейтинг привычки и резерв: сумма сверх дневного шага защищает будущие пропуски;
- изменение цели и вечернего напоминания;
- серверная проверка Telegram `initData` и разрешение только одному Telegram ID;
- токен бота и Telegram ID не хранятся в репозитории и не попадают в код браузера.

## Локальная проверка интерфейса

```bash
npm install
npm run build:pages
```

Для локальной разработки Worker создайте `.dev.vars` по образцу `.env.example`. Этот файл исключён из Git.

## Переменные GitHub

В `Settings → Secrets and variables → Actions` добавляются:

**Repository secrets**

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_TELEGRAM_ID`
- `TELEGRAM_WEBHOOK_SECRET`

**Repository variables**

- `MINI_APP_URL` — адрес GitHub Pages с завершающим `/`
- `WORKER_API_URL` — адрес Worker без завершающего `/`

После этого вручную запустите workflow `Deploy Telegram bot backend`, затем повторно `Deploy Mini App to GitHub Pages`. Workflow сам установит webhook, кнопку меню и команды бота.

## Безопасность

Публичный репозиторий содержит только исходный код. Все чувствительные значения передаются Worker через зашифрованные GitHub Secrets. API отвергает запросы без валидной подписи Telegram и запросы от любого аккаунта, кроме `ALLOWED_TELEGRAM_ID`.
