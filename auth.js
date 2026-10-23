import crypto from 'node:crypto';
import * as store from '../lib/store.js';
import { send, error, setSession, clearSession, parseBody, handleError, checkOrigin } from '../lib/http.js';

export async function POST(request) {
  if (!checkOrigin(request)) return error(403, 'Недопустимый источник запроса.');
  try {
    const data = await parseBody(request);
    if (data.action === 'logout') {
      return send(200, { ok: true }, { 'Set-Cookie': clearSession(request) });
    }
    if (!['login', 'register'].includes(data.action)) return error(400, 'Неверное действие.');
    const login = String(data.login || '').trim().toLowerCase();
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(login)) {
      return error(400, 'Логин: от 3 до 24 букв, цифр, _ или - (без пробелов).');
    }
    let id;
    if (data.action === 'register') {
      id = crypto.randomUUID();
      const created = await store.registerUser(login, id);
      if (!created) return error(409, 'Этот логин уже занят. Попробуйте другой.');
    } else {
      id = await store.getUserByLogin(login);
      if (!id) return error(404, 'Такого аккаунта ещё нет. Нажмите «Регистрация».');
    }
    return send(200, { user: { login } }, { 'Set-Cookie': setSession(request, id, login) });
  } catch (e) { return handleError(e); }
}
