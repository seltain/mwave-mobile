// Test-only desktop accounts 2.0 snapshot, commit 9140bf1. Never deployed.
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SYNC_FIELDS } from './shared.mjs';
const scrypt = promisify(derive),
  hash = (s) => createHash('sha256').update(s).digest('hex'),
  token = () => randomBytes(32).toString('base64url');
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
const text = (v, n = 200) => typeof v === 'string' && v.length <= n ? v : fail(400, 'bad_input', 'Неверные данные');
export class AccountStore {
  constructor(dir, { now = Date.now } = {}) {
    this.dir = dir;
    this.now = now;
    this.hashBusy = false;
    this.hashWaiting = 0;
    this.rate = new Map();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.keyFile = path.join(dir, 'rotation.key');
    if (!existsSync(this.keyFile)) writeFileSync(this.keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(this.keyFile);
    this.db = new DatabaseSync(path.join(dir, 'accounts.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) throw new Error('Unsupported accounts schema');
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,login TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,seq INTEGER NOT NULL DEFAULT 0,bytes INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,creator TEXT NOT NULL,used TEXT,revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,device TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS access_tokens(hash TEXT PRIMARY KEY,session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS refresh_tokens(hash TEXT PRIMARY KEY,session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires INTEGER NOT NULL,rotated INTEGER,nonce TEXT,next_hash TEXT);
   CREATE TABLE IF NOT EXISTS proofs(hash TEXT PRIMARY KEY,session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,action TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS entities(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,versions TEXT NOT NULL,deleted INTEGER NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(account,kind,id));
   CREATE INDEX IF NOT EXISTS entities_seq ON entities(account,seq);
   CREATE TABLE IF NOT EXISTS changes(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,seq INTEGER NOT NULL,entity TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,seq));
   CREATE TABLE IF NOT EXISTS ops(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(account,id));
   CREATE TABLE IF NOT EXISTS conflicts(id INTEGER PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT,id_ref TEXT,field TEXT,value TEXT,seq INTEGER,at INTEGER);
   CREATE TABLE IF NOT EXISTS imports(account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,manifest TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(account,id));
   CREATE TABLE IF NOT EXISTS import_chunks(account TEXT,id TEXT,n INTEGER,hash TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,id,n),FOREIGN KEY(account,id) REFERENCES imports(account,id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,cursor INTEGER NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS snapshot_rows(snapshot TEXT REFERENCES snapshots(id) ON DELETE CASCADE,kind TEXT,id TEXT,data TEXT,versions TEXT,deleted INTEGER,seq INTEGER);
   CREATE INDEX IF NOT EXISTS snapshot_page ON snapshot_rows(snapshot);
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER,action TEXT,account TEXT);
   PRAGMA user_version=1;`,
    );
    chmodSync(path.join(dir, 'accounts.db'), 0o600);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    this.pendingOrders = new Map();
    try {
      const r = fn();
      for (const { account, playlist, items, opId } of this.pendingOrders.values()) {
        const baseSeq = this.db.prepare('SELECT seq FROM accounts WHERE id=?').get(account).seq;
        this.apply(account, { opId: opId + '/order', kind: 'order', id: playlist, baseSeq, fields: { playlist, items } }, true);
      }
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.pendingOrders = null;
    }
  }
  info(a) {
    return { id: a.id, login: a.login, name: a.name, role: a.role };
  }
  audit(action, account) {
    this.db.prepare('INSERT INTO audit(at,action,account) VALUES(?,?,?)').run(this.now(), action, account);
  }
  async password(p) {
    if (typeof p !== 'string' || [...p].length < 8 || Buffer.byteLength(p) > 1024) {
      fail(400, 'password', 'Пароль: от 8 символов, до 1024 байт');
    }
    const salt = token();
    const out = await this.kdf(p, salt);
    return `scrypt$32768$8$3$${salt}$${out.toString('base64url')}`;
  }
  async kdf(p, salt) {
    if (this.hashWaiting >= 2) fail(429, 'busy', 'Слишком много попыток, повторите позже');
    this.hashWaiting++;
    while (this.hashBusy) await new Promise((r) => setTimeout(r, 10));
    this.hashWaiting--;
    this.hashBusy = true;
    try {
      return await scrypt(p, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    } finally {
      this.hashBusy = false;
    }
  }
  async verify(p, stored) {
    if (typeof p !== 'string' || Buffer.byteLength(p) > 1024) return false;
    const parts = stored.split('$');
    const out = await this.kdf(p, parts[4]);
    const expected = Buffer.from(parts[5], 'base64url');
    return expected.length === out.length && timingSafeEqual(out, expected);
  }
  loginName(s) {
    const name = text(s, 32).toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(name)) fail(400, 'login', 'Имя: 3-32 символа a-z, 0-9, . _ -');
    return name;
  }
  async bootstrap(login, name, password) {
    if (this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) fail(409, 'exists', 'Первый аккаунт уже создан');
    const pw = await this.password(password);
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) fail(409, 'exists', 'Первый аккаунт уже создан');
      return this.create(login, name, pw, 'admin');
    });
  }
  create(login, name, pw, role = 'member') {
    const id = randomUUID();
    this.db.prepare('INSERT INTO accounts(id,login,name,password,role,created) VALUES(?,?,?,?,?,?)').run(
      id,
      this.loginName(login),
      text(name, 80) || login,
      pw,
      role,
      this.now(),
    );
    return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  }
  session(a, device, name) {
    const id = randomUUID(), r = token();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,0)').run(
      id,
      a.id,
      text(device, 100),
      text(name || 'ПК', 80),
      this.now(),
      this.now(),
    );
    this.db.prepare('INSERT INTO refresh_tokens(hash,session,expires) VALUES(?,?,?)').run(hash(r), id, this.now() + 30 * 86400000);
    return this.issue(a, id, device, r);
  }
  issue(a, session, device, refresh) {
    const access = token(), accessExpires = this.now() + 300000;
    this.db.prepare('DELETE FROM access_tokens WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO access_tokens VALUES(?,?,?)').run(hash(access), session, accessExpires);
    return { access, refresh, accessExpires, account: this.info(a), sessionId: session, deviceId: device };
  }
  limit(ip, login) {
    const now = this.now();
    for (const [k, v] of this.rate) if (v.until < now) this.rate.delete(k);
    for (const [key, max, span] of [[`ip:${ip}`, 10, 60000], [`name:${login}`, 5, 900000]]) {
      const b = this.rate.get(key) || { n: 0, until: now + span };
      if (++b.n > max) fail(429, 'rate_limit', 'Слишком много попыток входа, повторите позже');
      this.rate.set(key, b);
    }
    if (this.rate.size > 10000) fail(429, 'rate_limit', 'Слишком много попыток');
  }
  async login(b, ip) {
    const login = this.loginName(b.login);
    this.limit(ip, login);
    const a = this.db.prepare('SELECT * FROM accounts WHERE login=?').get(login);
    const valid = await this.verify(b.password, a?.password || `scrypt$32768$8$3$unknown$${Buffer.alloc(64).toString('base64url')}`);
    if (!valid || !a || a.disabled) fail(401, 'login_failed', 'Неверное имя или пароль, либо аккаунт отключён');
    this.rate.delete(`name:${login}`);
    return this.transaction(() => this.session(a, b.deviceId, b.deviceName));
  }
  invite(ctx, hours = 48) {
    this.admin(ctx);
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 1 || n > 168) fail(400, 'expires', 'Срок приглашения: 1-168 часов');
    const code = token(), id = randomUUID(), expires = this.now() + n * 3600000;
    this.db.prepare('INSERT INTO invites(id,hash,expires,creator) VALUES(?,?,?,?)').run(id, hash(code), expires, ctx.account.id);
    return { id, code, expires };
  }
  async register(b, ip) {
    this.limit(ip, this.loginName(b.login));
    const check = () => {
      const i = this.db.prepare('SELECT * FROM invites WHERE hash=?').get(hash(text(b.inviteCode, 100)));
      if (!i || i.used || i.revoked || i.expires <= this.now()) fail(403, 'invite', 'Приглашение недействительно');
      return i;
    };
    check();
    const pw = await this.password(b.password);
    return this.transaction(() => {
      const i = check();
      if (this.db.prepare('SELECT 1 FROM accounts WHERE login=?').get(this.loginName(b.login))) fail(409, 'login_exists', 'Имя уже занято');
      const a = this.create(b.login, b.name || b.login, pw);
      this.db.prepare('UPDATE invites SET used=? WHERE id=?').run(a.id, i.id);
      return this.session(a, b.deviceId, b.deviceName);
    });
  }
  auth(raw) {
    const row = this.db.prepare(
      'SELECT s.* FROM access_tokens t JOIN sessions s ON s.id=t.session WHERE t.hash=? AND t.expires>? AND s.revoked=0',
    ).get(hash(raw || ''), this.now());
    if (!row) fail(401, 'session', 'Требуется вход');
    const a = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account);
    if (!a || a.disabled) fail(403, 'disabled', 'Аккаунт отключён');
    this.db.prepare('UPDATE sessions SET last_seen=? WHERE id=?').run(this.now(), row.id);
    return { account: a, session: row };
  }
  refresh(raw) {
    return this.transaction(() => {
      const t = this.db.prepare('SELECT * FROM refresh_tokens WHERE hash=?').get(hash(text(raw, 100)));
      if (!t) fail(401, 'refresh', 'Требуется вход');
      const s = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(t.session);
      const a = s && this.db.prepare('SELECT * FROM accounts WHERE id=?').get(s.account);
      if (!a || a.disabled || s.revoked || s.created + 90 * 86400000 < this.now()) {
        fail(401, 'refresh', 'Требуется вход');
      }
      if (t.rotated !== null) {
        if (this.now() - t.rotated > 60000) {
          this.db.prepare('UPDATE sessions SET revoked=1 WHERE id=?').run(s.id);
          return { revoked: true };
        }
        const next = createHmac('sha256', this.key).update(raw + '\0' + t.nonce).digest('base64url');
        return this.issue(a, s.id, s.device, next);
      }
      if (t.expires < this.now()) fail(401, 'refresh', 'Требуется вход');
      const nonce = token(), next = createHmac('sha256', this.key).update(raw + '\0' + nonce).digest('base64url');
      this.db.prepare('UPDATE refresh_tokens SET rotated=?,nonce=?,next_hash=? WHERE hash=?').run(this.now(), nonce, hash(next), t.hash);
      this.db.prepare('INSERT INTO refresh_tokens(hash,session,expires) VALUES(?,?,?)').run(
        hash(next),
        s.id,
        Math.min(this.now() + 30 * 86400000, s.created + 90 * 86400000),
      );
      return this.issue(a, s.id, s.device, next);
    });
  }
  admin(ctx) {
    if (ctx.account.role !== 'admin') fail(403, 'admin', 'Доступно администратору');
  }
  logout(ctx, all = false) {
    this.db.prepare(`UPDATE sessions SET revoked=1 WHERE ${all ? 'account' : 'id'}=?`).run(all ? ctx.account.id : ctx.session.id);
    this.audit(all ? 'logout-all' : 'logout', ctx.account.id);
    return { ok: true };
  }
  async reauth(ctx, password, action) {
    if (!['password', 'delete'].includes(action) || !await this.verify(password, ctx.account.password)) {
      fail(403, 'reauth', 'Проверьте пароль');
    }
    const proof = token();
    this.db.prepare('INSERT INTO proofs VALUES(?,?,?,?)').run(hash(proof), ctx.session.id, action, this.now() + 120000);
    return { proof };
  }
  proof(ctx, p, action) {
    const r = this.db.prepare('DELETE FROM proofs WHERE hash=? AND session=? AND action=? AND expires>? RETURNING hash').get(
      hash(text(p, 100)),
      ctx.session.id,
      action,
      this.now(),
    );
    if (!r) fail(403, 'reauth', 'Повторите подтверждение пароля');
  }
  async changePassword(ctx, b) {
    const pw = await this.password(b.password);
    return this.transaction(() => {
      this.proof(ctx, b.proof, 'password');
      this.db.prepare('UPDATE accounts SET password=? WHERE id=?').run(pw, ctx.account.id);
      return this.logout(ctx, true);
    });
  }
  lastAdmin(id) {
    const a = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
    if (
      a?.role === 'admin' && !a.disabled &&
      this.db.prepare("SELECT count(*) n FROM accounts WHERE role='admin' AND disabled=0").get().n <= 1
    ) fail(409, 'last_admin', 'Нельзя отключить или удалить последнего администратора');
  }
  disable(ctx, id, disabled) {
    this.admin(ctx);
    return this.transaction(() => {
      if (disabled) this.lastAdmin(id);
      this.db.prepare('UPDATE accounts SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id);
      if (disabled) this.db.prepare('UPDATE sessions SET revoked=1 WHERE account=?').run(id);
      this.audit(disabled ? 'disable' : 'enable', id);
      return { ok: true };
    });
  }
  delete(ctx, proof) {
    const result = this.transaction(() => {
      this.proof(ctx, proof, 'delete');
      this.lastAdmin(ctx.account.id);
      writeFileSync(path.join(this.dir, 'deleted-accounts.log'), ctx.account.id + '\n', { flag: 'a', mode: 0o600 });
      this.db.prepare('DELETE FROM accounts WHERE id=?').run(ctx.account.id);
      return { ok: true };
    });
    const root = path.resolve(this.dir, 'covers'), target = path.resolve(root, ctx.account.id);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid cover directory');
    rmSync(target, { recursive: true, force: true });
    return result;
  }
  entity(row) {
    return {
      kind: row.kind,
      id: row.id,
      fields: JSON.parse(row.data),
      versions: JSON.parse(row.versions),
      deleted: !!row.deleted,
      seq: row.seq,
    };
  }
  conflict(account, op, field, value, seq) {
    this.db.prepare('INSERT INTO conflicts(account,kind,id_ref,field,value,seq,at) VALUES(?,?,?,?,?,?,?)').run(
      account,
      op.kind,
      op.id,
      field,
      JSON.stringify(value) ?? 'null',
      seq,
      this.now(),
    );
  }
  apply(account, op, internal = false) {
    text(op.opId, 150);
    text(op.id, 300);
    if (!op.opId || !op.id || !SYNC_FIELDS[op.kind] || !Number.isSafeInteger(op.baseSeq) || op.baseSeq < 0) {
      fail(400, 'operation', 'Неверная операция');
    }
    if (op.kind === 'order' && !internal) fail(400, 'order', 'Порядок меняется операциями insert/move');
    const prior = this.db.prepare('SELECT seq FROM ops WHERE account=? AND id=?').get(account, op.opId);
    if (prior) return prior.seq;
    const old = this.db.prepare('SELECT * FROM entities WHERE account=? AND kind=? AND id=?').get(account, op.kind, op.id);
    const fields = old ? JSON.parse(old.data) : {}, versions = old ? JSON.parse(old.versions) : {};
    const next = this.db.prepare('UPDATE accounts SET seq=seq+1 WHERE id=? RETURNING seq').get(account).seq;
    let deleted = !!op.deleted;
    if (old?.deleted && ['playlist', 'item', 'play', 'history'].includes(op.kind) && !deleted) {
      this.conflict(account, op, 'deleted', op.fields, next);
      this.db.prepare('INSERT INTO ops VALUES(?,?,?)').run(account, op.opId, next);
      return next;
    }
    if (['favorite', 'album', 'artist', 'hidden'].includes(op.kind)) {
      if (deleted && (versions.__add || 0) > op.baseSeq) deleted = !!old?.deleted;
      if (!op.deleted) {
        if (op.memberAdd !== false) versions.__add = next;
        else deleted = old ? !!old.deleted : true;
      }
    }
    for (const [k, v] of Object.entries(op.fields || {})) {
      if (!SYNC_FIELDS[op.kind].includes(k)) fail(400, 'field', 'Неизвестное поле');
      const numeric = ['duration', 'added_at', 'created_at', 'played_at', 'played_s', 'opened_at', 'found_at', 'opened', 'offsetMs']
        .includes(k);
      if (
        v !== null &&
        (numeric
          ? (!Number.isFinite(v) || v < 0 && k !== 'offsetMs')
          : typeof v !== 'string' && !(op.kind === 'order' && k === 'items' && Array.isArray(v)))
      ) fail(400, 'field_type', 'Неверный тип поля');
      if ((versions[k] || 0) > op.baseSeq && JSON.stringify(fields[k]) !== JSON.stringify(v)) {
        this.conflict(account, op, k, fields[k], next);
      }
      if (op.kind === 'artist' && k === 'seen_releases') {
        let list, prior;
        try {
          list = JSON.parse(v);
          prior = JSON.parse(fields[k] || '[]');
        } catch {
          fail(400, 'releases', 'Неверный список релизов');
        }
        if (!Array.isArray(list) || list.length > 5000 || !list.every((x) => typeof x === 'string')) {
          fail(400, 'releases', 'Неверный список релизов');
        }
        fields[k] = JSON.stringify([...new Set([...prior, ...list])].sort());
      } else if (op.kind === 'release' && k === 'opened') fields[k] = Math.max(fields[k] || 0, v || 0);
      else if (op.kind === 'play' && k === 'played_s') {
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 10800)) fail(400, 'seconds', 'Неверное время прослушивания');
        fields[k] = v === null ? (fields[k] ?? null) : Math.max(fields[k] ?? 0, v);
      } else fields[k] = v;
      versions[k] = next;
    }
    if (op.kind === 'track') {
      if (!['ytmusic', 'soundcloud', 'local'].includes(fields.source)) fail(400, 'source', 'Неверный источник');
      if (fields.source === 'local') delete fields.url;
      else if (
        fields.url && !/^https:\/\/(?:music\.youtube\.com|www\.youtube\.com|youtube\.com|youtu\.be|soundcloud\.com)\//.test(fields.url)
      ) fail(400, 'url', 'Неверная ссылка трека');
    }
    if (op.kind === 'pref' && !['theme', 'endless', 'shuffle', 'repeat', 'audio.normalize', 'audio.level'].includes(fields.name)) {
      fail(400, 'preference', 'Неизвестная настройка');
    }
    if (op.kind === 'playlist' && fields.cover && !/^[a-f0-9]{64}$/.test(fields.cover)) fail(400, 'cover', 'Неверная ссылка обложки');
    if (op.kind === 'item') {
      const parent = this.db.prepare("SELECT deleted FROM entities WHERE account=? AND kind='playlist' AND id=?").get(
        account,
        fields.playlist,
      );
      if (!parent) fail(409, 'playlist_deleted', 'Плейлист удалён или ещё не отправлен');
      if (parent.deleted) {
        this.conflict(account, op, 'deleted', op.fields, next);
        this.db.prepare('INSERT INTO ops VALUES(?,?,?)').run(account, op.opId, next);
        return next;
      }
      if (Object.hasOwn(op, 'afterId')) {
        fields.afterId = op.afterId;
        fields.orderSeq = next;
      }
      if (fields.afterId === op.id) fields.afterId = null;
    }
    const data = JSON.stringify(fields);
    if (Buffer.byteLength(data) > 220000) fail(413, 'entity_size', 'Слишком большой объект');
    const delta = Buffer.byteLength(data) - (old ? Buffer.byteLength(old.data) : 0),
      a = this.db.prepare('SELECT bytes FROM accounts WHERE id=?').get(account);
    if (a.bytes + delta > 100 * 1024 * 1024) fail(413, 'quota', 'Достигнут лимит библиотеки 100 MiB');
    if (
      !old && op.kind === 'playlist' &&
      this.db.prepare("SELECT count(*) n FROM entities WHERE account=? AND kind='playlist' AND deleted=0").get(account).n >= 100
    ) fail(413, 'playlists', 'Не больше 100 плейлистов');
    if (
      !old && op.kind === 'item' &&
      this.db.prepare("SELECT count(*) n FROM entities WHERE account=? AND kind='item' AND deleted=0 AND json_extract(data,'$.playlist')=?")
          .get(account, fields.playlist).n >= 5000
    ) fail(413, 'items', 'Не больше 5000 элементов в плейлисте');
    this.db.prepare('UPDATE accounts SET bytes=bytes+? WHERE id=?').run(delta, account);
    const entity = { kind: op.kind, id: op.id, fields, versions, deleted, seq: next };
    this.db.prepare(
      'INSERT INTO entities VALUES(?,?,?,?,?,?,?) ON CONFLICT(account,kind,id) DO UPDATE SET data=excluded.data,versions=excluded.versions,deleted=excluded.deleted,seq=excluded.seq',
    ).run(account, op.kind, op.id, data, JSON.stringify(versions), deleted ? 1 : 0, next);
    this.db.prepare('INSERT INTO changes VALUES(?,?,?,?)').run(account, next, JSON.stringify(entity), this.now());
    this.db.prepare('INSERT INTO ops VALUES(?,?,?)').run(account, op.opId, next);
    if (op.kind === 'item' && (deleted || !old || Object.hasOwn(op, 'afterId'))) {
      const key = account + '/' + fields.playlist, cached = this.pendingOrders?.get(key);
      const ord = cached
        ? null
        : this.db.prepare("SELECT data FROM entities WHERE account=? AND kind='order' AND id=?").get(account, fields.playlist);
      const items = (cached ? cached.items : ord ? JSON.parse(ord.data).items : []).filter((id) => id !== op.id);
      if (!deleted) {
        const anchor = Object.hasOwn(op, 'afterId') ? op.afterId : (old ? fields.afterId : items.at(-1));
        const index = anchor ? items.indexOf(anchor) + 1 : 0;
        items.splice(Math.max(index, 0), 0, op.id);
      }
      this.pendingOrders.set(key, { account, playlist: fields.playlist, items, opId: op.opId });
    }
    return next;
  }
  startImport(ctx, b) {
    text(b.id, 100);
    if (!Array.isArray(b.hashes) || b.hashes.length > 10000 || !b.hashes.every((h) => /^[a-f0-9]{64}$/.test(h))) {
      fail(400, 'manifest', 'Неверный manifest');
    }
    const manifest = JSON.stringify({ hashes: b.hashes, counts: b.counts });
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM imports WHERE account=? AND id=?').get(ctx.account.id, b.id);
      if (old && old.manifest !== manifest) fail(409, 'manifest', 'Содержимое импорта изменилось');
      if (!old) this.db.prepare('INSERT INTO imports(account,id,manifest) VALUES(?,?,?)').run(ctx.account.id, b.id, manifest);
      return { state: old?.state || 'pending' };
    });
  }
  importChunk(ctx, id, n, ops) {
    const imp = this.db.prepare('SELECT * FROM imports WHERE account=? AND id=?').get(ctx.account.id, id);
    if (!imp) fail(404, 'import', 'Импорт не найден');
    const data = JSON.stringify(ops), manifest = JSON.parse(imp.manifest);
    if (!Number.isSafeInteger(n) || n < 0 || hash(data) !== manifest.hashes[n] || !Array.isArray(ops) || ops.length > 100) {
      fail(400, 'chunk', 'Не совпала контрольная сумма части');
    }
    if (imp.state !== 'committed') {
      this.db.prepare(
        'INSERT INTO import_chunks VALUES(?,?,?,?,?) ON CONFLICT(account,id,n) DO UPDATE SET hash=excluded.hash,data=excluded.data',
      ).run(ctx.account.id, id, n, hash(data), data);
    }
    return { ok: true };
  }
  commitImport(ctx, id) {
    return this.transaction(() => {
      const a = ctx.account.id, imp = this.db.prepare('SELECT * FROM imports WHERE account=? AND id=?').get(a, id);
      if (!imp) fail(404, 'import', 'Импорт не найден');
      if (imp.state === 'committed') return { state: 'committed' };
      const manifest = JSON.parse(imp.manifest),
        chunks = this.db.prepare('SELECT * FROM import_chunks WHERE account=? AND id=? ORDER BY n').all(a, id);
      if (chunks.length !== manifest.hashes.length) fail(409, 'incomplete', 'Импорт загружен не полностью');
      const counts = {};
      for (const c of chunks) {
        if (c.hash !== manifest.hashes[c.n]) fail(409, 'chunk', 'Повреждена часть импорта');
        for (const op of JSON.parse(c.data)) {
          counts[op.kind] = (counts[op.kind] || 0) + 1;
          this.apply(a, op);
        }
      }
      if (JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(manifest.counts || {}).sort())) {
        fail(409, 'counts', 'Не совпали количества записей');
      }
      this.db.prepare("UPDATE imports SET state='committed' WHERE account=? AND id=?").run(a, id);
      this.db.prepare('DELETE FROM import_chunks WHERE account=? AND id=?').run(a, id);
      return { state: 'committed', counts };
    });
  }
  push(ctx, ops) {
    if (!Array.isArray(ops) || ops.length > 100) fail(413, 'batch', 'Не больше 100 операций');
    return this.transaction(() => ({ acks: ops.map((op) => ({ opId: op.opId, seq: this.apply(ctx.account.id, op) })) }));
  }
  countConflicts(a) {
    return this.db.prepare('SELECT count(*) n FROM conflicts WHERE account=?').get(a).n;
  }
  pull(ctx, after = 0) {
    const a = ctx.account.id, cursor = Number(after);
    if (!Number.isSafeInteger(cursor) || cursor < 0) fail(400, 'cursor', 'Неверный cursor');
    const min = this.db.prepare('SELECT min(seq) n FROM changes WHERE account=?').get(a).n;
    const max = this.db.prepare('SELECT seq FROM accounts WHERE id=?').get(a).seq;
    if (cursor > max || (cursor > 0 && min && cursor < min - 1)) fail(410, 'snapshot_required', 'Нужен новый снимок');
    const rows = this.db.prepare('SELECT seq,entity FROM changes WHERE account=? AND seq>? ORDER BY seq LIMIT 101').all(a, cursor);
    return {
      entities: rows.slice(0, 100).map((r) => JSON.parse(r.entity)),
      cursor: rows.length ? rows[Math.min(rows.length, 100) - 1].seq : max,
      more: rows.length > 100,
      conflicts: this.countConflicts(a),
    };
  }
  snapshot(ctx, b = {}) {
    return this.transaction(() => {
      const a = ctx.account.id;
      let id = b.snapshotId, after = Number(b.after || 0);
      if (!Number.isSafeInteger(after) || after < 0) fail(400, 'snapshot', 'Неверная страница');
      if (!id) {
        id = randomUUID();
        this.db.prepare('DELETE FROM snapshots WHERE expires<?').run(this.now());
        this.db.prepare('DELETE FROM snapshots WHERE id IN(SELECT id FROM snapshots WHERE account=? ORDER BY expires DESC,id DESC LIMIT -1 OFFSET 3)').run(a);
        const cursor = this.db.prepare('SELECT seq FROM accounts WHERE id=?').get(a).seq;
        this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run(id, a, cursor, this.now() + 3600000);
        this.db.prepare('INSERT INTO snapshot_rows SELECT ?,kind,id,data,versions,deleted,seq FROM entities WHERE account=? ORDER BY seq')
          .run(id, a);
      }
      const snap = this.db.prepare('SELECT * FROM snapshots WHERE id=? AND account=? AND expires>?').get(text(id, 100), a, this.now());
      if (!snap) fail(410, 'snapshot_expired', 'Снимок истёк, начните заново');
      const rows = this.db.prepare('SELECT rowid r,* FROM snapshot_rows WHERE snapshot=? AND rowid>? ORDER BY rowid LIMIT 101').all(
        id,
        after,
      );
      let bytes = 0;
      const page = [];
      for (const row of rows) {
        if (page.length && (bytes + row.data.length > 240000 || page.length >= 100)) break;
        bytes += row.data.length;
        page.push(row);
      }
      return {
        snapshotId: id,
        after: page.at(-1)?.r || after,
        entities: page.map((r) => this.entity(r)),
        cursor: snap.cursor,
        more: rows.length > page.length,
        conflicts: this.countConflicts(a),
      };
    });
  }
  prune() {
    this.db.prepare('DELETE FROM snapshots WHERE expires<?').run(this.now());
    this.db.prepare('DELETE FROM changes WHERE at<?').run(this.now() - 90 * 86400000);
    this.db.prepare('DELETE FROM access_tokens WHERE expires<?').run(this.now());
    this.db.prepare('DELETE FROM proofs WHERE expires<?').run(this.now());
  }
  async backup() {
    const dir = path.resolve(this.dir, 'backups');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `accounts-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.db`), pending = file + '.pending';
    try {
      await backup(this.db, pending);
      chmodSync(pending, 0o600);
      const copy = new DatabaseSync(pending, { readOnly: true });
      try {
        if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity failed');
        const refs = copy.prepare(
          "SELECT account,json_extract(data,'$.cover') hash FROM entities WHERE kind='playlist' AND deleted=0 AND json_extract(data,'$.cover') IS NOT NULL",
        ).all();
        for (const r of refs) {
          if (!/^[a-f0-9]{64}$/.test(r.hash)) throw new Error('Invalid backup cover');
          const source = path.join(this.dir, 'covers', r.account, r.hash + '.jpg'), dest = path.join(file + '.covers', r.account);
          const bytes = readFileSync(source);
          if (hash(bytes) !== r.hash) throw new Error('Backup cover checksum failed');
          mkdirSync(dest, { recursive: true, mode: 0o700 });
          writeFileSync(path.join(dest, r.hash + '.jpg'), bytes, { mode: 0o600 });
        }
      } finally {
        copy.close();
      }
      renameSync(pending, file);
    } catch (e) {
      if (existsSync(pending)) unlinkSync(pending);
      throw e;
    }
    const files = readdirSync(dir).filter((f) => /^accounts-.*\.db$/.test(f)).sort();
    for (const old of files.slice(0, -7)) {
      const target = path.resolve(dir, old);
      if (!target.startsWith(dir + path.sep)) throw new Error('Invalid backup path');
      unlinkSync(target);
      rmSync(target + '.covers', { recursive: true, force: true });
    }
    return { file, sha256: hash(readFileSync(file)) };
  }
  close() {
    this.db.close();
  }
}
