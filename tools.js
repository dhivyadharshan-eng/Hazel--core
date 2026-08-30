// tools.js — the tool registry. Each tool has a name, schema, sensitivity,
// and an executor. This is the exact surface a real LLM (function-calling)
// and Hazel's deterministic planner both call.
import { webSearch, fetchPage, wikipediaSummary } from './search.js';
import * as mem from './memory.js';
import { listWorkspace, readFileSafe, writeFileSafe, searchFiles, safePath, ROOT } from './fsck.js';
import { runCommand, isApproved } from './commands.js';
import { load, save, uid } from './store.js';

export { ROOT };

function ctxHome(ctx) { return ctx ? ctx.rootDir || undefined : undefined; }

export const TOOLS = {
  web_search: {
    name: 'web_search',
    description: 'Search the live web for a topic. Returns ranked, citable results.',
    params: { query: 'string' },
    sensitive: false,
    run: async (args, ctx) => {
      const r = await webSearch(String(args.query), ctx?.web);
      const cite = r.results.slice(0, 4).map(x => `- **${x.title}** — [link](${x.url})\n  ${x.snippet}`);
      const lead = r.lead?.extract ? `**${r.lead.title}**: ${r.lead.extract.slice(0, 500)}\n\n` : '';
      return {
        ok: true,
        summary: `Found ${r.results.length} source(s) on “${args.query}”.`,
        value: { lead: r.lead, results: r.results },
        reply: lead + cite.join('\n')
      };
    }
  },

  fetch_page: {
    name: 'fetch_page',
    description: 'Fetch and read the readable text of a URL.',
    params: { url: 'string' },
    sensitive: false,
    run: async (args, ctx) => {
      const page = await fetchPage(String(args.url), ctx?.web?.maxPageChars || 3000);
      if (!page.ok) return { ok: false, summary: 'Could not fetch ' + args.url, value: page };
      return { ok: true, summary: 'Fetched ' + page.url, value: page.text };
    }
  },

  list_workspace: {
    name: 'list_workspace',
    description: 'List files & folders in the approved workspace.',
    params: { dir: 'string?', max: 'number?' },
    sensitive: false,
    run: async (args, ctx) => {
      const entries = listWorkspace(args.dir || '').slice(0, args.max || 200);
      return {
        ok: true,
        summary: `Scanned workspace: ${entries.length} items.`,
        value: entries
      };
    }
  },

  read_file: {
    name: 'read_file',
    description: 'Read a file inside the approved workspace.',
    params: { path: 'string' },
    sensitive: false,
    run: async (args, ctx) => {
      const r = readFileSafe(args.path);
      if (r.dir) return { ok: true, summary: 'Is a directory: ' + r.entries.length + ' entries', value: r.entries };
      return { ok: true, summary: 'Read ' + r.path, value: r.content };
    }
  },

  search_files: {
    name: 'search_files',
    description: 'Search workspace filenames & contents for a query.',
    params: { query: 'string' },
    sensitive: false,
    run: async (args, ctx) => {
      const hits = searchFiles(args.query);
      return { ok: true, summary: `${hits.length} match(es) for “${args.query}”`, value: hits };
    }
  },

  write_file: {
    name: 'write_file',
    description: 'Write content to a file in the approved workspace. Requires approval.',
    params: { path: 'string', content: 'string' },
    sensitive: true,
    run: async (args, ctx) => {
      ensureApproved(ctx, 'write_file:' + args.path);
      const r = writeFileSafe(args.path, args.content);
      return { ok: true, summary: `Wrote ${r.bytes} bytes to ${r.written}`, value: r };
    }
  },

  run_command: {
    name: 'run_command',
    description: 'Run an approved shell command in the workspace. Requires approval.',
    params: { command: 'string', cwd: 'string?' },
    sensitive: true,
    run: async (args, ctx) => {
      const extra = (ctx?.userApprovedCommands) || [];
      if (!isApproved(args.command, extra)) {
        return { ok: false, summary: 'Command not on the approved list: ' + args.command, value: { denied: true } };
      }
      ensureApproved(ctx, 'run_command:' + args.command);
      // Resolve cwd under the workspace root (safe), defaulting to root.
      let cwd = ctxHome(ctx);
      if (args.cwd) cwd = safePath(args.cwd);
      const r = await runCommand(args.command, { cwd });
      return { ok: r.ok, summary: (r.ok ? 'Ran' : 'Command failed') + ': ' + args.command, value: r };
    }
  },

  memory_add: {
    name: 'memory_add',
    description: 'Persist a fact Hazel should remember about the user.',
    params: { text: 'string', tag: 'string?' },
    sensitive: false,
    run: async (args) => {
      const item = mem.addMemory(args.text, args.tag || 'you');
      return { ok: true, summary: `Remembered: ${item.text}`, value: item };
    }
  },

  memory_search: {
    name: 'memory_search',
    description: 'Retrieve relevant remembered facts (semantic search).',
    params: { query: 'string' },
    sensitive: false,
    run: async (args) => {
      const hits = mem.searchMemory(args.query);
      return { ok: true, summary: `${hits.length} relevant fact(s)`, value: hits };
    }
  },

  memory_list: {
    name: 'memory_list',
    description: 'List all remembered facts.',
    params: {},
    sensitive: false,
    run: async () => ({ ok: true, summary: `${mem.countMemory()} facts`, value: mem.listMemory() })
  },

  memory_delete: {
    name: 'memory_delete',
    description: 'Forget a remembered fact by id.',
    params: { id: 'string' },
    sensitive: false,
    run: async (args) => {
      const list = mem.deleteMemory(args.id);
      return { ok: true, summary: `Forgot #${args.id}. ${list.length} facts remain.`, value: list };
    }
  },

  task_add: { name: 'task_add', description: 'Add a task.', params: { text: 'string', pri: 'string?' }, sensitive: false,
    run: async (a) => { const t = load('tasks.json', []); const it = { id: uid('t'), text: a.text, done: false, pri: a.pri || 'med' }; t.push(it); save('tasks.json', t); return { ok: true, summary: `Added task: ${a.text}`, value: it }; } },
  task_list: { name: 'task_list', description: 'List tasks.', params: {}, sensitive: false,
    run: async () => ({ ok: true, summary: `${load('tasks.json', []).length} tasks`, value: load('tasks.json', []) }) },
  task_toggle: { name: 'task_toggle', description: 'Mark a task done/undone.', params: { id: 'string' }, sensitive: false,
    run: async (a) => { const t = load('tasks.json', []); const it = t.find(x => x.id === a.id); if (!it) return { ok: false, summary: 'No task ' + a.id, value: {} }; it.done = !it.done; save('tasks.json', t); return { ok: true, summary: `Task "${it.text}" ${it.done ? 'done' : 'reopened'}`, value: it }; } },

  calendar_list: { name: 'calendar_list', description: 'List calendar entries (optionally for a date).', params: { date: 'string?' }, sensitive: false,
    run: async (a) => { const c = load('calendar.json', []); const f = a.date ? c.filter(e => (e.date || '').startsWith(a.date)) : c; return { ok: true, summary: `${f.length} event(s)`, value: f }; } },
  calendar_add: { name: 'calendar_add', description: 'Add a calendar event.', params: { title: 'string', date: 'string', tag: 'string?' }, sensitive: false,
    run: async (a) => { const c = load('calendar.json', []); const it = { id: uid('c'), title: a.title, date: a.date, tag: a.tag || 'misc' }; c.push(it); save('calendar.json', c); return { ok: true, summary: `Added: ${a.title}`, value: it }; } },

  notifications_list: { name: 'notifications_list', description: 'List current notifications/alerts.', params: {}, sensitive: false,
    run: async () => ({ ok: true, summary: `${load('notifications.json', []).length} notifications`, value: load('notifications.json', []) }) },

  current_time: { name: 'current_time', description: 'Get current local date/time.', params: {}, sensitive: false,
    run: async () => ({ ok: true, summary: new Date().toLocaleString(), value: new Date().toISOString() }) },
};

// Gating: sensitive tools require the session to be approved for that action.
export function ensureApproved(ctx, action) {
  if (!ctx?.approvedSensitive) {
    const err = new Error('NEEDS_APPROVAL_' + action);
    err.needsApproval = action;
    throw err;
  }
}

export function toolNames() { return Object.keys(TOOLS); }

export async function callTool(name, args, ctx) {
  const t = TOOLS[name];
  if (!t) throw new Error('Unknown tool: ' + name);
  return t.run(args || {}, ctx);
}

// A brief, presentable summary for a tool result (used in the UI).
export function describeResult(name, res) {
  const prefix = name.replace(/_/g, ' ');
  if (res && res.summary) return res.summary;
  return prefix + ' → ok';
}
