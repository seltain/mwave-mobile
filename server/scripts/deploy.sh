#!/usr/bin/env bash
# Выкладка сервиса mwave на сервер (запускать на компьютере разработчика из папки server).
# Нужен SSH-доступ к серверу по ключу (имя хоста в ~/.ssh/config: saltanovdanil111).
# Делает: сборка -> копия на сервер -> перезапуск -> проверка /health. Ключ сервиса не трогает.
set -euo pipefail
HOST="${MWAVE_SSH_HOST:-saltanovdanil111}"
cd "$(dirname "$0")/.."

node ../scripts/sync-pc.mjs
npm run -s typecheck
npm run -s build
scp -q dist/mwave-server.mjs "$HOST:/tmp/mwave-server.mjs"
scp -q deploy/mwave.service deploy/mwave-ytdlp-update.service deploy/mwave-ytdlp-update.timer "$HOST:/tmp/"
ssh "$HOST" 'set -e
install -o mwave -g mwave -m 640 /tmp/mwave-server.mjs /opt/mwave/app/mwave-server.mjs
install -m 644 /tmp/mwave.service /tmp/mwave-ytdlp-update.service /tmp/mwave-ytdlp-update.timer /etc/systemd/system/
rm -f /tmp/mwave-server.mjs /tmp/mwave.service /tmp/mwave-ytdlp-update.service /tmp/mwave-ytdlp-update.timer
systemctl daemon-reload
systemctl restart mwave
sleep 4
systemctl is-active mwave
curl -fs http://127.0.0.1:8780/health && echo'
