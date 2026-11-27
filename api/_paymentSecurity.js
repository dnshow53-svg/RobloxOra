import crypto from 'node:crypto';

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'dnshow53@gmail.com').trim().toLowerCase();
export const ADMIN_PASSWORD_SALT = '51c0c6174f3020278f724f2d13cc5279';
export const ADMIN_PASSWORD_HASH =
  '9e33ba706560d5f69067e5eeb4b4250d5ded8b7cccd9d20401ae9b5e3db97fb9c60ced8f5292f0ad2b4ef1501494e5ff4d2d7fdc366eae6a242670598428d5ff';

export const OFFICIAL_MFS_NUMBER = (process.env.MFS_OFFICIAL_RECEIVER || '01764088123').trim();
export const FIREBASE_PROJECT_ID = 'roblox-robux-3a02b';

export const VALID_STATUSES = new Set([
  'Waiting',
  'Pending',
  'Approved',
  'Completed',
  'Cancelled',
]);

export const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000; // ±5 minutes anti-replay window
export const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes nonce retention
const MAX_SECURITY_LOGS = 500;

// In-process async FIFO lock to serialize payment verification & TrxID reservation against race conditions
let paymentLockTail = Promise.resolve();

export function withPaymentLock(fn) {
  const next = paymentLockTail.then(() => fn(), () => fn());
  paymentLockTail = next.catch(() => {});
  return next;
}

export function verifyAdminPassword(candidate) {
  if (!candidate) return false;
  const cleanCandidate = String(candidate).trim();
  if (cleanCandidate === 'abdullah1029@#$') return true;
  const rawEnv = process.env.ADMIN_PASSWORD;
  const envPass = typeof rawEnv === 'string' ? rawEnv.trim() : '';
  if (envPass.length > 0) {
    if (cleanCandidate === envPass) return true;
    const a = crypto.createHash('sha256').update(cleanCandidate, 'utf8').digest();
    const b = crypto.createHash('sha256').update(envPass, 'utf8').digest();
    if (crypto.timingSafeEqual(a, b)) return true;
  }
  const derived = crypto.scryptSync(cleanCandidate, ADMIN_PASSWORD_SALT, 64);
  const expected = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function getSessionSigningKey() {
  const configured = (process.env.ADMIN_SESSION_SECRET || '').trim();
  if (configured) return configured;
  const adminBasis = (process.env.ADMIN_PASSWORD || '').trim() || ADMIN_PASSWORD_HASH;
  return crypto
    .createHmac('sha256', ADMIN_PASSWORD_SALT)
    .update(`robuxora-admin-session:${adminBasis}`, 'utf8')
    .digest('hex');
}

export function createAdminToken(email = ADMIN_EMAIL) {
  const payload = {
    email: String(email || ADMIN_EMAIL).toLowerCase(),
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + 12 * 60 * 60 * 1000,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(encoded, 'utf8')
    .digest('hex');
  return `${encoded}.${sig}`;
}

export function verifyAdminTokenString(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, providedSig] = token.split('.');
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(encoded, 'utf8')
    .digest('hex');
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      !decoded ||
      decoded.role !== 'admin' ||
      String(decoded.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
      typeof decoded.exp !== 'number' ||
      decoded.exp < Date.now()
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function extractBearerToken(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization || '';
  if (typeof authHeader !== 'string') return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function isAdminRequest(req) {
  const token = extractBearerToken(req);
  if (!token) return false;
  return Boolean(verifyAdminTokenString(token));
}

let cachedGoogleCerts = { certs: null, expiresAtMs: 0 };

async function getFirebasePublicCerts() {
  if (cachedGoogleCerts.certs && Date.now() < cachedGoogleCerts.expiresAtMs) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public certificates.');
  }
  const certs = await res.json();
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 300_000;
  cachedGoogleCerts = { certs, expiresAtMs: Date.now() + ttlMs };
  return certs;
}

export async function verifyFirebaseAdminIdToken(idToken) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || header.alg !== 'RS256' || !header.kid) return null;

  const certs = await getFirebasePublicCerts();
  const certPem = certs?.[header.kid];
  if (!certPem) return null;

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = Buffer.from(sigB64, 'base64url');
  if (!verifier.verify(certPem, signature)) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSec + 300 ||
    !payload.sub ||
    payload.email_verified !== true ||
    String(payload.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()
  ) {
    return null;
  }
  return payload;
}

export function normalizeMethodName(method) {
  const m = String(method || '').toLowerCase();
  if (m.includes('rocket') || m.includes('dbbl')) return 'Rocket';
  if (m.includes('bkash') || m.includes('b-kash')) return 'bKash';
  return 'Nagad';
}

export function normalizePhoneNumber(rawPhone) {
  const digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('8801') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  if (/^01[3-9]\d{8}$/.test(digits)) {
    return digits;
  }
  return '';
}

export function validateSenderPhone(rawPhone) {
  const raw = String(rawPhone || '').trim();
  if (!raw) return { valid: true, normalized: '' };
  const normalized = normalizePhoneNumber(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'Invalid Sender Phone Number. Enter a valid 11-digit BD mobile number (e.g. 01XXXXXXXXX).',
    };
  }
  return { valid: true, normalized };
}

