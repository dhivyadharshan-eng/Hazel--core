// Orion — real-time analytics dashboard. Entry point.
const { authService } = require('./services/auth.service');

function start() {
  const svc = authService();
  console.log('[orion] dashboard booting on :3000');
  console.log('[orion] auth service ready (mode=' + svc.mode + ')');
  console.log('[orion] TODO next: wire /api/streaming for live metrics');
}

start();
