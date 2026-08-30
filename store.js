// store.js — tiny atomic JSON file store (zero dependencies)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function file(name) {
  return DATA_DIR + name;
}

export function load(name, fallback) {
  const p = file(name);
  try {
    if (!existsSync(p)) { writeFileSync(p, JSON.stringify(fallback, null, 2)); return fallback; }
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

export function save(name, data) {
  const p = file(name);
  writeFileSync(p, JSON.stringify(data, null, 2));
  return data;
}

export function appendLine(name, line) {
  const p = file(name);
  try { writeFileSync(p, readFileSync(p, 'utf8') + '\n' + line); }
  catch (e) { writeFileSync(p, line + '\n'); }
}

export function nowISO() { return new Date().toISOString(); }
export function uid(prefix = 'x') { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
