import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_EMAIL = 'dnshow53@gmail.com';
const ADMIN_PASSWORD_SALT = '51c0c6174f3020278f724f2d13cc5279';
const ADMIN_PASSWORD_HASH =
  '9e33ba706560d5f69067e5eeb4b4250d5ded8b7cccd9d20401ae9b5e3db97fb9c60ced8f5292f0ad2b4ef1501494e5ff4d2d7fdc366eae6a242670598428d5ff';

function verifyAdminPassword(candidate: string): boolean {
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

interface StorePackage {
  id: string;
  robux: number;
  title: string;
  tierLabel: string;
  priceBdt: number;
  deliveryNote: string;
  image: string;
}

type OrderStatus = 'Waiting' | 'Pending' | 'Approved' | 'Completed' | 'Cancelled';

interface StoreOrder {
  id: string;
  orderNumber: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
  robloxUsername: string;
  robloxUserId?: number | null;
  packageId: string;
  packageTitle: string;
  robuxAmount: number;
  priceBdt: number;
  paymentMethod: string;
  transactionId?: string;
  paymentVerified?: boolean;
  status: OrderStatus;
  verifiedAtMs?: number;
  unlockAtMs?: number;
  createdAt: string;
  confirmedAt?: string;
}

interface VerifiedMfsPayment {
  id: string;
  method: 'Nagad' | 'Rocket' | 'bKash';
  trxId: string;
  amountBdt: number;
  senderPhone?: string;
  receiverPhone: string;
  source: 'sms_webhook' | 'admin_manual';
  usedByOrderId?: string;
  receivedAt: string;
}

interface StoreGroupSettings {
  groupId: number;
  groupUrl: string;
  availableRobux: number;
  restockTimestamp?: number;
  updatedAtMs?: number;
}

interface StoreVerificationTimer {
  hasClickedGroupLink: boolean;
  isGroupVerified: boolean;
  unlockAtMs: number;
  verifiedAtMs: number;
  robloxUsername: string;
  robloxUserId: number | null;
}

interface StoreUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  avatar?: string;
  verificationTimer?: StoreVerificationTimer;
  verifiedRobloxTimers?: Record<string, StoreVerificationTimer>;
  updatedAtMs?: number;
  createdAt: string;
}

interface StoreDatabase {
  packages: StorePackage[];
  orders: StoreOrder[];
  deletedOrderIds: string[];
  users: StoreUser[];
  groupSettings: StoreGroupSettings;
  verifiedPayments: VerifiedMfsPayment[];
}

const DEFAULT_STORE: StoreDatabase = {
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
    groupUrl:
      'https://www.roblox.com/communities/401717676/Velvet-Visions-Studio#!/about',
    availableRobux: 25400,
  },
  verifiedPayments: [],
};

