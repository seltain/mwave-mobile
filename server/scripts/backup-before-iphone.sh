#!/usr/bin/env bash
set -euo pipefail
umask 077
available=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
test "$available" -ge 150 || { echo "STOP: MemAvailable ${available} MiB"; exit 1; }
stamp=$(TZ=Asia/Novosibirsk date +%Y%m%d-%H%M%S)
dest="/var/backups/mwave-before-iphone-2-$stamp"
mkdir -m 700 "$dest"
tar -cpf "$dest/mwave.tar" /opt/mwave /etc/systemd/system/mwave.service /etc/nginx/sites-available/mwave /etc/mwave-health /usr/local/lib/mwave-health /etc/systemd/system/mwave-health.service /etc/systemd/system/mwave-health.timer 2>"$dest/tar.log"
mkdir -m 700 "$dest/accounts"
/opt/mwave-accounts/runtime/node-v24.17.0-linux-x64/bin/node --input-type=module - "$dest/accounts/accounts.db" <<'NODE'
import {DatabaseSync,backup} from 'node:sqlite';
const source=new DatabaseSync('/var/lib/mwave-accounts/accounts.db',{readOnly:true});await backup(source,process.argv[2]);source.close();const check=new DatabaseSync(process.argv[2],{readOnly:true});if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity');check.close();
NODE
cp -a /var/lib/mwave-accounts/rotation.key "$dest/accounts/"
if test -d /var/lib/mwave-accounts/covers; then cp -a /var/lib/mwave-accounts/covers "$dest/accounts/"; fi
cp -a /etc/systemd/system/mwave-accounts.service "$dest/"
chmod 600 "$dest"/*.tar "$dest/accounts/accounts.db"
sha256sum "$dest/mwave.tar" > "$dest/SHA256SUMS"
printf 'BACKUP=%s\nMEM_AVAILABLE_MIB=%s\n' "$dest" "$available"
du -sb "$dest"
find "$dest" -type f | wc -l
cat "$dest/SHA256SUMS"
