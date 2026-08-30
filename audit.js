// audit.js — write-only activity log for every Hazel action (security + trust)
import { appendLine, nowISO } from './store.js';

export function log(event, data = {}) {
  const line = JSON.stringify({ ts: nowISO(), event, ...data });
  try { appendLine('audit.log', line); } catch (e) { /* keep running */ }
}
