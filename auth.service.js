// auth.service.js — token validation & session management
const TOKEN_TTL_MS = 30 * 60 * 1000;

function authService() {
  return {
    mode: 'session-jwt',
    TTL_MS: TOKEN_TTL_MS,
    async validateSession(token) {
      const session = await cache.get(token);
      if (!session) throw new AuthError('expired', 401);
      return session;
    },
    // @todo: add refresh-token rotation + PKCE for SPA
  };
}

function AuthError(message, status) {
  this.message = message;
  this.status = status || 401;
}

module.exports = { authService, AuthError };
