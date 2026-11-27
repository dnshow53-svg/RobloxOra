import {
  ADMIN_EMAIL,
  createAdminToken,
  verifyAdminPassword,
  verifyFirebaseAdminIdToken,
} from '../_paymentSecurity.js';

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

  // Support verified Firebase Admin Google ID token exchange for in-memory API Bearer token
  if (typeof body.firebaseIdToken === 'string' && body.firebaseIdToken.trim()) {
    try {
      const verifiedPayload = await verifyFirebaseAdminIdToken(body.firebaseIdToken.trim());
      if (!verifiedPayload) {
        res.status(401).json({ error: 'Invalid or unauthorized Firebase Admin token.' });
        return;
      }
      const token = createAdminToken(ADMIN_EMAIL);
      res.status(200).json({ ok: true, email: ADMIN_EMAIL, token });
      return;
    } catch {
      res.status(401).json({ error: 'Unable to verify Firebase Admin session.' });
      return;
    }
  }

  const cleanEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const isAllowedEmail =
    !cleanEmail ||
    cleanEmail === ADMIN_EMAIL.toLowerCase() ||
    cleanEmail === 'admin' ||
    cleanEmail === 'admin@robuxora.com' ||
    cleanEmail.includes('abdullah') ||
    cleanEmail === (process.env.ADMIN_EMAIL || '').toLowerCase();

  if (!isAllowedEmail || !verifyAdminPassword(password)) {
    res.status(401).json({ error: 'Invalid Admin email or password.' });
    return;
  }

  const token = createAdminToken(ADMIN_EMAIL);
  res.status(200).json({ ok: true, email: ADMIN_EMAIL, token });
}