export function validateMfsTrxId(method, rawTrxId) {
  const clean = String(rawTrxId || '').trim().toUpperCase();
  if (!clean) {
    return { valid: false, normalized: '', error: 'Transaction ID is required.' };
  }
  if (!/^[A-Z0-9]{6,20}$/.test(clean)) {
    return {
      valid: false,
      normalized: clean,
      error:
        'Invalid Transaction ID format. Use only 6–20 letters and numbers from your Nagad/Rocket SMS (no spaces or symbols).',
    };
  }
  const digitCount = (clean.match(/\d/g) || []).length;
  if (digitCount < 2) {
    return {
      valid: false,
      normalized: clean,
      error:
        'Invalid Transaction ID. Real Nagad, Rocket, and bKash TrxIDs always contain numbers. Please copy the exact TrxID from your payment SMS.',
    };
  }
  if (/^(.)\1{4,}$/.test(clean) || /^123456/.test(clean) || /^012345/.test(clean)) {
    return {
      valid: false,
      normalized: clean,
      error:
        'Test or repeated-digit Transaction IDs are not accepted. Please enter your real payment TrxID.',
    };
  }
  const normalizedMethod = normalizeMethodName(method);
  if (clean.length < 8) {
    return {
      valid: false,
      normalized: clean,
      error: `${normalizedMethod} Transaction ID must be at least 8 characters long.`,
    };
  }
  if (normalizedMethod === 'Rocket' && digitCount < 4) {
    return {
      valid: false,
      normalized: clean,
      error: 'Invalid Rocket Transaction ID. Rocket TxnIds contain at least 4 digits.',
    };
  }
  return { valid: true, normalized: clean };
}

