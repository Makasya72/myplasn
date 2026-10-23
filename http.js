import crypto from 'node:crypto';

const COOKIE = 'neontasks_session';
const SESSION_AGE = 60 * 60 * 24 * 30;

export function send(status, data, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function error(status, message) { return send(status, { error: message }); }

function cookieOptions(request, age) {
  const secure = Boolean(process.env.VERCEL || request.headers.get('x-forwarded-proto') === 'https');
  return `${COOKIE}=PLACEHOLDER; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

function secret() {
  if (process.env.SESSION_SECRET?.length >= 32) return process.env.SESSION_SECRET;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    const e = new Error('Настройте SESSION_SECRET (минимум 32 символа) в Vercel.');
    e.status = 503; throw e;
  }
  return 'local-development-only-secret-do-not-deploy';
}

function sign(payload) { return crypto.createHmac('sha256', secret()).update(payload).digest('base64url'); }

export function setSession(request, userId, login) {
  const payload = Buffer.from(JSON.stringify({ id: userId, login, exp: Date.now() + SESSION_AGE * 1000 }), 'utf8').toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return cookieOptions(request, SESSION_AGE).replace('PLACEHOLDER', token);
}
export function clearSession(request) {
  return cookieOptions(request, 0).replace('PLACEHOLDER', '');
}

export function getSession(request) {
  const cookies = request.headers.get('cookie') || '';
  const cookie = cookies.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE.length + 1);
  const [payload, mac, ...rest] = token.split('.');
  if (!payload || !mac || rest.length || payload.length > 1024) return null;
  const expected = sign(payload);
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof obj.id !== 'string' || typeof obj.login !== 'string' || !Number.isFinite(obj.exp) || obj.exp <= Date.now()) return null;
    return { id: obj.id, login: obj.login };
  } catch { return null; }
}

export function requireUser(request) {
  return getSession(request);
}

export async function parseBody(request) {
  const raw = await request.text();
  if (raw.length > 20_000) {
    const e = new Error('Слишком длинный запрос.'); e.status = 413; throw e;
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { const e = new Error('Неверный JSON.'); e.status = 400; throw e; }
}

export function handleError(e) {
  console.error('[api]', e.message);
  return error(e.status || 500, e.status ? e.message : 'Не удалось выполнить запрос. Повторите попытку.');
}

export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
    return new URL(origin).host === host;
  } catch { return false; }
}
