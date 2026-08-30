// llm.js — pluggable LLM adapter. If a key is present (env HAZEL_OPENAI_API_KEY)
// Hazel uses a real model with function calling. Otherwise the orchestrator
// falls back to its deterministic planner over the same tool registry.
import { readFileSync } from 'node:fs';

function config() {
  try { return JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url).pathname, 'utf8')); }
  catch (e) { return { llm: {} }; }
}

export function llmConfigured() {
  const cfg = config().llm || {};
  const key = process.env[cfg.apiKeyEnv || 'HAZEL_OPENAI_API_KEY'];
  return !!(cfg.model && key);
}

export function modelName() {
  const cfg = config().llm || {};
  return cfg.model || 'gpt-4o-mini';
}

function schemaFromTools() {
  return [
    { type: 'function', function: { name: 'run_tool', description: 'Invoke a Hazel tool and return its result.', parameters: {
        type: 'object', properties: {
          tool: { type: 'string', enum: ['web_search','fetch_page','list_workspace','read_file','search_files','write_file','run_command','memory_add','memory_search','memory_list','memory_delete','task_add','task_list','task_toggle','calendar_list','calendar_add','notifications_list','current_time'] },
          args: { type: 'object', description: 'Tool arguments.' }
        }, required: ['tool','args']
    } } }
  ];
}

// Optional: offload reply composition to the LLM when configured.
export async function composeReply(mode, plan, toolResults, userMessage) {
  const cfg = config().llm || {};
  const key = process.env[cfg.apiKeyEnv || 'HAZEL_OPENAI_API_KEY'];
  if (!key || !cfg.model) return null;

  const resultLog = toolResults.map(r => `- tool=${r.name}: ${r.result?.summary || 'ok'}`).join('\n') || '(none)';
  const planLog = plan.map(p => `- ${p.tool}(${p.human})`).join('\n');
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: `You are Hazel, a concise personal AI control layer in ${mode} mode. Summarize what you did for the user in 2-4 tight sentences, then suggest 1 next step. No fluff.` },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: `Plan:\n${planLog}\nResults:\n${resultLog}` }
    ],
    max_tokens: 300
  };
  try {
    const r = await fetch((cfg.baseUrl || 'https://api.openai.com/v1') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}