function ensureStoreFile(): StoreDatabase {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_FILE)) {
      fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
      return structuredClone(DEFAULT_STORE);
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreDatabase>;
    const normalized: StoreDatabase = {
      packages:
        Array.isArray(parsed.packages) && parsed.packages.length > 0
          ? parsed.packages.map((p) => ({
              ...p,
              priceBdt: Number(p.priceBdt) || 590,
              image:
                typeof p.image === 'string' &&
                !p.image.startsWith('/src/assets/images/pkg_')
                  ? p.image
                  : '',
            }))
          : structuredClone(DEFAULT_STORE.packages),
      deletedOrderIds: Array.isArray(parsed.deletedOrderIds)
        ? parsed.deletedOrderIds.filter((id): id is string => typeof id === 'string')
        : [],
      orders: Array.isArray(parsed.orders)
        ? parsed.orders
            .filter(
              (o) =>
                !Array.isArray(parsed.deletedOrderIds) ||
                !parsed.deletedOrderIds.includes(o.id)
            )
            .map((o) => {
              const rawSt = String(o.status || '').trim().toLowerCase();
              const normalizedStatus: OrderStatus =
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
                status: normalizedStatus,
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
      verifiedPayments: Array.isArray(parsed.verifiedPayments)
        ? parsed.verifiedPayments
        : [],
    };
    return normalized;
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

function sanitizeAvatarValue(rawAvatar: unknown): string {
  if (typeof rawAvatar !== 'string') return '';
  const trimmed = rawAvatar.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/uploads/')) {
    try {
      const safeName = path.basename(trimmed);
      const diskPath = path.join(UPLOADS_DIR, safeName);
      if (fs.existsSync(diskPath)) {
        const stat = fs.statSync(diskPath);
        if (stat.isFile() && stat.size > 0 && stat.size <= 350 * 1024) {
          const ext = path.extname(safeName).toLowerCase();
          const mime =
            ext === '.png'
              ? 'image/png'
              : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg';
          const b64 = fs.readFileSync(diskPath).toString('base64');
          return `data:${mime};base64,${b64}`;
        }
        return trimmed;
      }
    } catch {
      // Ignore disk errors and clear dead upload path
    }
    return '';
  }
  return '';
}

function sanitizeVerificationTimer(raw: unknown): StoreVerificationTimer | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<StoreVerificationTimer>;
  return {
    hasClickedGroupLink: Boolean(obj.hasClickedGroupLink),
    isGroupVerified: Boolean(obj.isGroupVerified),
    unlockAtMs:
      typeof obj.unlockAtMs === 'number' && Number.isFinite(obj.unlockAtMs)
        ? Math.max(0, obj.unlockAtMs)
        : 0,
    verifiedAtMs:
      typeof obj.verifiedAtMs === 'number' && Number.isFinite(obj.verifiedAtMs)
        ? Math.max(0, obj.verifiedAtMs)
        : 0,
    robloxUsername: typeof obj.robloxUsername === 'string' ? obj.robloxUsername.trim().slice(0, 32) : '',
    robloxUserId:
      typeof obj.robloxUserId === 'number' && Number.isFinite(obj.robloxUserId) && obj.robloxUserId > 0
        ? obj.robloxUserId
        : null,
  };
}

function sanitizeVerifiedRobloxTimers(
  raw: unknown
): Record<string, StoreVerificationTimer> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  const out: Record<string, StoreVerificationTimer> = {};
  for (const [key, val] of entries) {
    const cleanKey = String(key || '').trim().toLowerCase().slice(0, 32);
    if (!cleanKey) continue;
    const sanitized = sanitizeVerificationTimer(val);
    if (sanitized) {
      out[cleanKey] = sanitized;
    }
  }
  return out;
}

function writeStoreFile(store: StoreDatabase): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Ignore disk write errors gracefully
  }
}

let store: StoreDatabase = ensureStoreFile();

const OFFICIAL_MFS_NUMBER = '01764088123';

const VALID_STATUSES = new Set<OrderStatus>([
  'Waiting',
  'Pending',
  'Approved',
  'Completed',
  'Cancelled',
]);

function normalizeMethodName(method: string): 'Nagad' | 'Rocket' | 'bKash' {
  const m = String(method || '').toLowerCase();
  if (m.includes('rocket') || m.includes('dbbl')) return 'Rocket';
  if (m.includes('bkash')) return 'bKash';
  return 'Nagad';
}

