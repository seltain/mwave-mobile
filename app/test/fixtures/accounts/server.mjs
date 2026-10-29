// Test-only desktop accounts 2.0 snapshot, commit 9140bf1. Never deployed.
import { createServer } from 'node:http';
import { AccountStore, ApiError } from './store.mjs';
import { getCover, putCover } from './covers.mjs';
export function createAccountServer(store) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost'), p = url.pathname.replace(/^\/account-api\/v1/, '');
      if (req.method === 'GET' && p === '/health') {
        store.db.prepare('SELECT 1').get();
        res.end(JSON.stringify({ ok: true, protocol: 1 }));
        return;
      }
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 256 * 1024) throw new ApiError(413, 'body', 'Запрос слишком большой');
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let b = {};
      try {
        b = raw ? JSON.parse(raw) : {};
      } catch {
        throw new ApiError(400, 'json', 'Неверный JSON');
      }
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'json', 'Ожидается объект JSON');
      const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || 'local';
      let result;
      if (req.method === 'POST' && p === '/auth/login') result = await store.login(b, ip);
      else if (req.method === 'POST' && p === '/auth/register') result = await store.register(b, ip);
      else if (req.method === 'POST' && p === '/auth/refresh') {
        result = store.refresh(b.refresh);
        if (result.revoked) throw new ApiError(401, 'refresh_reuse', 'Сессия завершена, войдите снова');
      } else {
        const ctx = store.auth(String(req.headers.authorization || '').replace(/^Bearer /, ''));
        const method = req.method,
          match = p.match(/^\/admin\/(invites|accounts)\/([\w-]+)$/),
          imp = p.match(/^\/imports\/([\w-]+)\/(commit|chunks\/(\d+))$/);
        if (method === 'GET' && p === '/me') result = store.info(ctx.account);
        else if (method === 'GET' && p === '/capabilities') {
          result = { protocol: 1, control: false, maxOps: 100, maxBody: 262144, pollSeconds: 45 };
        } else if (method === 'POST' && p === '/auth/logout') result = store.logout(ctx);
        else if (method === 'POST' && p === '/auth/logout-all') result = store.logout(ctx, true);
        else if (method === 'POST' && p === '/auth/reauth') result = await store.reauth(ctx, b.password, b.action);
        else if (method === 'POST' && p === '/auth/password') result = await store.changePassword(ctx, b);
        else if (method === 'DELETE' && p === '/me') result = store.delete(ctx, b.proof);
        else if (method === 'GET' && p === '/sessions') {
          result = store.db.prepare('SELECT id,device,name,created,last_seen,revoked FROM sessions WHERE account=? ORDER BY last_seen DESC')
            .all(ctx.account.id);
        } else if (method === 'DELETE' && /^\/sessions\/[\w-]+$/.test(p)) {
          store.db.prepare('UPDATE sessions SET revoked=1 WHERE id=? AND account=?').run(p.split('/').at(-1), ctx.account.id);
          result = { ok: true };
        } else if (method === 'POST' && p === '/admin/invites') result = store.invite(ctx, b.hours ?? 48);
        else if (method === 'GET' && p === '/admin/invites') {
          store.admin(ctx);
          result = store.db.prepare('SELECT id,expires,creator,used,revoked FROM invites ORDER BY expires DESC').all();
        } else if (method === 'GET' && p === '/admin/accounts') {
          store.admin(ctx);
          result = store.db.prepare('SELECT id,login,name,role,disabled,created FROM accounts').all();
        } else if (method === 'DELETE' && match?.[1] === 'invites') {
          store.admin(ctx);
          store.db.prepare('UPDATE invites SET revoked=1 WHERE id=?').run(match[2]);
          result = { ok: true };
        } else if (method === 'PATCH' && match?.[1] === 'accounts') result = store.disable(ctx, match[2], !!b.disabled);
        else if (method === 'POST' && p === '/sync/push') result = store.push(ctx, b.ops);
        else if (method === 'GET' && p === '/sync/pull') result = store.pull(ctx, url.searchParams.get('after') || 0);
        else if (method === 'POST' && p === '/sync/snapshot') result = store.snapshot(ctx, b);
        else if (method === 'POST' && p === '/imports') result = store.startImport(ctx, b);
        else if (method === 'POST' && p === '/covers') result = putCover(store, ctx, b.jpeg);
        else if (method === 'GET' && /^\/covers\/[a-f0-9]{64}$/.test(p)) result = getCover(store, ctx, p.split('/').at(-1));
        else if (method === 'PUT' && imp?.[3]) result = store.importChunk(ctx, imp[1], Number(imp[3]), b.ops);
        else if (method === 'POST' && imp?.[2] === 'commit') result = store.commitImport(ctx, imp[1]);
        else throw new ApiError(404, 'route', 'Метод не найден');
      }
      res.end(JSON.stringify(result));
    } catch (e) {
      const known = e instanceof ApiError;
      res.statusCode = known ? e.status : 500;
      if (res.statusCode === 429) res.setHeader('Retry-After', '60');
      res.end(
        JSON.stringify({
          code: known ? e.code : 'internal',
          message: known ? e.message : 'Внутренняя ошибка сервера',
          retryable: res.statusCode >= 500 || res.statusCode === 429,
        }),
      );
    }
  });
}
export function listenAccounts(dir, port = 8782) {
  const store = new AccountStore(dir);
  const server = createAccountServer(store);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 64;
  server.listen(port, '127.0.0.1');
  return { store, server };
}
