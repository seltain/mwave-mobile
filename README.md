# mwave для iPhone

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
rm -rf /var/www/mwave-acme /opt/mwave /var/log/nginx/mwave.*.log && userdel mwave
```
