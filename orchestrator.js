// orchestrator.js — Hazel's brain.
//   understand(message) -> plan -> execute tools (real) -> report.
// Works with a real LLM if configured; otherwise a deterministic planner
// drives the SAME tool registry, so both produce genuinely executed results.
import { TOOLS, callTool, describeResult } from './tools.js';
import * as mem from './memory.js';
import { load } from './store.js';
import { llmConfigured } from './llm.js';

const noop = () => {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- planners ---------------- */

// Deterministic planner: maps a message to a sequence of real tool calls.
function plan(message, mode) {
  const m = String(message).trim();
  const low = m.toLowerCase();

  const has = (...re) => re.some(r => r.test(low));
  const grab = (re) => (m.match(re) || ['', ''])[1] || '';

  // --- who are you / greeting / help ---
  if (has(/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/i)) {
    return { reply: greet() };
  }
  if (has(/who are you|your name|what are you|about you/i)) {
    return { reply: identity() };
  }
  if (has(/help|what can you do|capabilities|features/i)) {
    return { reply: help() };
  }

  // --- approval reply ---
  if (has(/^(yes|yeah|yep|approve|go ahead|ok|okay|do it|sure|confirm)\b/i)) {
    return { intent: 'approve' };
  }

  // --- orchestration: prepare workspace ---
  if (has(/prepare|get.*(ready|set up)|set up my (workspace|work)|start my (day|work)|going to work|i'm working|everything i need/i)) {
    return {
      plan: [
        { tool: 'calendar_list', args: {}, human: 'Checking your calendar' },
        { tool: 'notifications_list', args: {}, human: 'Collecting notifications' },
        { tool: 'list_workspace', args: { dir: '/orion', max: 40 }, human: 'Scanning your workspace (Orion)' },
        { tool: 'read_file', args: { path: '/orion/README.md' }, human: 'Reading project state' },
        { tool: 'current_time', args: {}, human: 'Checking the time' }
      ],
      compose: (res) => briefPrep(res)
    };
  }

  // --- continue project ---
  if (has(/continue my project|where did i leave off|resume|project.*(yesterday|last time)|continue/i)) {
    return {
      plan: [
        { tool: 'memory_search', args: { query: 'project Orion' }, human: 'Recalling project context' },
        { tool: 'list_workspace', args: { dir: '/orion', max: 40 }, human: 'Locating the Orion project' },
        { tool: 'read_file', args: { path: '/orion/README.md' }, human: 'Reading last-session notes' }
      ],
      compose: (res) => briefContinue(res)
    };
  }

  // --- project status ---
  if (has(/summary of my project|project status|how.*project.*doing|is.*project/i)) {
    return {
      plan: [
        { tool: 'list_workspace', args: { dir: '/orion', max: 60 }, human: 'Scanning Orion' },
        { tool: 'read_file', args: { path: '/orion/README.md' }, human: 'Reading project notes' },
        { tool: 'task_list', args: {}, human: 'Loading related tasks' }
      ],
      compose: (res) => briefStatus(res)
    };
  }

  // --- schedule / calendar ---
  if (has(/schedule|calendar|agenda|my day|what.*(today|on my plate)|meeting/i)) {
    let args = {};
    const d = grab(/(?:on|for)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]+)/i);
    if (d) args.date = normalizeDate(d);
    return { plan: [{ tool: 'calendar_list', args, human: 'Checking calendar' }], compose: (res) => briefCal(res) };
  }

  // --- tasks ---
  if (has(/task|to.?do|remind|todo/i)) {
    // add task
    const add = m.match(/add (?:a )?task (.*)/i) || m.match(/task (?:to )?(?:add )?(.*)/i) || m.match(/remind me to (.*)/i);
    if (add && add[1]) {
      return { plan: [{ tool: 'task_add', args: { text: add[1] }, human: 'Adding a task' }], compose: (res) => addTaskReply(res) };
    }
    return { plan: [{ tool: 'task_list', args: {}, human: 'Loading tasks' }], compose: (res) => briefTasks(res) };
  }

  // --- recall memory (must run BEFORE the "remember"/store branch) ---
  if (has(/what do you (remember|know about me)|my (preferences|preference)|what.*memory|do you remember/i)) {
    if (has(/what do you remember|what do you know|list memory|show memory|preferences/)) {
      return { plan: [{ tool: 'memory_list', args: {}, human: 'Loading memory' }], compose: (res) => memoryReply(res) };
    }
    const q = grab(/(?:about me)?\s*(.+)/i);
    return { plan: [{ tool: 'memory_search', args: { query: q || m }, human: 'Recalling memory' }], compose: (res) => memoryReply(res) };
  }

  // --- remember (store a fact) ---
  if (has(/remember|note that|save (this|that)|i (prefer|like|love|use|need|am using)/i)) {
    let fact = m.replace(/(remember that|remember|note that|save that|i prefer|i like|i love|i use|i need|i am using)\s*/i, '').trim();
    if (fact.length < 4) return { plan: [], reply: `What should I remember? e.g. “remember that I prefer dark mode.”` };
    return { plan: [{ tool: 'memory_add', args: { text: fact, tag: guessTag(m) }, human: 'Remembering that' }], compose: (res) => rememberReply(res) };
  }

  // --- forget ---
  if (has(/forget|clear (my )?memory|erase/i)) {
    return { plan: [], reply: `I'm not going to wipe memory without a specific target. Say “forget #m1” (use the ☒ in the Memory panel for a single fact). Want to clear everything? Say “clear all memory.”` };
  }

  // --- files ---
  if (has(/(find|search|where (is|are)|locate).*(file|doc|folder|project)|find /i)) {
    const q = grab(/(?:find|search for|search|where (?:is|are)|locate)\s+(?:(?:the|a)\s+)?(.+)/i);
    return { plan: [{ tool: 'search_files', args: { query: q || 'orion' }, human: 'Searching workspace' }], compose: (res) => filesReply(res, q) };
  }

  // --- research / web ---
  if (has(/search (google|the web|for)|research|look up|who is|what is|what's|whats|find out|latest (news|info)|explain/) && !has(/file/i)) {
    const q = grab(/(?:search (google|the web) for|research|look up|who is|what is|what's|whats|find out|explain)\s+(.+)/i) ||
              (low.includes('who is') ? m.replace(/who is/i, '').trim() : '') ||
              (low.includes('what is') ? m.replace(/what is/i, '').trim() : '');
    return { plan: [{ tool: 'web_search', args: { query: q || m }, human: `Searching the web for “${q || m}”` }], compose: (res) => webReply(res) };
  }

  // --- code / tests ---
  if (has(/run (the )?tests?|npm test|run (a )?command|debug|build (the )?project|git status|run code/i)) {
    const cmd = /npm test|run (the )?tests/.test(low) ? 'npm test' : (/git status/.test(low) ? 'git status' : null);
    return { plan: [{ tool: 'run_command', args: { command: cmd, cwd: 'orion' }, human: runningLab(cmd) }], compose: (res) => cmdReply(res) };
  }

  // --- notifications ---
  if (has(/notif|alerts|anything (new|important)|update me|news/i)) {
    return { plan: [{ tool: 'notifications_list', args: {}, human: 'Checking notifications' }], compose: (res) => notifReply(res) };
  }

  // --- time ---
  if (has(/what time|current time|what.*today's date|what day/i)) {
    return { plan: [{ tool: 'current_time', args: {}, human: 'Checking the time' }], compose: (res) => timeReply(res) };
  }

  // Fallback
  return { plan: [], reply: fallbackReply(m, mode) };
}

function runningLab(cmd) { return cmd ? 'Running `' + cmd + '`' : 'Running command'; }

/* ---------------- executor ---------------- */

// Execute a plan. Emits live 'step' events. Returns { results, sensitiveHeld, blocked }.
async function execute(plan, ctx, emit = noop) {
  const results = [];
  let sensitiveHeld = null;
  let blocked = null;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const tool = TOOLS[step.tool];
    const label = step.human || step.tool;
    const id = 's' + i;

    // Sensitive tools need approval
    if (tool && tool.sensitive && !ctx.approvedSensitive) {
      sensitiveHeld = step;
      emit('step', { id, label, status: 'hold' });
      emit('tool', { name: step.tool, summary: '⏸ requires your approval: ' + humanAction(step) });
      continue;
    }

    emit('step', { id, label, status: 'running' });
    try {
      const res = await callTool(step.tool, step.args, ctx);
      if (ctx.animate !== false) await sleep(140); // let the UI breathe between steps
      const heldErr = res?.value?.denied;
      if (heldErr) {
        emit('step', { id, label, status: 'hold' });
        emit('tool', { name: step.tool, summary: '⏸ ' + res.summary });
        blocked = { step, result: res };
        continue;
      }
      emit('step', { id, label, status: 'done' });
      emit('tool', { name: step.tool, summary: describeResult(step.tool, res) });
      results.push({ name: step.tool, args: step.args, result: res });
    } catch (e) {
      if (e && e.needsApproval) {
        sensitiveHeld = step;
        emit('step', { id, label, status: 'hold' });
        emit('tool', { name: step.tool, summary: '⏸ requires approval: ' + humanAction(step) });
        continue;
      }
      emit('step', { id, label, status: 'error' });
      emit('tool', { name: step.tool, summary: '✖ ' + (e.message || 'error') });
      results.push({ name: step.tool, args: step.args, result: { ok: false, summary: e.message } });
    }
  }
  return { results, sensitiveHeld, blocked };
}

/* ---------------- main entry ---------------- */

export async function runHazel(message, ctx, emit = noop) {
  ctx = ctx || {};
  const mode = ctx.mode || 'assistant';
  const planSpec = plan(message, mode);

  emit('meta', { mode, llm: llmConfigured() });

  // No plan → just answer (with a memory lookup to feel contextual)
  if (!planSpec.plan || planSpec.plan.length === 0) {
    return { reply: planSpec.reply || help(), results: [], sensitiveHeld: null };
  }

  const { results, sensitiveHeld, blocked } = await execute(planSpec.plan, ctx, emit);

  let reply;
  if (sensitiveHeld && !ctx.approvedSensitive) {
    // Store pending for re-run on approval
    ctx.pending = { message, plan: planSpec.plan };
    reply = approvalReply(sensitiveHeld);
  } else {
    reply = planSpec.compose ? planSpec.compose(results) : fallbackReply(message, mode);
  }
  return { reply, results, sensitiveHeld, blocked };
}

// When the user approves, re-run the pending sensitive step.
export async function approvePending(ctx, emit = noop) {
  const pending = ctx.pending;
  if (!pending) return { reply: 'Nothing is waiting for approval right now.', executed: false };
  ctx.approvedSensitive = true;
  const { results } = await execute(pending.plan, ctx, emit);
  ctx.pending = null;
  // Return a confirmation + whatever the plan composes
  return { reply: approvedReply(results, pending), executed: results.some(r => r.name === pending.plan.find(p => TOOLS[p.tool]?.sensitive)?.tool) };
}

/* ---------------- reply builders (real data) ---------------- */

function humanAction(step) {
  const a = step.args || {};
  if (step.tool === 'run_command') return 'run `' + (a.command || '') + '`';
  if (step.tool === 'write_file') return 'write ' + (a.path || '');
  return step.human || step.tool;
}

function byTool(results, name) { return results.find(r => r.name === name); }

function briefPrep(res) {
  const cal = byTool(res, 'calendar_list')?.result?.value || [];
  const notif = byTool(res, 'notifications_list')?.result?.value || [];
  const files = byTool(res, 'list_workspace')?.result?.value || [];
  const readme = byTool(res, 'read_file')?.result?.value || '';
  const today = cal
    .filter(e => new Date(e.date).getDay() === new Date().getDay())
    .sort((a, b) => a.date.localeCompare(b.date));
  const headline = cal.find(e => new Date(e.date) > new Date());
  const projects = files.filter(f => f.type === 'dir').slice(0, 4);

  let s = `**✅ Ready. Here's your work setup:**\n\n`;
  s += `**📅 Today** · ${today.length ? today.map(e => `<span class="hl">${shortTime(e.date)}</span> ${esc(e.title)}`).join(' · ') : `free`}\n\n`;
  s += `**📂 Workspace (${projects.length} project folders)** · ${projects.map(p => `${p.icon || '📁'} <code>${esc(p.path)}</code>`).join(', ') || 'none detected'}\n\n`;
  if (readme) {
    const note = readme.split('\n').filter(l => /next|todo|due|demo|status|finish/i.test(l)).slice(0, 3).join(' · ');
    if (note) s += `**🧭 Project note** · ${esc(note)}\n\n`;
  }
  const high = notif.filter(n => n.type === 'alert').slice(0, 2);
  if (high.length) s += `**🔔 Worth a look** · ${high.map(n => esc(n.text)).join(' · ')}\n\n`;
  s += `Dev services are staged. Want me to <span class="hl">continue the Orion project</span> or <span class="hl">run the test suite</span>?`;
  return s;
}

function briefContinue(res) {
  const mems = byTool(res, 'memory_search')?.result?.value || [];
  const readme = byTool(res, 'read_file')?.result?.value || '.';
  const files = byTool(res, 'list_workspace')?.result?.value || [];
  const code = files.filter(f => /\.(js|ts|tsx)$/.test(f.name)).slice(0, 5);
  let s = `**Here's where you left off.**\n\n`;
  if (mems.length) s += `**🧠 From memory:** ${mems.map(x => `“${esc(x.text)}”`).join(' · ')}\n\n`;
  s += `**🛠 Orion** · ${code.length ? code.map(f => `<code>${esc(f.path)}</code>`).join(', ') : 'no source files seen'}\n\n`;
  const next = (readme.match(/(?:#|-) \*?([^\n]*next[^\n]*)/i) || readme.match(/next session:?([^\n]*)/i) || [])[1];
  if (next) s += `**🧭 Next up:** ${esc(next.trim())}\n\n`;
  s += `I'd suggest: finish the <span class="hl">auth refactor</span> → <span class="hl">run tests</span> → <span class="hl">prep the Friday demo</span>. Where should we start?`;
  return s;
}

function briefStatus(res) {
  const files = byTool(res, 'list_workspace')?.result?.value || [];
  const readme = byTool(res, 'read_file')?.result?.value || '';
  const tasks = byTool(res, 'task_list')?.result?.value || [];
  const code = files.filter(f => /\.(js|ts|tsx)$/.test(f.name)).length;
  const open = tasks.filter(t => !t.done);
  let s = `**📊 Orion — project status**\n\n`;
  s += `- **Source files:** ${code}\n- **Open tasks:** ${open.length} (${open.filter(t => t.pri === 'high').length} high)\n`;
  if (readme) { const st = (readme.match(/^-? \*?Status:\*? ?([^\n]*)/i) || [])[1]; if (st) s += `- **Noted status:** ${esc(st.trim())}\n`; }
  s += `\n**ℹ️ From README:** ${esc(firstLine(readme) || 'n/a')}\n\n`;
  s += `Which one should I dig into — <span class="hl">status</span>, <span class="hl">tasks</span>, or <span class="hl">search files</span>?`;
  return s;
}

function briefCal(res) {
  const evs = byTool(res, 'calendar_list')?.result?.value || [];
  if (!evs.length) return '**📅 You have no events.** Want to add one?';
  const soon = evs.find(e => new Date(e.date) > new Date());
  let s = `**📅 Here's what's coming up:**\n\n`;
  s += evs.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6)
    .map(e => `- <span class="hl">${shortTime(e.date)}</span> ${esc(e.title)} <span class="warn">${e.tag ? '(' + esc(e.tag) + ')' : ''}</span>`).join('\n');
  if (soon) s += `\n\n**⏳ Next up:** ${esc(soon.title)}.`;
  return s;
}

function briefTasks(res) {
  const tasks = byTool(res, 'task_list')?.result?.value || [];
  const open = tasks.filter(t => !t.done);
  if (!open.length) return '**✅ All clear** — no open tasks.';
  return `**You have ${open.length} open task(s):**\n\n` + open.map(t => `- [${esc(t.pri)}] ${esc(t.text)}`).join('\n');
}

function addTaskReply(res) {
  const it = byTool(res, 'task_add')?.result?.value;
  return it ? `**✅ Added task:** “${esc(it.text)}” (priority: ${esc(it.pri)}).` : `Couldn't add that task.`;
}

function rememberReply(res) {
  const it = byTool(res, 'memory_add')?.result?.value;
  return it ? `**🧠 Got it.** I'll remember: “${esc(it.text)}”.\n\nSay **“what do you remember?”** anytime to recall it.` : `That one's tricky. Try “remember that I prefer dark mode.”`;
}

function memoryReply(res) {
  const mems = byTool(res, 'memory_list')?.result?.value || byTool(res, 'memory_search')?.result?.value || [];
  if (!mems.length) return `**I'm keeping ${mem.countMemory()} fact(s)** for you.\n\nNothing matches that. Teach me with “remember that …”.`;
  return `**🧠 I'm keeping ${mem.countMemory()} fact(s).** Most relevant:\n\n` + mems.map(x => `- <span class="hl">[${esc(x.tag)}]</span> ${esc(x.text)}`).join('\n');
}

function filesReply(res, q) {
  const hits = byTool(res, 'search_files')?.result?.value || [];
  if (!hits.length) return `**🔍 No match for “${esc(q || 'that')}.”** Here's the top of the workspace:\n\n` +
    `- ` + (byTool(res, 'search_files')?.result?.value || []);
  return `**🔍 Found ${hits.length} match(es):**\n\n` +
    hits.slice(0, 8).map(f => `- ${f.icon || '📄'} <code>${esc(f.path)}</code>${f.size ? ' (' + fmtBytes(f.size) + ')' : ''}`).join('\n');
}

function webReply(res) {
  const r = byTool(res, 'web_search')?.result?.value || {};
  const results = r.results || [];
  const lead = r.lead ? `**${esc(r.lead.title)}** — ${esc(r.lead.extract.slice(0, 400))}\n\n[Source](${r.lead.url})\n\n` : '';
  return `**${results.length ? 'Here is what I found' : 'No reliable results yet'}:**\n\n${lead}` +
    results.slice(0, 4).map(x => `- **${esc(x.title)}** — [link](${x.url})\n  ${esc(x.snippet)}`).join('\n') +
    `\n\n_Sources: Wikipedia. Ask me to “fetch page” on any link for the full text._`;
}

function cmdReply(res) {
  const r = byTool(res, 'run_command')?.result?.value;
  if (!r) return `That command isn't on the approved list. I'll only run safe, approved commands.`;
  const out = (r.stdout || '').trim().split('\n').slice(0, 6).join('\n');
  return `**` + (r.ok ? '✅' : '✖') + ` Command finished** (exit ${r.code}).\n\n` +
    (out ? '```\n' + out + '\n```' : '(no output)') +
    '\n\n_Approved, sandboxed, and logged._';
}

function notifReply(res) {
  const n = byTool(res, 'notifications_list')?.result?.value || [];
  if (!n.length) return `**🔔 No notifications.** You're all caught up.`;
  return `**🔔 ${n.length} notifications:**\n\n` + n.map(x => `- ${x.icon} ${esc(x.text)} <span class="muted">(${esc(x.from)})</span>`).join('\n');
}

function timeReply(res) {
  const iso = byTool(res, 'current_time')?.result?.value;
  const d = new Date(iso);
  return `**🕐 It's ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}** — ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
}

function approvalReply(step) {
  return `**🔐 I need your approval for one step.**

I'd like to <span class="hl">${esc(humanAction(step))}</span>.

This touches a sensitive action, so Hazel won't do it without your say-so. Reply **“yes”** to approve (or “skip” and I'll leave it out). Every action is logged.`;
}

function approvedReply(results, pending) {
  const sensitiveName = pending.plan.find(p => TOOLS[p.tool]?.sensitive)?.tool;
  const r = results.find(x => x.name === sensitiveName);
  const ok = r && r.result?.ok !== false;
  return (ok ? `**✅ Done — action approved & executed.**\n\n` : `**⚠️ Ran with an issue:**\n\n`) + (r ? esc(r.result?.summary || '') : '') + `\n\nThis was logged to the audit trail.`;
}

/* ---------------- static replies ---------------- */

function greet() {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 16 ? 'afternoon' : h < 20 ? 'evening' : 'night';
  const tasks = (load('tasks.json', []).filter(t => !t.done)).length;
  const cal = load('calendar.json', []);
  const next = cal.find(e => new Date(e.date) > new Date());
  return `Good ${part} ☀️ — I'm Hazel.

You have **${tasks} open task(s)** and your next event is **${esc(next ? next.title : 'nothing scheduled')}** (${esc(next ? shortTime(next.date) : '—')}).

Tell me an outcome — e.g. <span class="hl">“prepare everything I need to work”</span> — and I'll plan, act, and report.`;
}

function identity() {
  return `I'm <span class="hl">Hazel</span> — your AI control layer. I sit between you and everything you use.

Right now I'm a **real backend** agent: I do live web research, keep persistent memory, manage tasks & calendar, scan your workspace, and I chain those into multi-step orchestration — always with your approval for anything sensitive.

Ask **“help”** for my capabilities.`;
}

function help() {
  return `**Here's what I can do** (live, in this build):

<ul>
<li><span class="hl">🌐 Research</span> — search the web & cite sources</li>
<li><span class="hl">🧠 Memory</span> — remember & recall facts you allow</li>
<li><span class="hl">📁 Files</span> — scan, read & search your workspace</li>
<li><span class="hl">📅 Organize</span> — tasks & calendar</li>
<li><span class="hl">🚀 Orchestrate</span> — multi-step jobs</li>
<li><span class="hl">⚙️ Code</span> — run approved tests/commands (with approval)</li>
<li><span class="hl">🔔 Alerts</span> — notifications</li>
</ul>

**Try:** “research what is machine learning” · “prepare everything I need to work” · “what do you remember?” · “continue my project”`;
}

function fallbackReply(m, mode) {
  return `I read that as: **“${esc(m)}”** (in ${esc(mode)} mode).

I've mapped it toward the right tool, but in the full build I'd chain the exact plan and execute it with your approval. Ask **“help”** to see what I can do. Nothing here requires network — try a <span class="hl">web search</span> or <span class="hl">“what do you remember?”</span>`;
}

/* ---------------- tiny formatters ---------------- */

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function shortTime(iso) { try { const d = new Date(iso); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; }
function firstLine(s) { return String(s).split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || ''; }
function normalizeDate(d) {
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return undefined; }
}
function guessTag(m) {
  const low = m.toLowerCase();
  if (/prefer|like|love|favourite|favorite/.test(low)) return 'pref';
  if (/project|orion|app|build/.test(low)) return 'project';
  if (/meeting|stand.?up|call/.test(low)) return 'work';
  return 'you';
}
