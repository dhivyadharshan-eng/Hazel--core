// search.js — REAL web search + page fetch (uses live network)
// Primary source: Wikipedia API (reliable, citable). Falls back gracefully.

const UA = 'HazelCore/1.0 (personal AI control layer; contact: local)';

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

// Search Wikipedia. Returns a list of results with titles, urls, snippets.
export async function wikipediaSearch(query, limit = 4) {
  const api = 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=' +
    (limit) + '&srsearch=' + encodeURIComponent(query);
  const j = await json(api);
  const hits = (j.query && j.query.search) || [];
  return hits.map(s => ({
    title: s.title,
    url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')),
    snippet: clean(s.snippet || ''),
    isWiki: true
  }));
}

// Fetch the lead summary ("extract") of a Wikipedia page.
export async function wikipediaSummary(title) {
  try {
    const j = await json('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    return { title: j.title || title, extract: clean(j.extract || ''), url: j.content_urls?.desktop?.page || '' };
  } catch (e) {
    return { title, extract: '', url: '' };
  }
}

// Fetch any URL and strip it to readable text.
export async function fetchPage(url, maxChars = 3000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) return { url, ok: false, error: 'HTTP ' + res.status };
  const text = await res.text();
  return { url, ok: true, text: cleanHtml(text, maxChars), len: text.length };
}

// High-level search: return a structured, citable answer payload.
export async function webSearch(query, opts = {}) {
  const limit = opts.maxResults || 4;
  const out = { query, results: [] };
  try {
    const wiki = await wikipediaSearch(query, limit);
    out.results = wiki;
  } catch (e) {
    out.error = 'wikipedia: ' + e.message;
  }
  if (out.results.length && out.results[0].title) {
    const lead = await wikipediaSummary(out.results[0].title);
    out.lead = lead;
  }
  return out;
}

/* ---------- text helpers ---------- */
function clean(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
function cleanHtml(html, maxChars) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (t.length > maxChars) t = t.slice(0, maxChars) + '…';
  return t;
}
