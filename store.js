import fs from 'node:fs/promises';
import path from 'node:path';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const localPath = path.join(process.cwd(), '.data', 'dev.json');

async function redis(command) {
  if (!redisUrl || !redisToken) throw new Error('Нет настроек облачной базы данных');
  const response = await fetch(redisUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('База данных не отвечает');
  const data = await response.json();
  if (data.error) throw new Error('Ошибка базы данных');
  return data.result;
}

function localAllowed() {
  if (redisUrl && redisToken) return false;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    const e = new Error('База данных не настроена. Добавьте UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN в Vercel.');
    e.status = 503;
    throw e;
  }
  return true;
}

async function load() {
  try { return JSON.parse(await fs.readFile(localPath, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return { users: {}, tasks: {} }; }
}
async function save(value) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export async function getUserByLogin(login) {
  if (!localAllowed()) return redis(['GET', `nt:user:${login}`]);
  const db = await load(); return db.users[login] || null;
}

export async function registerUser(login, id) {
  if (!localAllowed()) return (await redis(['SET', `nt:user:${login}`, id, 'NX'])) === 'OK';
  const db = await load();
  if (db.users[login]) return false;
  db.users[login] = id; db.tasks[id] = {};
  await save(db);
  return true;
}

export async function listTasks(userId) {
  if (!localAllowed()) {
    const values = await redis(['HVALS', `nt:tasks:${userId}`]);
    return (values || []).map(value => JSON.parse(value));
  }
  const db = await load(); return Object.values(db.tasks[userId] || {});
}

export async function getTask(userId, id) {
  if (!localAllowed()) {
    const value = await redis(['HGET', `nt:tasks:${userId}`, id]);
    return value ? JSON.parse(value) : null;
  }
  const db = await load(); return db.tasks[userId]?.[id] || null;
}

export async function saveTask(userId, task) {
  if (!localAllowed()) return redis(['HSET', `nt:tasks:${userId}`, task.id, JSON.stringify(task)]);
  const db = await load();
  (db.tasks[userId] ||= {})[task.id] = task;
  await save(db);
}

export async function deleteTask(userId, taskId) {
  if (!localAllowed()) return redis(['HDEL', `nt:tasks:${userId}`, taskId]);
  const db = await load();
  if (db.tasks[userId]) delete db.tasks[userId][taskId];
  await save(db);
}
