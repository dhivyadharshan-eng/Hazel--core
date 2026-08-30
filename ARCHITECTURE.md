# 🧠 Hazel Architecture — From Prototype to AI Control Layer

`index.html` is a **client-side demonstration** of Hazel's interface and orchestration. This document is the blueprint for turning her into a real, always-on control layer for your digital life. It's organized so each phase is buildable on its own.

---

## 1. Core philosophy

> **"You describe an outcome. Hazel plans, asks permission, executes, and reports."**

That means Hazel is not a *chatbot* stuffed with tools — she's an **agent** with:

1. **Intent understanding** (do this)
2. **Planning** (here's how I'll do it)
3. **Tool invocation** (with explicit, logged approvals)
4. **Self-reporting** (here's what happened / what went wrong)

The magic is **chaining**: "I'm going to work" → check calendar + notifications + open workspace + start services + brief you.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         UI (Hazel Core)                      │
│   chat · voice waveform · mode switcher · dashboards · logs │
└───────────────▲────────────────────────────┬────────────────┘
                │                            │
        ┌───────┴────────┐            ┌──────▼──────┐
        │  /hazel/say    │            │  /hazel/act │
        └───────┬────────┘            └──────┬──────┘
                │                            │
        ┌───────▼────────────────────────────▼──────┐
        │              ORCHESTRATOR                    │
        │  understanding → plan → approve → execute    │
        └───┬────────┬─────────┬─────────┬─────────┬──┘
            │        │         │         │         │
   ┌────────▼──┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼────┐ ┌─▼─────────┐
   │ MODELS    │ │ MEMORY │ │ TOOLS   │ │ VOICE │ │ SECURITY  │
   │ LLM / NLU │ │ store  │ │ ① web  │ │ TTS   │ │ perms ·   │
   │ planning  │ │ vector │ │ ② files│ │ STT   │ │ audit log │
   │ tool-use  │ │ + graph │ │ ③ code │ │ wake  │ │ approvals │
   └───────────┘ └────────┘ └──┬────┘ └────────┘ └───────────┘
                               │
                 ┌─────────────▼─────────────┐
                 │  SANDBOXED EXECUTION       │
                 │  docker / VM / serverless  │
                 │  approved app control      │
                 └───────────────────────────┘
```

---

## 3. Components (build in order)

### A. **Orchestrator** — the brain
The heart of Hazel. A loop that:
1. Takes a natural-language outcome.
2. **Plans** a graph of steps (using an LLM with tool-use or, for deterministic paths, a rule engine like the one in the prototype).
3. **Asks permission** where a step touches files, apps, or destructive actions.
4. **Executes** each step with visibility (live step progress — already simulated in `index.html`).
5. **Reports** with a recap and next-best actions.
6. **Logs** every step to an audit trail.

### B. **Memory** — continuity
- **Short-term:** conversation context (sliding window).
- **Long-term:** a vector store (embeddings) + optional knowledge graph for facts, projects, preferences.
- **Explicit opt-in:** Hazel only persists what you approve, and you can see/edit/forget any entry (already in the UI).
- Tip: add a "forget everything about X" command and a ttl for stale facts.

### C. **Tool layer** — what she can reach
Each tool declares a **capability descriptor** so Hazel knows when to use it and what it's allowed to do:

| Tool | Actions | Approval needed |
|---|---|---|
| 🌐 **Web** | search, fetch, cite | Read-only — auto |
| 📁 **Files** | find, list, read, create, organize | Read auto · write = confirm |
| 👨💻 **Code** | create/edit files, run tests, lint, git | Sandboxed — confirm |
| 🖥️ **Computer** | open apps, run approved commands, control workspace | **Always confirm** |
| 📅 **Calendar/Tasks** | read, create, update events, reminders, schedules | Reads auto · writes confirm |
| 📱 **Comm** | draft/send messages, initiate calls | **Always confirm** |
| ⚙️ **Automation** | define & run scheduled workflows | User-owned, logged |

### D. **Voice stack**
- **Wake word** "Hey Hazel" — on-device continuous listening (e.g. openWakeWord / Porcupine), with hotword + graceful fallback.
- **Speech-to-text** for dictation (Web Speech API in prototype; Whisper on-device for privacy).
- **Text-to-speech** for responses, with **interruption** support (barge-in: she stops when you start talking).
- Whisper + RAG → live natural conversations.

### E. **Security & permissions** — non-negotiable
- **Scope of authority:** everything is deny-by-default; Hazel operates within what you approve.
- **Approval flows:** interactive confirmations for any sensitive action (UI already has a Permissions modal).
- **Audit log:** every tool call recorded — who/what/when/result.
- **Secrets:** never loaded into the LLM; vaulted separately.
- **Sandboxing:** all code execution in a container/VM with no access to your keys or home dir.

### F. **Modes** — personas that change behavior
| Mode | Enabled tools | Behavior |
|---|---|---|
| 🎙️ **Assistant** | chat, memory, calendar | Everyday help |
| 💻 **Developer** | code, files, git, tests | Project-aware, terse technical output |
| 🔎 **Research** | web search, fetch, summarize | Cites sources, synthesizes |
| ⚙️ **Automation** | scheduled jobs | Runs on triggers/CRON |
| 🖥️ **Computer** | apps, commands, workspace | Confirmed control |
| 🧠 **Focus** | projects, notification filtering | Mutes distractions, single-context |
| 🚨 **Alert** | monitoring, notifications | Proactive alerts & system events |

### G. **Automation / scheduling**
- Define **triggers** (time, event, file change, message) mapped to workflows.
- Hazel notifies you, then executes (or proposes) an action.
- Store recurring jobs with a scheduler (cron) and provide a "what's running?" dashboard.

---

## 4. Reference stack (suggested)

| Concern | Option |
|---|---|
| Orchestration / planning | An agent framework (LangGraph, CrewAI) or a thin custom loop over an LLM with function-calling |
| Language model | GPT-4o / Claude / Llama-3 (self-hosted for privacy) |
| Memory | pgvector / Qdrant + optional graph (neo4j) |
| Voice | Wake: openWakeWord · STT: Whisper · TTS: Piper / ElevenLabs |
| File & app control | Approved path allowlist + OS automation (macOS: AppleScript/Shortcuts; Windows: PowerShell) |
| Sandboxed execution | Docker / Firecracker / serverless functions |
| Scheduler | Celery / cron / Agent running in background as a service |
| Persistence & logs | Postgres + structured event log |
| **Security** | OAuth-scoped permissions, deny-by-default, full audit log |

---

## 5. Roadmap

- **v0.9** — Interface + intent engine + orchestration simulation, fully client-side.
- **v1.0** — ✅ Real backend. Live tool registry (`src/tools.js`), real web search (`search.js`), persistent memory (`memory.js`), safe file access (`fsck.js`), approved-command sandbox (`commands.js`), permission gating + audit log, and live orchestration streamed via Server-Sent Events. LLM adapter present (`llm.js`) — drops in a key to switch from the deterministic planner to real function-calling.
- **v1.1 (this)** — ✅ Real voice. Server-side neural TTS (`src/tts.js` + `scripts/tts.py` via edge-tts, OpenAI-compatible optional), an audio player in-chat, and a continuous "Hey Hazel" wake-word loop (Web Speech) with a chime and command capture. Falls back to browser TTS if the engine is absent.
- **v1.5** — Vector-store memory, barge-in/interruption, richer voice control (rate/voice switching).
- **v2.0** — Computer mode: approved app/file control, real workspace interaction, dev-server management.
- **v2.5** — Automation engine: scheduled workflows, proactive notifications, integrations (Calendar, Mail, Messaging).
- **v3.0** — A genuine background agent that runs your day: "good morning" briefs, project sessions, and end-of-day summaries, all with permission-first security.

---

> **Safety first.** Hazel never acts without your approval on anything touching your data, files, or machine. Every action is visible, reversible where possible, and logged. That trust is what makes an AI control layer worth having.
