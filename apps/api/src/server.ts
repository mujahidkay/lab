// @lab/api — the lab's single state service.
//   * READS the lab filesystem (via @lab/shared/fs) for GET + SSE.
//   * WRITES only by shelling out to bin/ (so the shell stays the one mutation
//     layer and the on-disk format never drifts).
//   * Gates every /api/* route behind a single bearer token (LAB_TOKEN).
//   * Serves the two built SPAs: whiteboard at /, observatory at /observatory.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import chokidar from 'chokidar';
import { buildState, buildJobViews, listQuestions, labRoot, paths } from '@lab/shared/fs';

const ROOT = labRoot();
const HOST = process.env.DASH_HOST || '127.0.0.1';
const PORT = parseInt(process.env.DASH_PORT || '8787', 10);
const TOKEN = process.env.LAB_TOKEN || '';
const P = paths(ROOT);

const WB_DIST = join(ROOT, 'apps', 'whiteboard', 'dist');
const OB_DIST = join(ROOT, 'apps', 'observatory', 'dist');

if (!TOKEN) console.warn('[api] WARNING: LAB_TOKEN is empty — every request will be rejected. Run `bin/lab init`.');

// --- auth --------------------------------------------------------------------
function tokenOf(req: IncomingMessage, url: URL): string {
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token') || '';
}
function authOk(provided: string): boolean {
  if (!TOKEN) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- helpers -----------------------------------------------------------------
function sendJson(res: ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1_000_000) reject(new Error('too large')); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
/** Run a bin/ helper with argv (never a shell string). Returns {ok, out, err}. */
function bin(script: string, args: string[]) {
  const r = spawnSync(join(ROOT, 'bin', script), args, {
    cwd: ROOT, env: { ...process.env, LAB_ROOT: ROOT }, encoding: 'utf8',
  });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
function serveStatic(res: ServerResponse, dist: string, rel: string) {
  if (!existsSync(dist)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;padding:2rem;color:#333">
      <h1>lab</h1><p>The apps are not built yet. Run <code>bin/serve start</code> (or, in dev, the Vite dev servers).</p></body>`);
    return;
  }
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, safe);
  if (!file.startsWith(dist)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!existsSync(file) || rel === '' || rel === '/') file = join(dist, 'index.html');
  if (!existsSync(file)) file = join(dist, 'index.html'); // SPA fallback
  const ext = extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

// --- SSE ---------------------------------------------------------------------
const clients = new Set<ServerResponse>();
function broadcast(area: string) {
  const payload = `data: ${JSON.stringify({ type: 'change', area, ts: new Date().toISOString() })}\n\n`;
  for (const res of clients) res.write(payload);
}

// Debounced filesystem watch -> SSE.
let timer: NodeJS.Timeout | null = null;
let pending = new Set<string>();
function schedule(area: string) {
  pending.add(area);
  if (timer) return;
  timer = setTimeout(() => {
    for (const a of pending) broadcast(a);
    pending = new Set(); timer = null;
  }, 200);
}
for (const [area, dir] of [['docket', P.docket], ['notebook', P.notebook], ['whiteboard', P.whiteboard]] as const) {
  chokidar.watch(dir, { ignoreInitial: true, depth: 6 })
    .on('all', () => schedule(area))
    .on('error', () => { /* ignore */ });
}

// --- request handler ---------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (path === '/api/health') return sendJson(res, 200, { ok: true });

  if (path.startsWith('/api/')) {
    if (!authOk(tokenOf(req, url))) return sendJson(res, 401, { error: 'unauthorized' });

    try {
      if (req.method === 'GET' && path === '/api/state') return sendJson(res, 200, buildState());
      if (req.method === 'GET' && path === '/api/jobs') return sendJson(res, 200, buildJobViews());
      if (req.method === 'GET' && path.startsWith('/api/jobs/')) {
        const id = decodeURIComponent(path.slice('/api/jobs/'.length));
        const v = buildJobViews().find((j) => j.id === id);
        return v ? sendJson(res, 200, v) : sendJson(res, 404, { error: 'not found' });
      }
      if (req.method === 'GET' && path === '/api/questions') return sendJson(res, 200, listQuestions().filter((q) => q.status === 'open'));

      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-cache',
          connection: 'keep-alive', 'x-accel-buffering': 'no',
        });
        res.write(`data: ${JSON.stringify({ type: 'hello', ts: new Date().toISOString() })}\n\n`);
        clients.add(res);
        const ka = setInterval(() => res.write(': keepalive\n\n'), 25_000);
        req.on('close', () => { clearInterval(ka); clients.delete(res); });
        return;
      }

      if (req.method === 'POST' && path === '/api/task') {
        const b = JSON.parse((await readBody(req)) || '{}');
        const title = String(b.title || '').trim();
        if (!title) return sendJson(res, 400, { error: 'title required' });
        const verb = String(b.verb || 'research');
        const priority = String(b.priority || 2);
        const body = String(b.body || title);
        const r = bin('docket', ['post', '--verb', verb, '--title', title, '--priority', priority, '--body', body]);
        return r.ok ? sendJson(res, 200, { id: r.out }) : sendJson(res, 500, { error: r.err || 'post failed' });
      }

      if (req.method === 'POST' && path === '/api/reply') {
        const b = JSON.parse((await readBody(req)) || '{}');
        const ask = String(b.ask_id || '').trim();
        const answer = String(b.answer ?? '');
        if (!ask) return sendJson(res, 400, { error: 'ask_id required' });
        const r = bin('whiteboard', ['reply', '--ask', ask, '--answer', answer]);
        return r.ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 500, { error: r.err || 'reply failed' });
      }

      return sendJson(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return sendJson(res, 500, { error: String((e as Error).message || e) });
    }
  }

  // Static SPAs.
  if (path === '/observatory' || path.startsWith('/observatory/')) {
    return serveStatic(res, OB_DIST, path.replace(/^\/observatory\/?/, ''));
  }
  return serveStatic(res, WB_DIST, path.replace(/^\//, ''));
});

server.listen(PORT, HOST, () => {
  console.log(`[api] lab state service on http://${HOST}:${PORT}  (root: ${ROOT})`);
  console.log(`[api] whiteboard: /   observatory: /observatory   token: ${TOKEN ? 'set' : 'MISSING'}`);
});
