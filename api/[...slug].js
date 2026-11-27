import fs from 'node:fs';
import path from 'node:path';

const STORE_FILE = path.join('/tmp', 'robuxora-store.json');
const OFFICIAL_MFS_NUMBER = '01764088123';
const VALID_STATUSES = new Set(['Waiting', 'Pending', 'Approved', 'Completed', 'Cancelled']);

const DEFAULT_STORE = {
  packages: [
    {
      id: 'pkg-400',
      robux: 400,
      title: '400 Robux',
      tierLabel: 'Starter Vault',
      priceBdt: 590,
      deliveryNote: 'Group Payout',
      image: '',
    },
    {
      id: 'pkg-800',
      robux: 800,
      title: '800 Robux',
      tierLabel: 'Standard Stack',
      priceBdt: 1180,
      deliveryNote: 'Most Selected',
      image: '',
    },
    {
      id: 'pkg-1700',
      robux: 1700,
      title: '1,700 Robux',
      tierLabel: 'Titanium Vault',
      priceBdt: 2350,
      deliveryNote: 'Best Value',
      image: '',
    },
  ],
  orders: [],
  deletedOrderIds: [],
  users: [],
  groupSettings: {
    groupId: 401717676,
    groupUrl: 'https://www.roblox.com/communities/401717676/Velvet-Visions-Studio#!/about',
    availableRobux: 25400,
  },
  verifiedPayments: [],
};

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function sanitizeAvatarValue(rawAvatar) {
  if (typeof rawAvatar !== 'string') return '';
  const trimmed = rawAvatar.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function sanitizeVerificationTimer(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    hasClickedGroupLink: Boolean(raw.hasClickedGroupLink),
    isGroupVerified: Boolean(raw.isGroupVerified),
    unlockAtMs:
      typeof raw.unlockAtMs === 'number' && Number.isFinite(raw.unlockAtMs)
        ? Math.max(0, raw.unlockAtMs)
        : 0,
    verifiedAtMs:
      typeof raw.verifiedAtMs === 'number' && Number.isFinite(raw.verifiedAtMs)
        ? Math.max(0, raw.verifiedAtMs)
        : 0,
    robloxUsername:
      typeof raw.robloxUsername === 'string' ? raw.robloxUsername.trim().slice(0, 32) : '',
    robloxUserId:
      typeof raw.robloxUserId === 'number' && Number.isFinite(raw.robloxUserId) && raw.robloxUserId > 0
        ? raw.robloxUserId
        : null,
  };
}

function sanitizeVerifiedRobloxTimers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const cleanKey = String(key || '').trim().toLowerCase().slice(0, 32);
    if (!cleanKey) continue;
    const sanitized = sanitizeVerificationTimer(val);
    if (sanitized) out[cleanKey] = sanitized;
  }
  return out;
}

function ensureStoreFile() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
      return structuredClone(DEFAULT_STORE);
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const deletedOrderIds = Array.isArray(parsed.deletedOrderIds)
      ? parsed.deletedOrderIds.filter((id) => typeof id === 'string')
      : [];
    return {
      packages:
        Array.isArray(parsed.packages) && parsed.packages.length > 0
          ? parsed.packages.map((p) => ({
              ...p,
              priceBdt: Number(p.priceBdt) || 590,
              image:
                typeof p.image === 'string' && !p.image.startsWith('/src/assets/images/pkg_')
                  ? p.image
                  : '',
            }))
          : structuredClone(DEFAULT_STORE.packages),
      deletedOrderIds,
      orders: Array.isArray(parsed.orders)
        ? parsed.orders
            .filter((o) => !deletedOrderIds.includes(o.id))
            .map((o) => {
              const rawSt = String(o.status || '').trim().toLowerCase();
              const status =
                rawSt === 'waiting'
                  ? 'Waiting'
                  : rawSt === 'approved'
                  ? 'Approved'
                  : rawSt === 'completed'
                  ? 'Completed'
                  : rawSt === 'cancelled' || rawSt === 'canceled'
                  ? 'Cancelled'
                  : 'Pending';
              return {
                ...o,
                status,
                priceBdt: Number(o.priceBdt) || 0,
                paymentVerified: Boolean(o.paymentVerified),
                confirmedAt: typeof o.confirmedAt === 'string' ? o.confirmedAt : undefined,
              };
            })
        : [],
      users: Array.isArray(parsed.users)
        ? parsed.users.map((u) => ({
            ...u,
            avatar: sanitizeAvatarValue(u.avatar),
            verificationTimer: sanitizeVerificationTimer(u.verificationTimer),
            verifiedRobloxTimers: sanitizeVerifiedRobloxTimers(u.verifiedRobloxTimers),
            updatedAtMs: typeof u.updatedAtMs === 'number' ? u.updatedAtMs : 0,
          }))
        : [],
      groupSettings:
        parsed.groupSettings && typeof parsed.groupSettings.groupId === 'number'
          ? {
              ...parsed.groupSettings,
              availableRobux:
                typeof parsed.groupSettings.availableRobux === 'number'
                  ? parsed.groupSettings.availableRobux
                  : 25400,
              restockTimestamp:
                typeof parsed.groupSettings.restockTimestamp === 'number'
                  ? parsed.groupSettings.restockTimestamp
                  : undefined,
              updatedAtMs:
                typeof parsed.groupSettings.updatedAtMs === 'number'
                  ? parsed.groupSettings.updatedAtMs
                  : 0,
            }
          : structuredClone(DEFAULT_STORE.groupSettings),
      verifiedPayments: Array.isArray(parsed.verifiedPayments) ? parsed.verifiedPayments : [],
    };
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