function validateMfsTrxId(
  method: string,
  rawTrxId: string
): { valid: boolean; normalized: string; error?: string } {
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
  // Reject pure-letter gibberish (e.g. Sjjcmmfj) or repeated characters (e.g. 11111111, AAAAAAAA)
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
      error: 'Test or repeated-digit Transaction IDs are not accepted. Please enter your real payment TrxID.',
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

function parseMfsSms(
  rawText: string,
  senderHint = ''
): {
  method: 'Nagad' | 'Rocket' | 'bKash';
  trxId: string;
  amountBdt: number;
  senderPhone?: string;
} | null {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const combined = `${senderHint} ${text}`.toLowerCase();

  let method: 'Nagad' | 'Rocket' | 'bKash' = 'Nagad';
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
    text.match(/(?:tk|bdt|taka)\s*\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
    text.match(/received\s+(?:money\s+)?(?:of\s+)?([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const phoneMatch = text.match(/\b(01[3-9]\d{8})\b/);

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/uploads', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Uploaded file not found' });
  });

  // Product photo upload endpoint (Admin uploads image file -> saved to data/uploads/)
  app.post('/api/uploads', (req: Request, res: Response) => {
    const body = req.body as { dataUrl?: string };
    const dataUrl = String(body.dataUrl || '').trim();
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Invalid image format. Please choose a PNG, JPG, or WebP image.' });
      return;
    }
    const extRaw = match[1].toLowerCase();
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'Image is too large (max 5MB).' });
      return;
    }
    const filename = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    res.status(201).json({ url: `/uploads/${filename}` });
  });

  // Admin authentication endpoint (verifies credentials server-side)
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const cleanEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (cleanEmail !== ADMIN_EMAIL.toLowerCase() || !verifyAdminPassword(password)) {
      res.status(401).json({ error: 'Invalid Admin email or password.' });
      return;
    }
    res.json({ ok: true, email: ADMIN_EMAIL });
  });

  // Store read endpoint
  app.get('/api/store', (_req: Request, res: Response) => {
    store = ensureStoreFile();
    res.json(store);
  });

  // Packages CRUD
  app.post('/api/packages', (req: Request, res: Response) => {
    const body = req.body as Partial<StorePackage>;
    const robux = Number(body.robux);
    const priceBdt = Number(body.priceBdt);
    if (!robux || robux <= 0 || !priceBdt || priceBdt <= 0 || !body.id || !body.title) {
      res.status(400).json({ error: 'Invalid package payload' });
      return;
    }
    const cleanImage =
      typeof body.image === 'string' &&
      !body.image.startsWith('/src/assets/images/pkg_')
        ? body.image.trim()
        : '';
    const pkg: StorePackage = {
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
  });

  app.patch('/api/packages/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<StorePackage>;
    const existing = store.packages.find((p) => p.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Package not found' });
      return;
    }
    const updated: StorePackage = {
      ...existing,
      priceBdt: Number(body.priceBdt) > 0 ? Number(body.priceBdt) : existing.priceBdt,
      deliveryNote:
        typeof body.deliveryNote === 'string' && body.deliveryNote.trim()
          ? body.deliveryNote.trim()
          : existing.deliveryNote,
      image:
        typeof body.image === 'string'
          ? body.image.trim()
          : existing.image,
    };
    store.packages = store.packages.map((p) => (p.id === id ? updated : p));
    writeStoreFile(store);
    res.json(updated);
  });

  app.delete('/api/packages/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    store.packages = store.packages.filter((p) => p.id !== id);
    writeStoreFile(store);
    res.json({ ok: true });
  });

  // Group settings update
  app.put('/api/group-settings', (req: Request, res: Response) => {
    const body = req.body as Partial<StoreGroupSettings>;
    const groupId = Number(body.groupId);
    const groupUrl = typeof body.groupUrl === 'string' ? body.groupUrl.trim() : '';
    const rawRobux = Number(body.availableRobux);
    const availableRobux =
      typeof body.availableRobux === 'number' &&
      Number.isFinite(rawRobux) &&
      rawRobux >= 0
        ? Math.min(1000000000, Math.round(rawRobux))
        : (store.groupSettings.availableRobux ?? 25400);
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
    res.json(store.groupSettings);
  });

  // Orders CRUD
  app.post('/api/orders', async (req: Request, res: Response) => {
    const body = req.body as Partial<StoreOrder>;
    if (!body.id || !body.orderNumber || !body.packageTitle || !body.userEmail) {
      res.status(400).json({ error: 'Invalid order payload' });
      return;
    }
    const orderId = String(body.id);
    if (store.deletedOrderIds.includes(orderId)) {
      res.json({ ok: true, skippedDeleted: true });
      return;
    }
    const existing = store.orders.find((o) => o.id === orderId);
    if (existing) {
      res.json(existing);
      return;
    }
    const status: OrderStatus =
      body.status && VALID_STATUSES.has(body.status) ? body.status : 'Pending';
    const isAdminAction = Boolean((body as { adminAction?: boolean }).adminAction);
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
    const created: StoreOrder = {
      id: String(body.id),
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
  });

  app.patch('/api/orders/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<StoreOrder> & {
      adminAction?: boolean;
    };
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
    const updated: StoreOrder = {
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
      userPhone:
        typeof body.userPhone === 'string' ? body.userPhone : found.userPhone,
      unlockAtMs:
        typeof body.unlockAtMs === 'number' ? body.unlockAtMs : found.unlockAtMs,
      confirmedAt: isConfirmedState ? found.confirmedAt || nowIso : found.confirmedAt,
    };

    store.orders = store.orders.map((o) => (o.id === id ? updated : o));
    writeStoreFile(store);
    res.json(updated);
  });

  app.delete('/api/orders/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (id && !store.deletedOrderIds.includes(id)) {
      store.deletedOrderIds = [id, ...store.deletedOrderIds].slice(0, 500);
    }
    store.orders = store.orders.filter((o) => o.id !== id);
    writeStoreFile(store);
    res.json({ ok: true, deletedOrderIds: store.deletedOrderIds });
  });

  // Payment Verification & 01764088123 Nagad/Rocket SMS Ledger
  app.get('/api/payments/ledger', (_req: Request, res: Response) => {
    store = ensureStoreFile();
    res.json(store.verifiedPayments);
  });

  app.post('/api/payments/ledger', (req: Request, res: Response) => {
    const body = req.body as {
      method?: string;
      trxId?: string;
      amountBdt?: number;
      senderPhone?: string;
    };
    const method = normalizeMethodName(body.method || 'Nagad');
    const check = validateMfsTrxId(method, body.trxId || '');
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
      (p) => p.method === method && p.trxId === check.normalized
    );
    if (existing) {
      res.status(409).json({ error: `${method} TrxID ${check.normalized} is already in the payment inbox.` });
      return;
    }

    const entry: VerifiedMfsPayment = {
      id: `pay-${Date.now()}`,
      method,
      trxId: check.normalized,
      amountBdt,
      senderPhone: typeof body.senderPhone === 'string' ? body.senderPhone.trim() : '',
      receiverPhone: OFFICIAL_MFS_NUMBER,
      source: 'admin_manual',
      receivedAt: new Date().toISOString(),
    };

    // Auto-approve any matching Pending order waiting on this exact TrxID & method
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
  });

  app.delete('/api/payments/ledger/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    store.verifiedPayments = store.verifiedPayments.filter((p) => p.id !== id);
    writeStoreFile(store);
    res.json({ ok: true });
  });

  // Webhook endpoint for Android SMS Forwarder apps running on 01764088123
  app.post('/api/payments/webhook', (req: Request, res: Response) => {
    const body = req.body as {
      message?: string;
      text?: string;
      body?: string;
      sender?: string;
      from?: string;
      method?: string;
      trxId?: string;
      amountBdt?: number;
    };

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
      res.json({ ok: true, duplicate: true, entry: existing });
      return;
    }

    const entry: VerifiedMfsPayment = {
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
  });

  // Verify customer-submitted TrxID against 01764088123 rules & received SMS/ledger
  app.post('/api/payments/verify', (req: Request, res: Response) => {
    store = ensureStoreFile();
    const body = req.body as {
      method?: string;
      trxId?: string;
      expectedAmountBdt?: number;
      orderNumber?: string;
    };
    const method = normalizeMethodName(body.method || 'Nagad');
    const check = validateMfsTrxId(method, body.trxId || '');
    if (!check.valid) {
      res.status(400).json({ valid: false, verified: false, error: check.error });
      return;
    }

    const expectedAmount = Number(body.expectedAmountBdt) || 0;
    const duplicateOrder = store.orders.find(
      (o) =>
        o.status !== 'Cancelled' &&
        (o.transactionId || '').trim().toUpperCase() === check.normalized
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
        !p.usedByOrderId &&
        p.method === method &&
        p.trxId === check.normalized
    );

    if (matchedPayment) {
      if (expectedAmount > 0 && matchedPayment.amountBdt < expectedAmount) {
        res.status(400).json({
          valid: false,
          verified: false,
          error: `Received payment for TrxID ${check.normalized} is ৳${matchedPayment.amountBdt} BDT, which is less than the required ৳${expectedAmount} BDT.`,
        });
        return;
      }

      if (body.orderNumber) {
        store.verifiedPayments = store.verifiedPayments.map((p) =>
          p.id === matchedPayment.id ? { ...p, usedByOrderId: body.orderNumber } : p
        );
        writeStoreFile(store);
      }

      res.json({
        valid: true,
        verified: true,
        normalizedTrxId: check.normalized,
        status: 'Approved',
      });
      return;
    }

    // Valid format & unused, but not yet matched by 01764088123 SMS webhook -> stays Pending Admin Verification
    res.json({
      valid: true,
      verified: false,
      normalizedTrxId: check.normalized,
      status: 'Pending',
    });
  });

  // Users CRUD (syncs registered customer accounts across devices)
  app.post('/api/users', (req: Request, res: Response) => {
    const body = req.body as Partial<StoreUser>;
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
    const existingByEmail = store.users.find(
      (u) => u.email.toLowerCase() === cleanEmail
    );
    if (existingByEmail) {
      if (incomingTs > (existingByEmail.updatedAtMs || 0)) {
        const merged: StoreUser = {
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
        store.users = store.users.map((u) =>
          u.id === existingByEmail.id ? merged : u
        );
        writeStoreFile(store);
        res.json(merged);
        return;
      }
      res.json(existingByEmail);
      return;
    }
    const created: StoreUser = {
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
  });

  app.patch('/api/users/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<StoreUser>;
    store = ensureStoreFile();
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
        const created: StoreUser = {
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
    const updated: StoreUser = {
      ...found,
      name:
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : found.name,
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
    res.json(updated);
  });

  // Server-side Roblox membership verification (avoids browser CORS issues)
  app.post('/api/roblox/verify', async (req: Request, res: Response) => {
    const body = req.body as {
      username?: string;
      groupId?: number;
      knownUserId?: number | null;
    };
    const cleanUsername = String(body.username || '').trim();
    const targetGroupId = Number(body.groupId);

    if (!cleanUsername || !targetGroupId) {
      res.status(400).json({ status: 'network_error', message: 'Missing username or groupId' });
      return;
    }

    try {
      let userId = typeof body.knownUserId === 'number' ? body.knownUserId : null;
      let canonicalUsername = cleanUsername;

      if (!userId) {
        const userRes = await fetch('https://users.roblox.com/v1/usernames/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'User-Agent': 'RobuxOra-Verifier/1.0',
          },
          body: JSON.stringify({ usernames: [cleanUsername], excludeBannedUsers: true }),
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!userRes.ok) {
          res.json({
            status: 'network_error',
            message: 'Unable to reach Roblox API right now.',
          });
          return;
        }
        const userJson = (await userRes.json()) as {
          data?: Array<{ id?: number; name?: string }>;
        };
        const found = userJson?.data?.[0];
        if (!found || typeof found.id !== 'number') {
          res.json({
            status: 'user_not_found',
            message: 'Roblox username not found. Please check your spelling and try again.',
          });
          return;
        }
        userId = found.id;
        canonicalUsername = found.name || cleanUsername;
      }

      const groupsRes = await fetch(
        `https://groups.roblox.com/v1/users/${userId}/groups/roles?_cb=${Date.now()}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
            'User-Agent': 'RobuxOra-Verifier/1.0',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!groupsRes.ok) {
        res.json({
          status: 'network_error',
          message: 'Unable to check Roblox groups right now.',
        });
        return;
      }

      const groupsJson = (await groupsRes.json()) as {
        data?: Array<{ group?: { id?: number } }>;
      };
      if (!groupsJson || !Array.isArray(groupsJson.data)) {
        res.json({
          status: 'network_error',
          message: 'Unexpected response from Roblox group API.',
        });
        return;
      }
      const list = groupsJson.data;
      const joined = list.some(
        (item) => Number(item?.group?.id) === targetGroupId
      );

      if (!joined) {
        res.json({ status: 'not_joined', userId, username: canonicalUsername });
        return;
      }

      res.json({ status: 'verified', userId, username: canonicalUsername });
    } catch {
      res.json({
        status: 'network_error',
        message: 'Network error while reaching Roblox API.',
      });
    }
  });

  // Catch unmatched /api/* routes with clean JSON 404
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Always serve prebuilt static assets when dist/index.html is present; safely fall back during rebuilds
  const distDir = path.join(__dirname, 'dist');
  const distIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      if (!fs.existsSync(distIndex)) {
        res
          .status(503)
          .set('Retry-After', '1')
          .send(
            '<!doctype html><html><head><meta http-equiv="refresh" content="1"></head><body style="background:#090B0E;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">Updating app...</body></html>'
          );
        return;
      }
      res.sendFile(distIndex, (err) => {
        if (err && !res.headersSent) {
          res.status(503).set('Retry-After', '1').end();
        }
      });
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`RobuxOra server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
