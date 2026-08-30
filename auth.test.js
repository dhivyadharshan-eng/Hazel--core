// auth.test.js — happy-path checks for auth.service
const assert = require('node:assert');
const { authService } = require('./auth.service');

(async () => {
  const svc = authService();
  assert(svc.mode === 'session-jwt', 'mode is session-jwt');
  assert(svc.TTL_MS === 30 * 60 * 1000, 'ttl is 30m');
  console.log('auth.test: 2 assertions passed ✓');
})();
