import crypto from 'node:crypto';
import * as store from '../lib/store.js';
import { send, error, requireUser, parseBody, handleError, checkOrigin } from '../lib/http.js';
const validPriorities = new Set(['low', 'medium', 'high']);

function normalized(raw, old = {}) {
  const title = String(raw.title ?? old.title ?? '').trim();
  if (title.length < 1 || title.length > 200) {
    const e = new Error('Название задачи должно содержать от 1 до 200 символов.'); e.status = 400; throw e;
  }
  const notes = String(raw.notes ?? old.notes ?? '').trim();
  if (notes.length > 2000) { const e = new Error('Максимум 2000 символов в описании.'); e.status = 400; throw e; }
  const category = String(raw.category ?? old.category ?? 'Личное').trim() || 'Личное';
  if (category.length > 32) { const e = new Error('Слишком длинная категория.'); e.status = 400; throw e; }
  const priority = raw.priority ?? old.priority ?? 'medium';
  if (!validPriorities.has(priority)) { const e = new Error('Неверный приоритет.'); e.status = 400; throw e; }
  const dueDate = String(raw.dueDate ?? old.dueDate ?? '');
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T12:00:00Z`)) || new Date(`${dueDate}T12:00:00Z`).toISOString().slice(0,10) !== dueDate)) {
    const e = new Error('Неверная дата.'); e.status = 400; throw e;
  }
  const completed = typeof raw.completed === 'boolean' ? raw.completed : Boolean(old.completed);
  const now = new Date().toISOString();
  return {
    id: old.id || crypto.randomUUID(), title, notes, category, priority, dueDate,
    completed, createdAt: old.createdAt || now, updatedAt: now,
    completedAt: completed ? (old.completed && old.completedAt ? old.completedAt : now) : null
  };
}

async function handle(request, method) {
  if (method !== 'GET' && !checkOrigin(request)) return error(403, 'Недопустимый источник запроса.');
  try {
    const user = requireUser(request);
    if (!user) return error(401, 'Необходимо войти в аккаунт.');
    if (method === 'GET') {
      const tasks = await store.listTasks(user.id);
      return send(200, { tasks });
    }
    const body = await parseBody(request);
    if (method === 'POST') {
      const task = normalized(body);
      await store.saveTask(user.id, task);
      return send(201, { task });
    }
    const id = String(body.id || '');
    if (!/^[a-f\d-]{36}$/.test(id)) return error(400, 'Неверный ID задачи.');
    const current = await store.getTask(user.id, id);
    if (!current) return error(404, 'Задача не найдена.');
    if (method === 'DELETE') {
      await store.deleteTask(user.id, id);
      return send(200, { ok: true });
    }
    const task = normalized(body, current);
    await store.saveTask(user.id, task);
    return send(200, { task });
  } catch (e) { return handleError(e); }
}

export const GET = request => handle(request, 'GET');
export const POST = request => handle(request, 'POST');
export const PATCH = request => handle(request, 'PATCH');
export const DELETE = request => handle(request, 'DELETE');
