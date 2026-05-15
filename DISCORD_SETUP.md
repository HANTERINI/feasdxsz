# Настройка Discord Webhook для загрузки файлов

## Шаг 1: Создание Webhook в Discord

1. Открой Discord (веб или приложение)
2. Выбери сервер и канал куда будут загружаться файлы
3. Правый клик по каналу → «Настройки канала» (Channel Settings)
4. Перейди во вкладку «Интеграции» (Integrations)
5. Нажми «Создать Webhook» (Create Webhook)
6. Дай webhook имя (например "FileUploader")
7. Скопируй URL webhook (выглядит как: `https://discord.com/api/webhooks/123456789/abcdef...`)

## Шаг 2: Настройка сервера

1. Открой файл `discord-server.js` в блокноте или VS Code
2. Найди строку:
   ```javascript
   const DISCORD_WEBHOOK = '';
   ```
3. Вставь скопированный URL между кавычками:
   ```javascript
   const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/123456789/abcdef...';
   ```
4. Сохрани файл

## Шаг 3: Запуск

```bash
node discord-server.js
```

Открой http://localhost:3000 в браузере.

## Шаг 4: Использование

1. Перетащи файл в окно браузера (или кликни для выбора)
2. Нажми "Загрузить на Discord"
3. Получи PowerShell команду:
   ```powershell
   irm https://cdn.discordapp.com/attachments/... | iex
   ```
4. Кликни на команду чтобы скопировать
5. Вставь в PowerShell на другом ПК — файл скачается и запустится

## Команда `irm ... | iex`

- `irm` (Invoke-RestMethod) — скачивает содержимое URL
- `|` — передаёт в следующую команду
- `iex` (Invoke-Expression) — выполняет скачанный код

**Внимание:** `iex` сразу выполняет скачанный скрипт. Для безопасности можешь убрать `| iex` — тогда команда просто покажет содержимое файла.

## Альтернативы

Если Discord не подходит:
- **Telegram Bot** — через @BotFather
- **GitHub Gist** — для текста/скриптов
- **Свой VPS/сервер** — полный контроль
