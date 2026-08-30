// commands.js — approved-command sandbox. Runs ONLY commands on the allowlist
// (or the user's approved substitutions) inside the workspace, with a timeout.
import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';

function loadConfig() {
  try { return JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url).pathname, 'utf8')); }
  catch (e) { return { approvedCommands: [] }; }
}

// A command is allowed only if it matches an allowlist entry (prefix match)
// or a user-declared approved command in the same request.
export function isApproved(cmd, extra = []) {
  const allow = [...(loadConfig().approvedCommands || []), ...extra];
  const c = String(cmd).trim();
  return allow.some(a => c === a || c.startsWith(a + ' '));
}

export function runCommand(cmd, { cwd, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? err.code : 0,
        stdout: (stdout || '').slice(0, 4000),
        stderr: (stderr || '').slice(0, 1000),
        timedOut: !!err && err.killed
      });
    });
  });
}
