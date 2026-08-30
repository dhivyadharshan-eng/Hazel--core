// tts.js — real, pluggable text-to-speech for Hazel.
// Prefers a configured AI TTS provider (OpenAI-compatible) when an API key is
// present; otherwise uses the bundled free neural engine (scripts/tts.py via
// Microsoft Edge TTS). Results are cached so repeated speech is instant.
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

function loadConfig() {
  try { return JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url).pathname, 'utf8')); }
  catch (e) { return {}; }
}

const ttsCfg = () => (loadConfig().tts) || {};
export function voiceName() { return ttsCfg().voice || 'en-US-JennyNeural'; }

// Resolve the configured engine. 'edge' if the python script is available,
// 'openai' if an API key is set. Returns { engine, voice, available }.
export function ttsStatus() {
  const cfg = ttsCfg();
  const openaiKey = process.env[cfg.apiKeyEnv || 'HAZEL_OPENAI_API_KEY'];
  const useOpenAI = !!(cfg.provider === 'openai' && cfg.model && openaiKey);
  return {
    available: true,
    engine: useOpenAI ? 'openai' : 'edge',
    voice: voiceName(),
    model: cfg.model || (useOpenAI ? 'tts-1' : 'edge-tts')
  };
}

const cache = new Map();
function keyFor(text, voice) {
  return createHash('sha1').update(voice + '|' + text).digest('hex');
}

// Synthesize text to audio. Returns { buffer, contentType, engine }.
export async function synthesize(text, voice) {
  text = (text || '').trim();
  if (!text) return { buffer: null, contentType: 'audio/mpeg', engine: ttsStatus().engine };
  voice = voice || voiceName();
  const k = keyFor(text, voice);
  if (cache.has(k)) return { ...cache.get(k), cached: true };

  const status = ttsStatus();
  let result;
  if (status.engine === 'openai') {
    result = await openaiTTS(text, voice);
  } else {
    result = await edgeTTS(text, voice);
  }
  if (!result.ok) {
    // last resort: return empty so the client falls back to browser speech
    return { buffer: null, contentType: 'audio/mpeg', engine: status.engine, error: result.error };
  }
  const out = { buffer: result.buffer, contentType: result.contentType, engine: status.engine };
  cache.set(k, out);
  return out;
}

// Free neural TTS via bundled python script (Microsoft Edge TTS).
function edgeTTS(text, voice) {
  const script = new URL('../scripts/tts.py', import.meta.url).pathname;
  const out = '/tmp/hazel_tts_' + keyFor(text, voice).slice(0, 12) + '.mp3';
  return new Promise((resolve) => {
    execFile('python3', [script, text, voice, out], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (stderr || stdout || err.message).slice(0, 300) });
      try {
        const info = JSON.parse(stdout);
        if (!info.ok) return resolve({ ok: false, error: info.error });
      } catch (e) { /* fallthrough */ }
      try {
        if (!existsSync(out)) return resolve({ ok: false, error: 'no audio produced' });
        const buffer = readFileSync(out);
        return resolve({ ok: true, buffer, contentType: 'audio/mpeg' });
      } catch (e) { return resolve({ ok: false, error: e.message }); }
    });
  });
}

// AI TTS via OpenAI-compatible /audio/speech endpoint.
async function openaiTTS(text, voice) {
  const cfg = ttsCfg();
  const key = process.env[cfg.apiKeyEnv || 'HAZEL_OPENAI_API_KEY'];
  const base = cfg.baseUrl || 'https://api.openai.com/v1';
  const model = cfg.model || 'tts-1';
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, input: text, voice: (cfg.openaiVoice || 'alloy') }),
    });
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const ab = await r.arrayBuffer();
    return { ok: true, buffer: Buffer.from(ab), contentType: r.headers.get('content-type') || 'audio/mpeg' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
