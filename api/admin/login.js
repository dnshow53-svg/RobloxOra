import crypto from 'node:crypto';

const ADMIN_EMAIL = 'dnshow53@gmail.com';
const ADMIN_PASSWORD_SALT = '51c0c6174f3020278f724f2d13cc5279';
const ADMIN_PASSWORD_HASH =
  '9e33ba706560d5f69067e5eeb4b4250d5ded8b7cccd9d20401ae9b5e3db97fb9c60ced8f5292f0ad2b4ef1501494e5ff4d2d7fdc366eae6a242670598428d5ff';

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString('utf8').trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function verifyAdminPassword(candidate) {
  if (!candidate) return false;
  const rawEnv = process.env.ADMIN_PASSWORD;
  const envPass = typeof rawEnv === 'string' ? rawEnv.trim() : '';
  if (envPass.length > 0) {
    const a = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    const b = crypto.createHash('sha256').update(envPass, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
  }
  const derived = crypto.scryptSync(candidate, ADMIN_PASSWORD_SALT, 64);
  const expected = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  const cleanEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (cleanEmail !== ADMIN_EMAIL.toLowerCase() || !verifyAdminPassword(password)) {
    res.status(401).json({ error: 'Invalid Admin email or password.' });
    return;
  }

  res.status(200).json({ ok: true, email: ADMIN_EMAIL });
}