function writeStoreFile(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Ignore ephemeral filesystem errors gracefully
  }
}

function normalizeMethodName(method) {
  const m = String(method || '').toLowerCase();
  if (m.includes('rocket') || m.includes('dbbl')) return 'Rocket';
  if (m.includes('bkash')) return 'bKash';
  return 'Nagad';
}

function validateMfsTrxId(method, rawTrxId) {
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

function parseMfsSms(rawText, senderHint = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const combined = `${senderHint} ${text}`.toLowerCase();
  let method = 'Nagad';
  if (combined.includes('rocket') || combined.includes('16216') || combined.includes('dbbl')) {
    method = 'Rocket';
  } else if (combined.includes('bkash') || combined.includes('b-kash')) {
    method = 'bKash';
  } else if (combined.includes('nagad') || combined.includes('16167')) {
    method = 'Nagad';
  }

  const trxMatch =
    text.match(/(?:trxid|txnid|txid|trx\s*id|txn\s*id|ref)\s*[:#\-]?\s*([A-Z0-9]{6,20})/i) ||
    text.match(/\b([A-Z0-9]*\d[A-Z0-9]{7,15})\b/i);
  const amountMatch =
    text.match(/(?:tk|bdt|amount|received)\s*[:.]?\s*([0-9]+(?:\.[0-9]+)?)/i) ||
    text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:tk|bdt)/i);
  const phoneMatch = text.match(/(01[3-9]\d{8})/);

  const trxId = trxMatch?.[1]?.toUpperCase().trim() || '';
  const amountBdt = amountMatch?.[1] ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  if (!trxId || !amountBdt || amountBdt <= 0) return null;

  return {
    method,
    trxId,
    amountBdt,
    senderPhone: phoneMatch?.[1],
  };
}

export default async function handler(req, res) {
  const urlPath = (req.url || '').split('?')[0];
  const subPath = urlPath.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const parts = subPath ? subPath.split('/').map((s) => decodeURIComponent(s)) : [];
  const method = (req.method || 'GET').toUpperCase();
  const body = parseBody(req);

  let store = ensureStoreFile();

  // POST /api/uploads (on Vercel serverless, return compressed data URL directly so it persists cleanly)
  if (parts[0] === 'uploads' && parts.length === 1 && method === 'POST') {
    const dataUrl = String(body.dataUrl || '').trim();
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Invalid image format. Please choose a PNG, JPG, or WebP image.' });
      return;
    }
    const byteLen = Buffer.from(match[2], 'base64').length;
    if (byteLen > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'Image is too large (max 5MB).' });
      return;
    }
    res.status(201).json({ url: dataUrl });
    return;
  }

  // GET /api/store
  if (parts[0] === 'store' && parts.length === 1 && method === 'GET') {
    res.status(200).json(store);
    return;
  }

  // /api/packages & /api/packages/:id
  if (parts[0] === 'packages') {
    if (parts.length === 1 && method === 'POST') {
      const robux = Number(body.robux);
      const priceBdt = Number(body.priceBdt);
      if (!robux || robux <= 0 || !priceBdt || priceBdt <= 0 || !body.id || !body.title) {
        res.status(400).json({ error: 'Invalid package payload' });
        return;
      }
      const cleanImage =
        typeof body.image === 'string' && !body.image.startsWith('/src/assets/images/pkg_')
          ? body.image.trim()
          : '';
      const pkg = {
        id: String(body.id),
        robux,
        title: String(body.title),
        tierLabel: String(body.tierLabel || 'Custom Bundle'),
        priceBdt,
        deliveryNote: String(body.deliveryNote || 'Group Payout'),
        image: cleanImage,
      };
      store.packages = [...store.packages.filter((p) => p.id !== pkg.id), pkg];
      writeStoreFile(store);
      res.status(201).json(pkg);
      return;
    }

    if (parts.length === 2) {
      const id = parts[1];
      if (method === 'PATCH') {
        const existing = store.packages.find((p) => p.id === id);
        if (!existing) {
          res.status(404).json({ error: 'Package not found' });
          return;
        }
        const updated = {
          ...existing,
          priceBdt: Number(body.priceBdt) > 0 ? Number(body.priceBdt) : existing.priceBdt,
          deliveryNote:
            typeof body.deliveryNote === 'string' && body.deliveryNote.trim()
              ? body.deliveryNote.trim()
              : existing.deliveryNote,
          image: typeof body.image === 'string' ? body.image.trim() : existing.image,
        };
        store.packages = store.packages.map((p) => (p.id === id ? updated : p));
        writeStoreFile(store);
        res.status(200).json(updated);
        return;
      }
      if (method === 'DELETE') {
        store.packages = store.packages.filter((p) => p.id !== id);
        writeStoreFile(store);
        res.status(200).json({ ok: true });
        return;
      }
    }
  }

  // PUT /api/group-settings
  if (parts[0] === 'group-settings' && parts.length === 1 && method === 'PUT') {
    const groupId = Number(body.groupId);
    const groupUrl = typeof body.groupUrl === 'string' ? body.groupUrl.trim() : '';
    const rawRobux = Number(body.availableRobux);
    const availableRobux =
      typeof body.availableRobux === 'number' && Number.isFinite(rawRobux) && rawRobux >= 0
        ? Math.min(1000000000, Math.round(rawRobux))
        : store.groupSettings.availableRobux ?? 25400;
    if (!groupId || groupId <= 0 || !groupUrl) {
      res.status(400).json({ error: 'Invalid group settings' });
      return;
    }
    const restockTimestamp =
      typeof body.restockTimestamp === 'number' && Number.isFinite(body.restockTimestamp)
        ? body.restockTimestamp
        : store.groupSettings.restockTimestamp;
    const updatedAtMs =
      typeof body.updatedAtMs === 'number' && Number.isFinite(body.updatedAtMs) && body.updatedAtMs > 0
        ? body.updatedAtMs
        : Date.now();
    store.groupSettings = { groupId, groupUrl, availableRobux, restockTimestamp, updatedAtMs };
    writeStoreFile(store);
    res.status(200).json(store.groupSettings);
    return;
  }

  // /api/orders & /api/orders/:id
  if (parts[0] === 'orders') {
    if (parts.length === 1 && method === 'POST') {
      if (!body.id || !body.orderNumber || !body.packageTitle || !body.userEmail) {
        res.status(400).json({ error: 'Invalid order payload' });
        return;
      }
      const orderId = String(body.id);
      if (store.deletedOrderIds.includes(orderId)) {
        res.status(200).json({ ok: true, skippedDeleted: true });
        return;
      }
      const existing = store.orders.find((o) => o.id === orderId);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
      const status = body.status && VALID_STATUSES.has(body.status) ? body.status : 'Pending';
      const isAdminAction = Boolean(body.adminAction);
      const requestedRobux = Number(body.robuxAmount) || 0;
      const liveAvailable = store.groupSettings.availableRobux ?? 25400;
      if (!isAdminAction && status !== 'Waiting' && (liveAvailable <= 0 || requestedRobux > liveAvailable)) {
        res.status(409).json({
          error:
            liveAvailable <= 0
              ? 'Robux is currently out of stock (0 available). Orders cannot be placed until restocked.'
              : `Only ${liveAvailable.toLocaleString()} Robux available in stock.`,
        });
        return;
      }
      const nowIso = new Date().toISOString();
      const created = {
        id: orderId,
        orderNumber: String(body.orderNumber),
        userEmail: String(body.userEmail),
        userName: String(body.userName || 'Customer'),
        userPhone: typeof body.userPhone === 'string' ? body.userPhone : '',
        robloxUsername: String(body.robloxUsername || 'Verified Member'),
        robloxUserId: typeof body.robloxUserId === 'number' ? body.robloxUserId : null,
        packageId: String(body.packageId || ''),
        packageTitle: String(body.packageTitle),
        robuxAmount: Number(body.robuxAmount) || 0,
        priceBdt: Number(body.priceBdt) || 0,
        paymentMethod: String(body.paymentMethod || 'Nagad'),
        transactionId:
          typeof body.transactionId === 'string'
            ? body.transactionId.trim().toUpperCase()
            : undefined,
        paymentVerified: Boolean(body.paymentVerified),
        status,
        verifiedAtMs: typeof body.verifiedAtMs === 'number' ? body.verifiedAtMs : undefined,
        unlockAtMs: typeof body.unlockAtMs === 'number' ? body.unlockAtMs : undefined,
        createdAt: String(body.createdAt || nowIso),
        confirmedAt:
          status === 'Approved' || status === 'Completed'
            ? typeof body.confirmedAt === 'string'
              ? body.confirmedAt
              : nowIso
            : undefined,
      };
      store.orders = [created, ...store.orders];
      writeStoreFile(store);
      res.status(201).json(created);
      return;
    }

    if (parts.length === 2) {
      const id = parts[1];
      if (method === 'PATCH') {
        if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
          res.status(400).json({ error: 'Invalid order status' });
          return;
        }
        const found = store.orders.find((o) => o.id === id);
        if (!found) {
          res.status(404).json({ error: 'Order not found' });
          return;
        }
        const nextStatus = body.status ?? found.status;
        const isAdminAction = Boolean(body.adminAction);
        const nextRobux =
          typeof body.robuxAmount === 'number' && body.robuxAmount > 0
            ? body.robuxAmount
            : found.robuxAmount;
        const liveAvailable = store.groupSettings.availableRobux ?? 25400;
        if (
          !isAdminAction &&
          found.status === 'Waiting' &&
          (nextStatus === 'Pending' || nextStatus === 'Approved') &&
          (liveAvailable <= 0 || nextRobux > liveAvailable)
        ) {
          res.status(409).json({
            error:
              liveAvailable <= 0
                ? 'Robux is currently out of stock (0 available). Orders cannot be placed until restocked.'
                : `Only ${liveAvailable.toLocaleString()} Robux available in stock.`,
          });
          return;
        }
        const nowIso = new Date().toISOString();
        const isConfirmedState = nextStatus === 'Approved' || nextStatus === 'Completed';
        const updated = {
          ...found,
          status: nextStatus,
          paymentMethod:
            typeof body.paymentMethod === 'string' && body.paymentMethod.trim()
              ? body.paymentMethod.trim()
              : found.paymentMethod,
          transactionId:
            typeof body.transactionId === 'string'
              ? body.transactionId.trim().toUpperCase()
              : found.transactionId,
          paymentVerified:
            typeof body.paymentVerified === 'boolean'
              ? body.paymentVerified
              : isConfirmedState
              ? true
              : found.paymentVerified,
          packageId:
            typeof body.packageId === 'string' && body.packageId.trim()
              ? body.packageId.trim()
              : found.packageId,
          packageTitle:
            typeof body.packageTitle === 'string' && body.packageTitle.trim()
              ? body.packageTitle.trim()
              : found.packageTitle,
          robuxAmount:
            typeof body.robuxAmount === 'number' && body.robuxAmount > 0
              ? body.robuxAmount
              : found.robuxAmount,
          priceBdt:
            typeof body.priceBdt === 'number' && body.priceBdt > 0
              ? body.priceBdt
              : found.priceBdt,
          userName:
            typeof body.userName === 'string' && body.userName.trim()
              ? body.userName.trim()
              : found.userName,
          userEmail:
            typeof body.userEmail === 'string' && body.userEmail.trim()
              ? body.userEmail.trim()
              : found.userEmail,
          userPhone: typeof body.userPhone === 'string' ? body.userPhone : found.userPhone,
          unlockAtMs: typeof body.unlockAtMs === 'number' ? body.unlockAtMs : found.unlockAtMs,
          confirmedAt: isConfirmedState ? found.confirmedAt || nowIso : found.confirmedAt,
        };
        store.orders = store.orders.map((o) => (o.id === id ? updated : o));
        writeStoreFile(store);
        res.status(200).json(updated);
        return;
      }
      if (method === 'DELETE') {
        if (id && !store.deletedOrderIds.includes(id)) {
          store.deletedOrderIds = [id, ...store.deletedOrderIds].slice(0, 500);
        }
        store.orders = store.orders.filter((o) => o.id !== id);
        writeStoreFile(store);
        res.status(200).json({ ok: true, deletedOrderIds: store.deletedOrderIds });
        return;
      }
    }
  }

  // /api/payments/*
  if (parts[0] === 'payments') {
    if (parts[1] === 'ledger' && parts.length === 2) {
      if (method === 'GET') {
        res.status(200).json(store.verifiedPayments);
        return;
      }
      if (method === 'POST') {
        const payMethod = normalizeMethodName(body.method || 'Nagad');
        const check = validateMfsTrxId(payMethod, body.trxId || '');
        const amountBdt = Number(body.amountBdt);
        if (!check.valid) {
          res.status(400).json({ error: check.error });
          return;
        }
        if (!amountBdt || amountBdt <= 0) {
          res.status(400).json({ error: 'Amount (BDT) must be greater than 0.' });
          return;
        }
        const existing = store.verifiedPayments.find(
          (p) => p.method === payMethod && p.trxId === check.normalized
        );
        if (existing) {
          res
            .status(409)
            .json({ error: `${payMethod} TrxID ${check.normalized} is already in the payment inbox.` });
          return;
        }
        const entry = {
          id: `pay-${Date.now()}`,
          method: payMethod,
          trxId: check.normalized,
          amountBdt,
          senderPhone: typeof body.senderPhone === 'string' ? body.senderPhone.trim() : '',
          receiverPhone: OFFICIAL_MFS_NUMBER,
          source: 'admin_manual',
          receivedAt: new Date().toISOString(),
        };
        const matchingOrder = store.orders.find(
          (o) =>
            o.status === 'Pending' &&
            (o.transactionId || '').trim().toUpperCase() === entry.trxId &&
            normalizeMethodName(o.paymentMethod) === entry.method &&
            entry.amountBdt >= o.priceBdt
        );
        if (matchingOrder) {
          entry.usedByOrderId = matchingOrder.orderNumber;
          const confirmedAt = matchingOrder.confirmedAt || new Date().toISOString();
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? { ...o, status: 'Approved', paymentVerified: true, confirmedAt }
              : o
          );
        }
        store.verifiedPayments = [entry, ...store.verifiedPayments];
        writeStoreFile(store);
        res.status(201).json({ entry, autoApprovedOrder: matchingOrder?.orderNumber || null });
        return;
      }
    }

    if (parts[1] === 'ledger' && parts.length === 3 && method === 'DELETE') {
      const id = parts[2];
      store.verifiedPayments = store.verifiedPayments.filter((p) => p.id !== id);
      writeStoreFile(store);
      res.status(200).json({ ok: true });
      return;
    }

    if (parts[1] === 'webhook' && parts.length === 2 && method === 'POST') {
      const rawText = String(body.message || body.text || body.body || '').trim();
      const senderHint = String(body.sender || body.from || body.method || '');
      const parsed = rawText
        ? parseMfsSms(rawText, senderHint)
        : body.trxId && body.amountBdt
        ? {
            method: normalizeMethodName(body.method || 'Nagad'),
            trxId: String(body.trxId).trim().toUpperCase(),
            amountBdt: Number(body.amountBdt),
            senderPhone: undefined,
          }
        : null;
      if (!parsed) {
        res.status(400).json({ error: 'Could not extract TrxID and BDT amount from SMS payload.' });
        return;
      }
      const existing = store.verifiedPayments.find(
        (p) => p.method === parsed.method && p.trxId === parsed.trxId
      );
      if (existing) {
        res.status(200).json({ ok: true, duplicate: true, entry: existing });
        return;
      }
      const entry = {
        id: `sms-${Date.now()}`,
        method: parsed.method,
        trxId: parsed.trxId,
        amountBdt: parsed.amountBdt,
        senderPhone: parsed.senderPhone,
        receiverPhone: OFFICIAL_MFS_NUMBER,
        source: 'sms_webhook',
        receivedAt: new Date().toISOString(),
      };
      const matchingOrder = store.orders.find(
        (o) =>
          o.status === 'Pending' &&
          (o.transactionId || '').trim().toUpperCase() === entry.trxId &&
          normalizeMethodName(o.paymentMethod) === entry.method &&
          entry.amountBdt >= o.priceBdt
      );
      if (matchingOrder) {
        entry.usedByOrderId = matchingOrder.orderNumber;
        const confirmedAt = matchingOrder.confirmedAt || new Date().toISOString();
        store.orders = store.orders.map((o) =>
          o.id === matchingOrder.id
            ? { ...o, status: 'Approved', paymentVerified: true, confirmedAt }
            : o
        );
      }
      store.verifiedPayments = [entry, ...store.verifiedPayments];
      writeStoreFile(store);
      res.status(201).json({ ok: true, entry, autoApprovedOrder: matchingOrder?.orderNumber || null });
      return;
    }

    if (parts[1] === 'verify' && parts.length === 2 && method === 'POST') {
      const payMethod = normalizeMethodName(body.method || 'Nagad');
      const check = validateMfsTrxId(payMethod, body.trxId || '');
      if (!check.valid) {
        res.status(400).json({ valid: false, verified: false, error: check.error });
        return;
      }
      const expectedAmount = Number(body.expectedAmountBdt) || 0;
      const duplicateOrder = store.orders.find(
        (o) =>
          o.status !== 'Cancelled' &&
          (o.transactionId || '').trim().toUpperCase() === check.normalized &&
          (!body.orderNumber || o.orderNumber !== body.orderNumber)
      );
      if (duplicateOrder) {
        res.status(409).json({
          valid: false,
          verified: false,
          error: `Transaction ID ${check.normalized} has already been used for Order ${duplicateOrder.orderNumber}.`,
        });
        return;
      }
      const matchedPayment = store.verifiedPayments.find(
        (p) =>
          p.trxId === check.normalized &&
          p.method === payMethod &&
          (!p.usedByOrderId || p.usedByOrderId === body.orderNumber)
      );
      if (matchedPayment) {
        if (expectedAmount > 0 && matchedPayment.amountBdt < expectedAmount) {
          res.status(400).json({
            valid: false,
            verified: false,
            error: `Payment amount mismatch: ${payMethod} TrxID ${check.normalized} received ৳${matchedPayment.amountBdt}, but package costs ৳${expectedAmount}.`,
          });
          return;
        }
        if (body.orderNumber) {
          store.verifiedPayments = store.verifiedPayments.map((p) =>
            p.id === matchedPayment.id ? { ...p, usedByOrderId: body.orderNumber } : p
          );
          writeStoreFile(store);
        }
        res.status(200).json({
          valid: true,
          verified: true,
          normalizedTrxId: check.normalized,
          status: 'Approved',
        });
        return;
      }
      res.status(200).json({
        valid: true,
        verified: false,
        normalizedTrxId: check.normalized,
        status: 'Pending',
      });
      return;
    }
  }

  // /api/users & /api/users/:id
  if (parts[0] === 'users') {
    if (parts.length === 1 && method === 'POST') {
      const cleanEmail = String(body.email || '').trim().toLowerCase();
      const cleanName = String(body.name || '').trim();
      const cleanPhone = String(body.phone || '').trim();
      const password = String(body.password || '');
      if (!body.id || !cleanEmail || !cleanName || !cleanPhone || password.length < 4) {
        res.status(400).json({ error: 'Invalid user payload' });
        return;
      }
      const cleanAvatar = sanitizeAvatarValue(body.avatar);
      const cleanTimer = sanitizeVerificationTimer(body.verificationTimer);
      const cleanTimersMap = sanitizeVerifiedRobloxTimers(body.verifiedRobloxTimers);
      const incomingTs =
        typeof body.updatedAtMs === 'number' && Number.isFinite(body.updatedAtMs)
          ? body.updatedAtMs
          : Date.now();
      const existingByEmail = store.users.find((u) => u.email.toLowerCase() === cleanEmail);
      if (existingByEmail) {
        if (incomingTs > (existingByEmail.updatedAtMs || 0)) {
          const merged = {
            ...existingByEmail,
            name: cleanName || existingByEmail.name,
            phone: cleanPhone || existingByEmail.phone,
            password: password || existingByEmail.password,
            avatar: typeof body.avatar === 'string' ? cleanAvatar : existingByEmail.avatar || '',
            verificationTimer:
              cleanTimer !== undefined ? cleanTimer : existingByEmail.verificationTimer,
            verifiedRobloxTimers:
              cleanTimersMap !== undefined
                ? { ...(existingByEmail.verifiedRobloxTimers || {}), ...cleanTimersMap }
                : existingByEmail.verifiedRobloxTimers,
            updatedAtMs: incomingTs,
          };
          store.users = store.users.map((u) => (u.id === existingByEmail.id ? merged : u));
          writeStoreFile(store);
          res.status(200).json(merged);
          return;
        }
        res.status(200).json(existingByEmail);
        return;
      }
      const created = {
        id: String(body.id),
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        password,
        avatar: cleanAvatar,
        verificationTimer: cleanTimer,
        verifiedRobloxTimers: cleanTimersMap,
        updatedAtMs: incomingTs,
        createdAt: String(body.createdAt || new Date().toISOString()),
      };
      store.users = [...store.users, created];
      writeStoreFile(store);
      res.status(201).json(created);
      return;
    }

    if (parts.length === 2 && method === 'PATCH') {
      const id = parts[1];
      let found = store.users.find((u) => u.id === id);
      if (!found && typeof body.email === 'string' && body.email.trim()) {
        const targetEmail = body.email.trim().toLowerCase();
        found = store.users.find((u) => u.email.toLowerCase() === targetEmail);
      }
      if (!found) {
        const cleanEmail = String(body.email || '').trim().toLowerCase();
        const cleanName = String(body.name || '').trim();
        const cleanPhone = String(body.phone || '').trim();
        const password = String(body.password || '');
        if (cleanEmail && cleanName && cleanPhone && password.length >= 4) {
          const created = {
            id: String(id || `usr-${Date.now()}`),
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            password,
            avatar: sanitizeAvatarValue(body.avatar),
            verificationTimer: sanitizeVerificationTimer(body.verificationTimer),
            verifiedRobloxTimers: sanitizeVerifiedRobloxTimers(body.verifiedRobloxTimers),
            updatedAtMs:
              typeof body.updatedAtMs === 'number' && Number.isFinite(body.updatedAtMs)
                ? body.updatedAtMs
                : Date.now(),
            createdAt: new Date().toISOString(),
          };
          store.users = [...store.users, created];
          writeStoreFile(store);
          res.status(201).json(created);
          return;
        }
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const nextEmail =
        typeof body.email === 'string' && body.email.trim()
          ? body.email.trim().toLowerCase()
          : found.email;
      const conflict = store.users.find(
        (u) => u.id !== found.id && u.email.toLowerCase() === nextEmail
      );
      if (conflict) {
        res.status(409).json({ error: 'Email already registered to another user' });
        return;
      }
      const incomingTimer = sanitizeVerificationTimer(body.verificationTimer);
      const incomingTimersMap = sanitizeVerifiedRobloxTimers(body.verifiedRobloxTimers);
      const updated = {
        ...found,
        name:
          typeof body.name === 'string' && body.name.trim() ? body.name.trim() : found.name,
        email: nextEmail,
        phone:
          typeof body.phone === 'string' && body.phone.trim()
            ? body.phone.trim()
            : found.phone,
        password:
          typeof body.password === 'string' && body.password.length >= 4
            ? body.password
            : found.password,
        avatar:
          typeof body.avatar === 'string'
            ? sanitizeAvatarValue(body.avatar)
            : sanitizeAvatarValue(found.avatar),
        verificationTimer:
          incomingTimer !== undefined ? incomingTimer : found.verificationTimer,
        verifiedRobloxTimers:
          incomingTimersMap !== undefined
            ? incomingTimersMap
            : found.verifiedRobloxTimers,
        updatedAtMs:
          typeof body.updatedAtMs === 'number' && Number.isFinite(body.updatedAtMs)
            ? Math.max(found.updatedAtMs || 0, body.updatedAtMs)
            : Date.now(),
      };
      store.users = store.users.map((u) => (u.id === found.id ? updated : u));
      writeStoreFile(store);
      res.status(200).json(updated);
      return;
    }
  }

  res.status(404).json({ error: 'API endpoint not found' });
}