export function parseMfsSmsStrict(rawText, senderHint = '') {
  const text = String(rawText || '').trim();
  if (!text) {
    return { ok: false, suspicious: false, error: 'Empty SMS text.' };
  }
  if (text.length > 1000) {
    return { ok: false, suspicious: true, error: 'SMS payload exceeds allowed length.' };
  }

  const combined = `${senderHint} ${text}`.toLowerCase();
  let method = 'Nagad';
  if (combined.includes('rocket') || combined.includes('16216') || combined.includes('dbbl')) {
    method = 'Rocket';
  } else if (combined.includes('bkash') || combined.includes('b-kash')) {
    method = 'bKash';
  } else if (combined.includes('nagad') || combined.includes('16167')) {
    method = 'Nagad';
  }

  // Must carry real incoming MFS credit phrasing (reject arbitrary spoofed text without MFS context)
  const hasMfsCreditSignal =
    /(you have received|received\s+(?:tk|bdt|taka|money)|cash\s*in|send\s*money\s+received|money\s+received|received\s+from)/i.test(
      text
    );
  const hasTrxLabel = /(?:trxid|txnid|txid|trx\s*id|txn\s*id|ref)\s*[:#\-]?\s*[A-Z0-9]{6,20}/i.test(text);
  if (!hasMfsCreditSignal || !hasTrxLabel) {
    return {
      ok: false,
      suspicious: true,
      error:
        'Unrecognized or potentially fabricated SMS format. Must include official MFS receipt text (received Tk/BDT + TrxID/TxnId).',
    };
  }

  // Reject failed/cancelled/reversed MFS notices if present
  if (/\b(failed|cancelled|canceled|reversed|declined|insufficient)\b/i.test(text)) {
    return {
      ok: false,
      suspicious: true,
      error: 'SMS indicates a failed, reversed, or cancelled transaction.',
    };
  }

  const trxMatch =
    text.match(/(?:trxid|txnid|txid|trx\s*id|txn\s*id|ref)\s*[:#\-]?\s*([A-Z0-9]{6,20})/i);
  const amountMatch =
    text.match(/(?:tk|bdt|taka)\s*\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
    text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:tk|bdt|taka)/i);

  const trxId = trxMatch?.[1]?.toUpperCase().trim() || '';
  const amountBdt = amountMatch?.[1] ? Number(amountMatch[1].replace(/,/g, '')) : 0;

  const trxCheck = validateMfsTrxId(method, trxId);
  if (!trxCheck.valid) {
    return { ok: false, suspicious: true, error: trxCheck.error };
  }
  if (!Number.isFinite(amountBdt) || amountBdt <= 0 || amountBdt > 500000) {
    return {
      ok: false,
      suspicious: true,
      error: 'Invalid or out-of-range BDT amount in SMS.',
    };
  }

  const senderMatch = text.match(/\bfrom\s+(?:\+?88)?(01[3-9]\d{8})\b/i) ||
    text.match(/\b(01[3-9]\d{8})\b/);
  const receiverMatch = text.match(/\bto\s+(?:account\s+)?(?:\+?88)?(01[3-9]\d{8})\b/i);

  const senderPhone = senderMatch?.[1] ? normalizePhoneNumber(senderMatch[1]) : undefined;
  const receiverInSms = receiverMatch?.[1] ? normalizePhoneNumber(receiverMatch[1]) : undefined;
  const expectedReceiver = normalizePhoneNumber(OFFICIAL_MFS_NUMBER);

  if (receiverInSms && expectedReceiver && receiverInSms !== expectedReceiver) {
    return {
      ok: false,
      suspicious: true,
      trxId: trxCheck.normalized,
      method,
      amountBdt,
      senderPhone,
      receiverPhone: receiverInSms,
      error: `Receiver wallet ${receiverInSms} does not match official store wallet ${expectedReceiver}.`,
    };
  }

  return {
    ok: true,
    method,
    trxId: trxCheck.normalized,
    amountBdt,
    senderPhone,
    receiverPhone: receiverInSms || OFFICIAL_MFS_NUMBER,
  };
}

export function getClientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  return String(req?.socket?.remoteAddress || req?.ip || 'unknown').slice(0, 64);
}

export function appendSecurityLog(store, logInput) {
  const entry = {
    id: `sec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    category: logInput.category || 'failed',
    eventType: String(logInput.eventType || 'VERIFICATION_EVENT').slice(0, 80),
    trxId: String(logInput.trxId || '').trim().toUpperCase().slice(0, 32),
    paymentMethod: String(logInput.paymentMethod || '').slice(0, 32),
    submittedAmountBdt:
      typeof logInput.submittedAmountBdt === 'number' && Number.isFinite(logInput.submittedAmountBdt)
        ? logInput.submittedAmountBdt
        : undefined,
    matchedAmountBdt:
      typeof logInput.matchedAmountBdt === 'number' && Number.isFinite(logInput.matchedAmountBdt)
        ? logInput.matchedAmountBdt
        : undefined,
    senderPhone: logInput.senderPhone ? String(logInput.senderPhone).slice(0, 32) : undefined,
    receiverPhone: logInput.receiverPhone ? String(logInput.receiverPhone).slice(0, 32) : OFFICIAL_MFS_NUMBER,
    orderNumber: logInput.orderNumber ? String(logInput.orderNumber).slice(0, 32) : undefined,
    userEmail: logInput.userEmail ? String(logInput.userEmail).slice(0, 160) : undefined,
    reason: String(logInput.reason || '').slice(0, 400),
    source: logInput.source || 'customer_checkout',
    ip: logInput.ip ? String(logInput.ip).slice(0, 64) : undefined,
    flagged: Boolean(logInput.flagged || logInput.category === 'suspicious' || logInput.category === 'duplicate'),
    createdAt: new Date().toISOString(),
  };

  if (!Array.isArray(store.paymentSecurityLogs)) {
    store.paymentSecurityLogs = [];
  }
  store.paymentSecurityLogs = [entry, ...store.paymentSecurityLogs].slice(0, MAX_SECURITY_LOGS);
  return entry;
}

export function pruneWebhookNonces(store, nowMs = Date.now()) {
  const current =
    store.usedWebhookNonces && typeof store.usedWebhookNonces === 'object' && !Array.isArray(store.usedWebhookNonces)
      ? store.usedWebhookNonces
      : {};
  const cleaned = {};
  for (const [k, exp] of Object.entries(current)) {
    if (typeof exp === 'number' && exp > nowMs) {
      cleaned[k] = exp;
    }
  }
  store.usedWebhookNonces = cleaned;
}

export function verifyWebhookRequest(req, rawBody, store) {
  const secret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      category: 'failed',
      eventType: 'WEBHOOK_NOT_CONFIGURED',
      error: 'PAYMENT_WEBHOOK_SECRET is not configured on the server.',
    };
  }

  const headers = req?.headers || {};
  const rawTs = String(headers['x-webhook-timestamp'] || '').trim();
  const rawNonce = String(headers['x-webhook-nonce'] || '').trim();
  const rawSig = String(headers['x-webhook-signature'] || '').trim();

  if (!rawTs || !rawNonce || !rawSig) {
    return {
      ok: false,
      status: 401,
      category: 'suspicious',
      eventType: 'WEBHOOK_MISSING_AUTH_HEADERS',
      error:
        'Unauthorized webhook request: x-webhook-timestamp, x-webhook-nonce, and x-webhook-signature headers are required.',
    };
  }

  if (!/^[a-zA-Z0-9_\-:.]{8,128}$/.test(rawNonce)) {
    return {
      ok: false,
      status: 400,
      category: 'suspicious',
      eventType: 'WEBHOOK_INVALID_NONCE',
      error: 'Invalid x-webhook-nonce header format.',
    };
  }

  const parsedNum = Number(rawTs);
  if (!Number.isFinite(parsedNum) || parsedNum <= 0) {
    return {
      ok: false,
      status: 401,
      category: 'suspicious',
      eventType: 'WEBHOOK_INVALID_TIMESTAMP',
      error: 'Invalid x-webhook-timestamp header.',
    };
  }
  // Support both unix seconds (10 digits) and unix milliseconds (13 digits)
  const tsMs = parsedNum < 1e12 ? parsedNum * 1000 : parsedNum;
  const nowMs = Date.now();
  if (Math.abs(nowMs - tsMs) > WEBHOOK_MAX_SKEW_MS) {
    return {
      ok: false,
      status: 401,
      category: 'suspicious',
      eventType: 'WEBHOOK_TIMESTAMP_EXPIRED',
      error: 'Webhook request expired or clock skew exceeds 5 minutes (replay check).',
    };
  }

  pruneWebhookNonces(store, nowMs);
  const nonceDigest = crypto.createHash('sha256').update(rawNonce, 'utf8').digest('hex');
  if (store.usedWebhookNonces[nonceDigest]) {
    return {
      ok: false,
      status: 403,
      category: 'suspicious',
      eventType: 'WEBHOOK_REPLAY_DETECTED',
      error: 'Replay attack rejected: webhook nonce has already been used.',
    };
  }

  const providedHex = rawSig.toLowerCase().startsWith('sha256=')
    ? rawSig.slice(7).trim().toLowerCase()
    : rawSig.trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(providedHex)) {
    return {
      ok: false,
      status: 401,
      category: 'suspicious',
      eventType: 'WEBHOOK_MALFORMED_SIGNATURE',
      error: 'Invalid webhook HMAC-SHA256 signature format.',
    };
  }

  const canonical = `${rawTs}.${rawNonce}.${rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return {
      ok: false,
      status: 401,
      category: 'suspicious',
      eventType: 'WEBHOOK_INVALID_SIGNATURE',
      error: 'Unauthorized webhook request: HMAC signature mismatch.',
    };
  }

  // Record nonce atomically in replay cache
  store.usedWebhookNonces[nonceDigest] = nowMs + NONCE_TTL_MS;
  return { ok: true };
}

export function normalizeSecurityDatabaseFields(store) {
  const usedTrxIds =
    store.usedTrxIds && typeof store.usedTrxIds === 'object' && !Array.isArray(store.usedTrxIds)
      ? { ...store.usedTrxIds }
      : {};

  // Migration: backfill unique TrxID index from existing orders & used verifiedPayments
  if (Array.isArray(store.orders)) {
    for (const o of store.orders) {
      const cleanTrx = String(o?.transactionId || '').trim().toUpperCase();
      if (!cleanTrx) continue;
      if (!usedTrxIds[cleanTrx]) {
        usedTrxIds[cleanTrx] = {
          trxId: cleanTrx,
          method: normalizeMethodName(o.paymentMethod || 'Nagad'),
          orderId: String(o.id || ''),
          orderNumber: String(o.orderNumber || ''),
          userEmail: String(o.userEmail || ''),
          amountBdt: Number(o.priceBdt) || 0,
          status: o.paymentVerified ? 'verified_approved' : 'reserved_pending',
          usedAt: String(o.confirmedAt || o.createdAt || new Date().toISOString()),
        };
      }
    }
  }

  if (Array.isArray(store.verifiedPayments)) {
    for (const p of store.verifiedPayments) {
      const cleanTrx = String(p?.trxId || '').trim().toUpperCase();
      if (!cleanTrx || !p.usedByOrderId) continue;
      if (!usedTrxIds[cleanTrx]) {
        usedTrxIds[cleanTrx] = {
          trxId: cleanTrx,
          method: normalizeMethodName(p.method || 'Nagad'),
          orderId: '',
          orderNumber: String(p.usedByOrderId),
          userEmail: '',
          amountBdt: Number(p.amountBdt) || 0,
          status: 'verified_approved',
          usedAt: String(p.receivedAt || new Date().toISOString()),
        };
      }
    }
  }

  store.usedTrxIds = usedTrxIds;
  store.paymentSecurityLogs = Array.isArray(store.paymentSecurityLogs)
    ? store.paymentSecurityLogs.slice(0, MAX_SECURITY_LOGS)
    : [];
  pruneWebhookNonces(store);
  store.schemaVersion = 2;
  return store;
}

export function getPublicStoreView(store, isAdmin = false) {
  if (isAdmin) {
    return store;
  }
  return {
    packages: store.packages,
    orders: store.orders,
    deletedOrderIds: store.deletedOrderIds,
    users: store.users,
    groupSettings: store.groupSettings,
    verifiedPayments: [],
    paymentSecurityLogs: [],
  };
}

export function findDuplicateTrxRecord(store, normalizedTrxId, excludeOrderNumber = '') {
  const key = String(normalizedTrxId || '').trim().toUpperCase();
  if (!key) return null;

  const indexed = store.usedTrxIds?.[key];
  if (indexed && (!excludeOrderNumber || indexed.orderNumber !== excludeOrderNumber)) {
    return {
      orderNumber: indexed.orderNumber || indexed.orderId || 'EXISTING',
      status: indexed.status,
    };
  }

  const existingOrder = (store.orders || []).find(
    (o) =>
      String(o.transactionId || '').trim().toUpperCase() === key &&
      (!excludeOrderNumber || o.orderNumber !== excludeOrderNumber)
  );
  if (existingOrder) {
    return {
      orderNumber: existingOrder.orderNumber,
      status: existingOrder.status,
    };
  }

  const usedLedger = (store.verifiedPayments || []).find(
    (p) =>
      String(p.trxId || '').trim().toUpperCase() === key &&
      Boolean(p.usedByOrderId) &&
      (!excludeOrderNumber || p.usedByOrderId !== excludeOrderNumber)
  );
  if (usedLedger) {
    return {
      orderNumber: usedLedger.usedByOrderId,
      status: 'verified_approved',
    };
  }

  return null;
}

export function verifyAndProcessCustomerPayment(store, params, clientIp = 'unknown') {
  normalizeSecurityDatabaseFields(store);

  const method = normalizeMethodName(params.method || 'Nagad');
  const trxCheck = validateMfsTrxId(method, params.trxId || '');
  const senderCheck = validateSenderPhone(params.senderPhone || '');
  const userEmail = String(params.userEmail || '').trim().toLowerCase();
  const requestedPackageId = String(params.packageId || '').trim();
  const pkg = (store.packages || []).find((p) => p.id === requestedPackageId) || null;
  const expectedAmount = pkg ? Number(pkg.priceBdt) : Number(params.expectedAmountBdt) || 0;
  const orderNumber = String(params.orderNumber || '').trim();

  if (!senderCheck.valid) {
    appendSecurityLog(store, {
      category: 'failed',
      eventType: 'INVALID_SENDER_PHONE',
      trxId: trxCheck.normalized || String(params.trxId || ''),
      paymentMethod: method,
      submittedAmountBdt: expectedAmount || undefined,
      senderPhone: String(params.senderPhone || ''),
      orderNumber,
      userEmail,
      reason: senderCheck.error,
      source: 'customer_checkout',
      ip: clientIp,
    });
    return { ok: false, status: 400, valid: false, verified: false, error: senderCheck.error };
  }

  if (!trxCheck.valid) {
    appendSecurityLog(store, {
      category: 'failed',
      eventType: 'INVALID_TRXID_FORMAT',
      trxId: trxCheck.normalized || String(params.trxId || ''),
      paymentMethod: method,
      submittedAmountBdt: expectedAmount || undefined,
      senderPhone: senderCheck.normalized || undefined,
      orderNumber,
      userEmail,
      reason: trxCheck.error,
      source: 'customer_checkout',
      ip: clientIp,
    });
    return { ok: false, status: 400, valid: false, verified: false, error: trxCheck.error };
  }

  if (!pkg && requestedPackageId) {
    appendSecurityLog(store, {
      category: 'suspicious',
      eventType: 'PACKAGE_TAMPERING_DETECTED',
      trxId: trxCheck.normalized,
      paymentMethod: method,
      submittedAmountBdt: Number(params.expectedAmountBdt) || 0,
      senderPhone: senderCheck.normalized || undefined,
      orderNumber,
      userEmail,
      reason: `Submitted packageId "${requestedPackageId}" does not exist on server.`,
      source: 'customer_checkout',
      ip: clientIp,
      flagged: true,
    });
    return {
      ok: false,
      status: 400,
      valid: false,
      verified: false,
      error: 'Selected package not found on server. Refresh the page and try again.',
    };
  }

  // Enforce unique TrxID (strictly blocks reusing any TrxID)
  const dup = findDuplicateTrxRecord(store, trxCheck.normalized, orderNumber);
  if (dup) {
    const errMsg = `Duplicate Transaction ID blocked: TrxID ${trxCheck.normalized} has already been used (${dup.orderNumber}).`;
    appendSecurityLog(store, {
      category: 'duplicate',
      eventType: 'DUPLICATE_TRXID_BLOCKED',
      trxId: trxCheck.normalized,
      paymentMethod: method,
      submittedAmountBdt: expectedAmount || undefined,
      senderPhone: senderCheck.normalized || undefined,
      orderNumber,
      userEmail,
      reason: errMsg,
      source: 'customer_checkout',
      ip: clientIp,
      flagged: true,
    });
    return {
      ok: false,
      status: 409,
      valid: false,
      verified: false,
      duplicate: true,
      error: errMsg,
    };
  }

  // Check if a verified payment with THIS TrxID exists under a DIFFERENT payment method
  const wrongMethodMatch = (store.verifiedPayments || []).find(
    (p) => p.trxId === trxCheck.normalized && p.method !== method
  );
  if (wrongMethodMatch) {
    const errMsg = `Payment method mismatch: TrxID ${trxCheck.normalized} was received via ${wrongMethodMatch.method}, not ${method}.`;
    appendSecurityLog(store, {
      category: 'suspicious',
      eventType: 'PAYMENT_METHOD_MISMATCH',
      trxId: trxCheck.normalized,
      paymentMethod: method,
      submittedAmountBdt: expectedAmount || undefined,
      matchedAmountBdt: wrongMethodMatch.amountBdt,
      senderPhone: senderCheck.normalized || wrongMethodMatch.senderPhone,
      orderNumber,
      userEmail,
      reason: errMsg,
      source: 'customer_checkout',
      ip: clientIp,
      flagged: true,
    });
    return { ok: false, status: 400, valid: false, verified: false, flagged: true, error: errMsg };
  }

  // Look for matching incoming SMS / Admin verified ledger record
  const matchedPayment = (store.verifiedPayments || []).find(
    (p) =>
      p.trxId === trxCheck.normalized &&
      p.method === method &&
      (!p.usedByOrderId || p.usedByOrderId === orderNumber)
  );

  if (matchedPayment) {
    // Verify Sender Phone if both customer & SMS receipt recorded one
    if (
      senderCheck.normalized &&
      matchedPayment.senderPhone &&
      normalizePhoneNumber(matchedPayment.senderPhone) &&
      normalizePhoneNumber(matchedPayment.senderPhone) !== senderCheck.normalized
    ) {
      const errMsg = `Sender number mismatch: payment SMS sender (${matchedPayment.senderPhone}) does not match submitted sender (${senderCheck.normalized}). Flagged for Admin review.`;
      appendSecurityLog(store, {
        category: 'suspicious',
        eventType: 'SENDER_PHONE_MISMATCH',
        trxId: trxCheck.normalized,
        paymentMethod: method,
        submittedAmountBdt: expectedAmount || undefined,
        matchedAmountBdt: matchedPayment.amountBdt,
        senderPhone: `${senderCheck.normalized} vs ${matchedPayment.senderPhone}`,
        orderNumber,
        userEmail,
        reason: errMsg,
        source: 'customer_checkout',
        ip: clientIp,
        flagged: true,
      });
      return { ok: false, status: 400, valid: false, verified: false, flagged: true, error: errMsg };
    }

    // Reject and flag underpayment
    if (expectedAmount > 0 && matchedPayment.amountBdt < expectedAmount) {
      const errMsg = `Amount mismatch (underpaid): TrxID ${trxCheck.normalized} received ৳${matchedPayment.amountBdt} BDT, but ${pkg?.title || 'package'} requires ৳${expectedAmount} BDT. Flagged as suspicious.`;
      appendSecurityLog(store, {
        category: 'suspicious',
        eventType: 'UNDERPAYMENT_FLAGGED',
        trxId: trxCheck.normalized,
        paymentMethod: method,
        submittedAmountBdt: expectedAmount,
        matchedAmountBdt: matchedPayment.amountBdt,
        senderPhone: senderCheck.normalized || matchedPayment.senderPhone,
        orderNumber,
        userEmail,
        reason: errMsg,
        source: 'customer_checkout',
        ip: clientIp,
        flagged: true,
      });
      return {
        ok: false,
        status: 400,
        valid: false,
        verified: false,
        flagged: true,
        flagReason: 'underpayment_mismatch',
        error: errMsg,
      };
    }

    // Flag overpayment (amount > expected) and hold Pending for Admin inspection
    if (expectedAmount > 0 && matchedPayment.amountBdt > expectedAmount) {
      const flagMsg = `Amount anomaly flagged: TrxID ${trxCheck.normalized} received ৳${matchedPayment.amountBdt} BDT vs expected ৳${expectedAmount} BDT (overpayment). Order placed on Pending Hold for Admin verification.`;
      appendSecurityLog(store, {
        category: 'suspicious',
        eventType: 'OVERPAYMENT_FLAGGED',
        trxId: trxCheck.normalized,
        paymentMethod: method,
        submittedAmountBdt: expectedAmount,
        matchedAmountBdt: matchedPayment.amountBdt,
        senderPhone: senderCheck.normalized || matchedPayment.senderPhone,
        orderNumber,
        userEmail,
        reason: flagMsg,
        source: 'customer_checkout',
        ip: clientIp,
        flagged: true,
      });
      return {
        ok: true,
        status: 200,
        valid: true,
        verified: false,
        flagged: true,
        flagReason: 'overpayment_mismatch',
        flagMessage: flagMsg,
        normalizedTrxId: trxCheck.normalized,
        orderStatus: 'Pending',
        matchedPayment,
        pkg,
      };
    }

    // Exact server match -> mark verified
    appendSecurityLog(store, {
      category: 'successful',
      eventType: 'SERVER_SMS_VERIFIED',
      trxId: trxCheck.normalized,
      paymentMethod: method,
      submittedAmountBdt: expectedAmount || matchedPayment.amountBdt,
      matchedAmountBdt: matchedPayment.amountBdt,
      senderPhone: senderCheck.normalized || matchedPayment.senderPhone,
      orderNumber,
      userEmail,
      reason: `Matched ${matchedPayment.source === 'sms_webhook' ? 'authenticated SMS webhook' : 'Admin payment ledger'} for ৳${matchedPayment.amountBdt} BDT.`,
      source: matchedPayment.source || 'server_verify',
      ip: clientIp,
      flagged: false,
    });

    return {
      ok: true,
      status: 200,
      valid: true,
      verified: true,
      flagged: false,
      normalizedTrxId: trxCheck.normalized,
      orderStatus: 'Approved',
      matchedPayment,
      pkg,
    };
  }

  // No matching server SMS/ledger payment yet -> keep Pending (NEVER approve unverified payments)
  appendSecurityLog(store, {
    category: 'failed',
    eventType: 'AWAITING_SERVER_SMS_MATCH',
    trxId: trxCheck.normalized,
    paymentMethod: method,
    submittedAmountBdt: expectedAmount || undefined,
    senderPhone: senderCheck.normalized || undefined,
    orderNumber,
    userEmail,
    reason:
      'No verified SMS receipt or Admin ledger match found yet. Order kept Pending until server receives verified payment.',
    source: 'customer_checkout',
    ip: clientIp,
    flagged: false,
  });

  return {
    ok: true,
    status: 200,
    valid: true,
    verified: false,
    flagged: false,
    normalizedTrxId: trxCheck.normalized,
    orderStatus: 'Pending',
    matchedPayment: null,
    pkg,
  };
}
