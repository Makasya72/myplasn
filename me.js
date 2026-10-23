import { send, getSession, handleError } from '../lib/http.js';
export async function GET(request) {
  try {
    const user = getSession(request);
    return send(200, { user: user ? { login: user.login } : null });
  } catch (e) { return handleError(e); }
}
