// server.mjs — Hazel Core backend
//   - serves the UI
//   - REST API for state (memory, tasks, calendar, files, notifs, search)
//   - POST /api/hazel  → run orchestrator (returns a job id)
//   - GET  /api/stream/:id → Server-Sent Events: live steps + final reply
//   - POST /api/approve → approve a held sensitive step
//   - GET  /api/search  → real web search
//   - optional /api/llm  → ping to show whether an LLM key is configured
import http from 'node:http';
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { runHazel, approvePending } from './src/orchestrator.js';
import * as mem from './src/memory.js';
import { load, save, uid } from './src/store.js';
import { listWorkspace, readFileSafe, searchFiles } from './src/fsck.js';
import { TOOLS } from './src/tools.js';
import { log } from './src/audit.js';
import { llmConfigured, modelName } from './src/llm.js';
import { webSearch } from './src/search.js';
import { synthesize, ttsStatus, voiceName } from './src/tts.js';

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';
const ROOT = new URL('./', import.meta.url).pathname;

/* ---- in-memory jobs (streams) ---- */
const jobs = new Map();

function contentType(p) {
  const ext = extname(p).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg',
    '.md': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function allowedOrigin(req) {
  const o = req.headers.origin;
  return o || '*';
}
function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function serveStatic(res, pathname) {
  let p;
  try {
    if (pathname === '/') p = join(ROOT, 'index.html');
    else if (pathname.startsWith('/workspace/')) {
      // serve a workspace file if it exists and is under workspace/ (sanitized below)
      p = resolve(ROOT + pathname.replace(/^\//, ''));
      const rel = p.replace(resolve(ROOT), '');
      if (rel.startsWith('..')) return send(res, 403, { error: 'blocked' });
    } else p = join(ROOT, pathname.replace(/^\//, ''));
  } catch (e) { return send(res, 400, { error: 'bad path' }); }
  if (!existsSync(p) || !statSync(p).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': contentType(p) });
  createReadStream(p).pipe(res);
}

function sse(res, emit) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write('retry: 1500\n\n');
  const sub = (name, data) => { try { res.write(`event:${name}\ndata:${JSON.stringify(data)}\n\n`); } catch (e) {} };
  emit(sub);
  return res;
}

/* ---- job runner: runs orchestrator, streams events, stores final reply ---- */
function startJob({ message, mode, lastPartial }) {
  const id = uid('job');
  const job = { id, message, mode, result: null, done: false, approveQueue: null, clients: new Set(), buffer: [] };
  jobs.set(id, job);

  const emit = (name, data) => {
    job.buffer.push([name, data]);       // replayable history
    job.clients.forEach(c => c(name, data));
  };

  const ctx = {
    mode,
    approvedSensitive: false,
    rootDir: 'workspace'
  };

  (async () => {
    try {
      const outcome = await runHazel(message, ctx, emit);
      job.result = outcome;
      job.result = outcome;
      job.done = true;
      emit('result', { reply: outcome.reply, held: !!outcome.sensitiveHeld });
      log('job', { id, message, mode, tools: (outcome.results || []).map(r => r.name), held: !!outcome.sensitiveHeld });
    } catch (e) {
      job.result = { reply: `⚠️ Hazel hit an error: ${e.message}` };
      job.done = true;
      emit('result', { reply: job.result.reply, held: false });
      log('error', { id, message: e.message });
    }
  })();
  return job;
}

async function approveJob(job) {
  const ctx = { mode: job.mode, rootDir: 'workspace' };
  ctx.approvedSensitive = true;
  const emit = (name, data) => { job.buffer.push([name, data]); job.clients.forEach(c => c(name, data)); };
  // Rerun the full original plan with approval granted
  const origMessage = job.message;
  const outcome = await runHazel(origMessage, ctx, emit);
  job.result = outcome;
  job.done = true;
  emit('result', { reply: outcome.reply, held: false });
  log('approve', { id: job.id, message: origMessage });
  return outcome;
}

const api = {
  '/api/health': (req, res) => send(res, 200, { ok: true, llm: llmConfigured(), model: modelName(), tts: ttsStatus(), voice: voiceName(), ts: Date.now() }),

  '/api/memory': (req, res) => {
    if (req.method === 'GET') return send(res, 200, { items: mem.listMemory(), count: mem.countMemory() });
    const { text, tag } = req.body || {};
    if (!text) return send(res, 400, { error: 'text required' });
    const it = mem.addMemory(text, tag);
    log('memory_add', { id: it.id, text: it.text }); return send(res, 200, it);
  },
  '/api/memory/:id': (req, res, m) => {
    const list = mem.deleteMemory(m.id); log('memory_delete', { id: m.id }); return send(res, 200, { items: list, count: list.length });
  },
  '/api/memory/search': (req, res) => send(res, 200, { items: mem.searchMemory(req.body?.query || '') }),

  '/api/tasks': (req, res) => {
    if (req.method === 'GET') return send(res, 200, load('tasks.json', []));
    const { text, pri } = req.body || {};
    if (!text) return send(res, 400, { error: 'text required' });
    const t = load('tasks.json', []); const it = { id: uid('t'), text, done: false, pri: pri || 'med' }; t.push(it); save('tasks.json', t);
    return send(res, 200, it);
  },
  '/api/tasks/:id': (req, res, m) => {
    const t = load('tasks.json', []); const it = t.find(x => x.id === m.id); if (!it) return send(res, 404, { error: 'not found' }); it.done = !it.done; save('tasks.json', t); return send(res, 200, it);
  },

  '/api/calendar': (req, res) => send(res, 200, load('calendar.json', [])),
  '/api/notifications': (req, res) => send(res, 200, load('notifications.json', [])),

  '/api/files': (req, res) => send(res, 200, listWorkspace('')),
  '/api/files/read': (req, res) => {
    try { return send(res, 200, readFileSafe(req.body?.path)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  },
  '/api/files/search': (req, res) => send(res, 200, { items: searchFiles(req.body?.query || '') }),

  '/api/search': async (req, res) => {
    const q = req.body?.query || req.query?.q;
    if (!q) return send(res, 400, { error: 'query required' });
    try { const r = await webSearch(q); return send(res, 200, r); }
    catch (e) { return send(res, 500, { error: e.message }); }
  },

  '/api/voice': (req, res) => send(res, 200, ttsStatus()),

  '/api/tts': async (req, res) => {
    const text = req.body?.text || req.query?.text;
    if (!text) return send(res, 400, { error: 'text required' });
    if (text.length > 1500) return send(res, 400, { error: 'text too long' });
    const voice = req.body?.voice || req.query?.voice;
    const out = await synthesize(text, voice);
    if (!out.buffer) return send(res, 502, { error: 'tts unavailable: ' + (out.error || 'engine missing') });
    res.writeHead(200, {
      'Content-Type': out.contentType,
      'Cache-Control': 'public, max-age=3600',
      'X-Hazel-Engine': out.engine
    });
    res.end(out.buffer);
  },

  '/api/tools': (req, res) => send(res, 200, { tools: Object.keys(TOOLS) }),

  '/api/hazel': async (req, res) => {
    const { message, mode } = req.body || {};
    if (!message) return send(res, 400, { error: 'message required' });
    const job = startJob({ message, mode: mode || 'assistant' });
    return send(res, 200, { jobId: job.id });
  },

  '/api/approve': async (req, res) => {
    const { jobId } = req.body || {};
    const job = jobs.get(jobId);
    if (!job) return send(res, 404, { error: 'no pending job' });
    if (job._approving) return send(res, 200, { pending: true });
    job._approving = true;
    await approveJob(job);
    job._approving = false;
    return send(res, 200, { ok: true });
  }
};

// simple router
function route(method, pathname) {
  // exact match
  if (api[pathname]) return { fn: api[pathname], params: null };
  // pattern match with /:param
  for (const key of Object.keys(api)) {
    if (key.includes(':')) {
      const re = new RegExp('^' + key.replace(/:[^/]+/g, '([^/]+)') + '$');
      const m = pathname.match(re);
      if (m) return { fn: api[key], params: { [key.split(':')[1].split('/')[0]]: decodeURIComponent(m[1]) } };
    }
  }
  return null;
}

// Never let a stray error take Hazel offline silently.
process.on('uncaughtException', (e) => { console.error('\n[uncaughtException]', e && e.message); });
process.on('unhandledRejection', (e) => { console.error('\n[unhandledRejection]', e && e.message); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  cors(res, allowedOrigin(req));
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /* SSE: get stream events */
  if (pathname.startsWith('/api/stream/')) {
    const id = pathname.split('/').pop();
    const job = jobs.get(id);
    if (!job) return send(res, 404, { error: 'no such job' });
    sse(res, (emit) => {
      // Replay full event history so a late-subscribing client sees every step.
      for (const [name, data] of job.buffer) emit(name, data);
      job.clients.add(emit);
      const done = () => { job.clients.delete(emit); try { res.end(); } catch (e) {} };
      req.on('close', done); res.on('close', done);
    });
    return;
  }
  if (pathname === '/api/stream/:x') return send(res, 404, { error: 'bad stream' });

  if (req.method === 'GET' && (pathname.startsWith('/api/')===false)) {
    return serveStatic(res, pathname);
  }

  if (methodIsApi(pathname)) {
    const r = route(req.method, pathname);
    if (r) {
      req.body = await readBody(req);
      req.query = Object.fromEntries(u.searchParams);
      try { return r.fn(req, res, r.params); }
      catch (e) { return send(res, 500, { error: e.message }); }
    }
    return send(res, 404, { error: 'not found' });
  }
  return serveStatic(res, pathname);
});

function methodIsApi(p) { return p.startsWith('/api/'); }

server.listen(PORT, HOST, () => {
  console.log(`\n  🟣 HAZEL CORE  — backend running`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  LLM configured: ${llmConfigured() ? 'YES (' + modelName() + ')' : 'no (using deterministic orchestrator)'}`);
  console.log(`  ➜  Web search: LIVE (Wikipedia API)\n`);
});
