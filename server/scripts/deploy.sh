#!/usr/bin/env bash
# Выкладка сервиса mwave на сервер (запускать на компьютере разработчика из папки server).
# Нужен SSH-доступ к серверу по ключу (имя хоста в ~/.ssh/config: saltanovdanil111).
# Делает: сборка -> копия на сервер -> перезапуск -> проверка /health. Ключ сервиса не трогает.
set -euo pipefail
MWAVE_REMOTE_HOST="${MWAVE_SSH_HOST:-saltanovdanil111}"
cd "$(dirname "$0")/.."

npm run -s typecheck
npm test
npm run -s build
scp -q scripts/backup-before-iphone.sh "$MWAVE_REMOTE_HOST:/tmp/mwave-backup-before-iphone.sh"
ssh "$MWAVE_REMOTE_HOST" 'tr -d "\r" < /tmp/mwave-backup-before-iphone.sh | bash'
scp -q dist/mwave-server.mjs "$MWAVE_REMOTE_HOST:/tmp/mwave-server.mjs"
scp -q deploy/mwave.service deploy/mwave-ytdlp-update.service deploy/mwave-ytdlp-update.timer deploy/yt-dlp.conf "$MWAVE_REMOTE_HOST:/tmp/"
ssh "$MWAVE_REMOTE_HOST" 'set -e
install -o mwave -g mwave -m 640 /tmp/mwave-server.mjs /opt/mwave/app/mwave-server.mjs
install -m 644 /tmp/mwave.service /tmp/mwave-ytdlp-update.service /tmp/mwave-ytdlp-update.timer /etc/systemd/system/
install -d -o mwave -g mwave -m 750 /opt/mwave/cache/lyrics /opt/mwave/cache/charts
install -d -o mwave -g mwave /opt/mwave/.config/yt-dlp
install -o mwave -g mwave -m 644 /tmp/yt-dlp.conf /opt/mwave/.config/yt-dlp/config
rm -f /tmp/mwave-server.mjs /tmp/mwave.service /tmp/mwave-ytdlp-update.service /tmp/mwave-ytdlp-update.timer /tmp/yt-dlp.conf
systemctl daemon-reload
systemctl restart mwave
sleep 4
systemctl is-active mwave
curl -fs http://127.0.0.1:8780/health && echo'
