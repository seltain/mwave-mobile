# mwave для iPhone 2.0.0

Текущая ветка `iphone-2.0`: вход по аккаунту mwave, регистрация по приглашению, Keychain и отдельная SQLite-база на аккаунт, синхронизация с ПК 2.0, очередь, запасной источник, тексты и обновлённый интерфейс. Офлайн поддерживает метаданные и outbox; скачивание звука пока не реализовано.

Актуальные публичные документы: [техническая сводка](docs/ОТЧЕТ-iPhone-2.0.md), [установка 2.0](docs/УСТАНОВКА-iPhone-2.0.md). Подробный операционный отчёт передан владельцу приватно. Код ПК копируется без его изменения скриптом `scripts/import-pc-2.mjs`, состав и хэши в `docs/PC-SNAPSHOT.json`.

Перед каждой IPA: в app `npm ci`, `npm run typecheck`, `npm test`, `npm run check:dependencies`, `npm run test:web`, `npm run bundle:ios`; в server `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Node 24.17.0. Веб использует установленный Chrome, временную базу и записанные ответы; музыкальной сети в тестах нет. `postinstall` применяет проверяемый патч только веб-моста SQLite 16.0.10.

Сборка запускается вручную Actions -> Build iPhone IPA -> Run workflow -> iphone-2.0. Сначала типы/фикстуры/веб, затем симулятор с синтетическим звуком и arm64 Release. Кэши npm/CocoaPods/Xcode, артефакт содержит IPA, SHA-256, структуру, среду и времена. Проверка симулятора не заменяет физический iPhone.

Музыкальный API принимает access аккаунта, проверяя его по loopback существующей mwave-accounts. Новый `/account-s/<opaque>` требует Bearer и принадлежит аккаунту, включая все части HLS. Общий ключ и `/s/` временно сохранены для старых клиентов и монитора. Позднее их отключает `MWAVE_ALLOW_LEGACY_KEY=0`, после миграции всех потребителей. Новые POST: `/api/lyrics`, `/api/charts`; остальные музыкальные маршруты сохранены. На аккаунт 240 API/мин, 60 тяжёлых/мин, 600 звуковых/мин. Полный серверный откат и копии описаны в отчёте.

Ручная живая проверка на VPS: `MWAVE_LIVE=1 node server/scripts/live-sources-manual.mjs` с runtime Node сервера, максимум 10 музыкальных HTTP-запросов. В обычные тесты не включена. Перед выкладкой скрипт резервной копии обязателен.

Веб-превью с временными данными: в app установить помощник `npm install --no-save --package-lock=false @expo/ngrok@4.1.3`, затем `node scripts/preview-tunnel.cjs`. Открыть напечатанный HTTPS в Safari, вход preview / fixture-pass-8. Туннель действует, пока работает процесс; фон проверяется в IPA.

## Архив README первой пробной версии 1.0

Ниже сохранено описание предыдущей версии с общим ключом. Для 2.0 действуют документы выше.

Две части:
- `server/`: сервис на VPS (поиск, карточки артистов, альбомы, волна, звук). Логика из проекта ПК
  (`../music-circle-v2`), копия в `server/src/pc` делается скриптом `scripts/sync-pc.mjs`.
- `app/`: приложение на React Native + Expo (этап 2).

## Сервис на сервере

Адрес: `https://mwave.swiftsuper.online:8781` (nginx, отдельный сайт) -> `127.0.0.1:8780` (сервис).
Доступ только с ключом: заголовок `Authorization: Bearer <ключ>`. Ключ лежит на сервере в
`/opt/mwave/secret/token` (права 600, владелец mwave) и в секрете GitHub Actions; в репозиторий не кладётся.

| Адрес (POST, JSON) | Что делает |
|---|---|
| `/api/search` `{q, source}` | поиск YouTube Music или SoundCloud |
| `/api/search/more` `{q}` | артисты и альбомы |
| `/api/prepare` `{candidate}` | ссылка на звук: YouTube через сервис (подписанная, 6 ч), SoundCloud HLS напрямую |
| `/api/prefetch` `{list}` | подготовить ссылки заранее (следующая песня) |
| `/api/artist/quick`, `/api/artist/full` `{ref}` | карточка артиста (быстро / вместе с SoundCloud) |
| `/api/artist/more-songs` `{ref}` | «Показать ещё» (после `full`) |
| `/api/artist/all-albums` `{ref, kind}` | все альбомы или синглы |
| `/api/album` `{id}` | альбом |
| `/api/radio` `{seed, exclude, recent}` | волна: похожие песни |
| `/api/releases` `{artists}` | релизы избранных артистов (кольцо «новый трек» считает телефон) |
| `/api/info` | версия, yt-dlp, кэш |
| `GET /health` | без ключа: жив ли сервис |
| `GET /s/<id>?e=&s=` | звук YouTube с перемоткой (Range), проверяется подписью ссылки |

Ограничения: 240 запросов в минуту с адреса, тяжёлых (звук, поиск, карточки, волна) 60 в минуту,
неверный ключ: после 20 попыток за 10 минут отказ. yt-dlp одновременно не больше 2 раз.

### На сервере
- пользователь `mwave` (без входа и без sudo), всё в `/opt/mwave`:
  `bin/` (yt-dlp, deno, ffprobe), `app/mwave-server.mjs`, `secret/token`, `logs/` (3 файла по 1 МБ), `cache/`, `yt-dlp-plugins/`;
- `systemd`: `mwave.service` (автоперезапуск, лимит памяти 700 МБ, процессора 80%),
  `mwave-ytdlp-update.timer` (раз в сутки `yt-dlp -U`);
- nginx: `/etc/nginx/sites-available/mwave` (+ ссылка в `sites-enabled`), каталог `/var/www/mwave-acme`, журналы `/var/log/nginx/mwave.*.log`;
- сертификат `/etc/letsencrypt/live/mwave.swiftsuper.online` (продлевает уже работающий certbot).
- обновления mwave для ПК (с версии 1.4): `https://mwave.swiftsuper.online:8781/updates/` = каталог `/var/www/mwave-updates`
  (только чтение, без списка файлов; выкладывает `npm run release` из проекта ПК). Копия конфига nginx до этого: `/root/mwave-backups/`.

### Выложить новую версию
```
cd server && bash scripts/deploy.sh
```

### Проверить
```
cd server && npm test                                    # ключ, подписи, лимиты
MWAVE_URL=https://mwave.swiftsuper.online:8781 MWAVE_KEY=... node test/api.check.mjs   # живая проверка
```

### Убрать всё с сервера (откат)
```
systemctl disable --now mwave.service mwave-ytdlp-update.timer
rm /etc/systemd/system/mwave.service /etc/systemd/system/mwave-ytdlp-update.service /etc/systemd/system/mwave-ytdlp-update.timer
systemctl daemon-reload
rm /etc/nginx/sites-enabled/mwave /etc/nginx/sites-available/mwave && nginx -t && systemctl reload nginx
certbot delete --cert-name mwave.swiftsuper.online
rm -rf /var/www/mwave-acme /var/www/mwave-updates /opt/mwave /var/log/nginx/mwave.*.log && userdel mwave
```
