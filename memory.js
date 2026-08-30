// memory.js — persistent long-term memory with semantic-ish retrieval
import { load, save, uid, nowISO } from './store.js';

const FILE = 'memory.json';

function all() { return load(FILE, []); }
function persist(list) { return save(FILE, list); }

/* A lightweight, deterministic semantic retrieval:
   tokenizes the query, scores each memory entry by weighted overlap,
   and returns the top matches. Swappable for an embedding/vector model. */
function tokenize(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 1);
}
function stopwords() {
  return new Set(['the','a','an','and','or','but','of','to','in','on','for','with','is','are','my','i','it','me','be','do','you','that','this','from','at','by','as','about','not','have','has','what','when','who','how','which','can','could','would','remember','show','find','list','give','tell']);
}

// TF-IDF-ish scoring: query tokens vs entry tokens.
export function searchMemory(query, limit = 4) {
  const q = tokenize(query).filter(t => !stopwords().has(t));
  if (!q.length) return [];
  const docs = all();
  const scored = docs.map(d => {
    const dt = tokenize(d.text);
    let score = 0;
    for (const t of q) {
      if (dt.includes(t)) score += 2;
      else if (dt.some(x => x.startsWith(t) || t.startsWith(x))) score += 1;
    }
    // tiebreak: recency
    const rec = d.ts ? (+new Date(d.ts)) / 1e13 : 0;
    return { ...d, score: score + rec * 0.0001 };
  });
  return scored.filter(d => d.score > 0.2).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function listMemory() { return all(); }
export function countMemory() { return all().length; }

export function addMemory(text, tag = 'you') {
  const list = all();
  const item = { id: uid('m'), tag, text: String(text).trim(), ts: nowISO() };
  list.push(item);
  persist(list);
  return item;
}

export function deleteMemory(id) {
  const list = all().filter(m => m.id !== id);
  persist(list);
  return list;
}
