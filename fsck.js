// fsck.js — safe file access confined to the approved root directory
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';

const CONFIG = loadConfig();
function loadConfig() {
  try { return JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url).pathname, 'utf8')); }
  catch (e) { return { rootDir: './workspace' }; }
}
export const ROOT = resolve(new URL('../', import.meta.url).pathname, CONFIG.rootDir || './workspace');

// Resolve a user path under ROOT; rejects traversal outside ROOT.
export function safePath(input) {
  let p = String(input || '').trim();
  // strip leading ~ and make relative to root
  p = p.replace(/^~\/?/, '').replace(/^[/]/, '');
  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith('..') || rel === '' && p !== '') {
    // empty rel means the path IS root — allow only if p was empty
    if (p !== '' && rel.startsWith('..')) throw new Error('Blocked: path escapes the approved workspace');
  }
  if (rel.startsWith('..')) throw new Error('Blocked: path escapes the approved workspace');
  return abs;
}

const SIZE_LIMIT = 200_000; // bytes for read_file content

export function listWorkspace(dir = '') {
  const root = safePath(dir);
  const entries = [];
  function walk(d, depth) {
    if (depth > 3) return;
    let items;
    try { items = readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      if (it.name === 'node_modules' || it.name.startsWith('.git')) continue;
      const abs = join(d, it.name);
      const rel = relative(ROOT, abs);
      const isDir = it.isDirectory();
      entries.push({ name: it.name, path: rel, type: isDir ? 'dir' : 'file', size: isDir ? null : statSync(abs).size });
      if (isDir) walk(abs, depth + 1);
    }
  }
  walk(root, 0);
  return entries;
}

export function readFileSafe(p) {
  const abs = safePath(p);
  if (!existsSync(abs)) throw new Error('File not found: ' + p);
  const st = statSync(abs);
  if (st.isDirectory()) return { dir: true, entries: readdirSync(abs) };
  if (st.size > SIZE_LIMIT) throw new Error('File too large to read (> ' + SIZE_LIMIT + ' bytes)');
  const content = readFileSync(abs, 'utf8');
  return { dir: false, name: basename(abs), path: relative(ROOT, abs), content };
}

export function writeFileSafe(p, content) {
  const abs = safePath(p);
  if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, String(content));
  return { written: relative(ROOT, abs), bytes: Buffer.byteLength(String(content)) };
}

export function searchFiles(query) {
  const q = String(query || '').toLowerCase();
  const all = listWorkspace('').filter(f => f.type === 'file');
  const hits = [];
  for (const f of all) {
    if (f.name.toLowerCase().includes(q)) { hits.push(f); continue; }
    try {
      const c = readFileSync(join(ROOT, f.path), 'utf8');
      if (c.toLowerCase().includes(q)) hits.push(f);
    } catch (e) { /* skip binary/locked */ }
    if (hits.length >= 8) break;
  }
  return hits;
}
