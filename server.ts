import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_EMAIL,
  OFFICIAL_MFS_NUMBER,
  VALID_STATUSES,
  appendSecurityLog,
  createAdminToken,
  findDuplicateTrxRecord,
  getClientIp,
  getPublicStoreView,
  isAdminRequest,
  normalizeMethodName,
  normalizePhoneNumber,
  normalizeSecurityDatabaseFields,
  parseMfsSmsStrict,
  validateMfsTrxId,
  validateSenderPhone,
  verifyAdminPassword,
  verifyAndProcessCustomerPayment,
  verifyFirebaseAdminIdToken,
  verifyWebhookRequest,
  withPaymentLock,
} from './api/_paymentSecurity.js';

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
  senderPhone?: string;
  transactionId?: string;
  paymentVerified?: boolean;
  paymentFlag?: string;
  paymentFlagReason?: string;
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

interface UsedTrxRecord {
  trxId: string;
  method: 'Nagad' | 'Rocket' | 'bKash';
  orderId: string;
  orderNumber: string;
  userEmail: string;
  amountBdt: number;
  status: 'reserved_pending' | 'verified_approved' | 'flagged_mismatch';
  usedAt: string;
}

interface PaymentSecurityLog {
  id: string;
  category: 'successful' | 'failed' | 'duplicate' | 'suspicious';
  eventType: string;
  trxId: string;
  paymentMethod: string;
  submittedAmountBdt?: number;
  matchedAmountBdt?: number;
  senderPhone?: string;
  receiverPhone?: string;
  orderNumber?: string;
  userEmail?: string;
  reason: string;
  source: string;
  ip?: string;
  flagged: boolean;
  createdAt: string;
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
  schemaVersion?: number;
  packages: StorePackage[];
  orders: StoreOrder[];
  deletedOrderIds: string[];
  users: StoreUser[];
  groupSettings: StoreGroupSettings;
  verifiedPayments: VerifiedMfsPayment[];
  usedTrxIds: Record<string, UsedTrxRecord>;
  paymentSecurityLogs: PaymentSecurityLog[];
  usedWebhookNonces: Record<string, number>;
}

const DEFAULT_STORE: StoreDatabase = {
  schemaVersion: 2,
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
  usedTrxIds: {},
  paymentSecurityLogs: [],
  usedWebhookNonces: {},
};

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
    robloxUsername:
      typeof obj.robloxUsername === 'string' ? obj.robloxUsername.trim().slice(0, 32) : '',
    robloxUserId:
      typeof obj.robloxUserId === 'number' &&
      Number.isFinite(obj.robloxUserId) &&
      obj.robloxUserId > 0
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

function ensureStoreFile(): StoreDatabase {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_FILE)) {
      const initial = structuredClone(DEFAULT_STORE);
      fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreDatabase>;
    const normalized: StoreDatabase = {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
      packages:
        Array.isArray(parsed.packages) && parsed.packages.length > 0
          ? parsed.packages.map((p) => ({
              ...p,
              priceBdt: Number(p.priceBdt) || 590,
              image:
                typeof p.image === 'string' && p.image.trim()
                  ? p.image.trim()
                  : '/src/assets/images/pkg_starter_vault_1795779453204.jpg',
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
                senderPhone: typeof o.senderPhone === 'string' ? o.senderPhone : undefined,
                paymentFlag: typeof o.paymentFlag === 'string' ? o.paymentFlag : undefined,
                paymentFlagReason:
                  typeof o.paymentFlagReason === 'string' ? o.paymentFlagReason : undefined,
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
      usedTrxIds:
        parsed.usedTrxIds && typeof parsed.usedTrxIds === 'object' ? parsed.usedTrxIds : {},
      paymentSecurityLogs: Array.isArray(parsed.paymentSecurityLogs)
        ? parsed.paymentSecurityLogs
        : [],
      usedWebhookNonces:
        parsed.usedWebhookNonces && typeof parsed.usedWebhookNonces === 'object'
          ? parsed.usedWebhookNonces
          : {},
    };
    const migrated = normalizeSecurityDatabaseFields(normalized);
    if ((parsed.schemaVersion || 1) < 2) {
      writeStoreFile(migrated);
    }
    return migrated;
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

function writeStoreFile(nextStore: StoreDatabase): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextStore, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch {
    // Ignore disk write errors gracefully
  }
}

let store: StoreDatabase = ensureStoreFile();

interface RawBodyRequest extends Request {
  rawBody?: string;
}

export async function startServer() {
  const app = express();
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf.toString('utf8');
      },
    })
  );
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/uploads', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Uploaded file not found' });
  });

  // Product photo upload endpoint (Admin only)
  app.post('/api/uploads', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const body = req.body as { dataUrl?: string };
    const dataUrl = String(body.dataUrl || '').trim();
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      res
        .status(400)
        .json({ error: 'Invalid image format. Please choose a PNG, JPG, or WebP image.' });
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

  // Admin authentication endpoint (verifies credentials or Firebase Admin ID token & issues Bearer token)
  app.post('/api/admin/login', async (req: Request, res: Response) => {
    const body = req.body as {
      email?: unknown;
      password?: unknown;
      firebaseIdToken?: unknown;
    };

    if (typeof body.firebaseIdToken === 'string' && body.firebaseIdToken.trim()) {
      try {
        const verifiedPayload = await verifyFirebaseAdminIdToken(body.firebaseIdToken.trim());
        if (!verifiedPayload) {
          res.status(401).json({ error: 'Invalid or unauthorized Firebase Admin token.' });
          return;
        }
        const token = createAdminToken(ADMIN_EMAIL);
        res.json({ ok: true, email: ADMIN_EMAIL, token });
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
    res.json({ ok: true, email: ADMIN_EMAIL, token });
  });

  // Store read endpoint (sanitizes payment ledger & security logs unless authenticated Admin)
  app.get('/api/store', (req: Request, res: Response) => {
    store = ensureStoreFile();
    const adminAuthed = isAdminRequest(req);
    res.json(getPublicStoreView(store, adminAuthed));
  });

  // Packages CRUD (Admin only)
  app.post('/api/packages', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const body = req.body as Partial<StorePackage>;
    const robux = Number(body.robux);
    const priceBdt = Number(body.priceBdt);
    if (!robux || robux <= 0 || !priceBdt || priceBdt <= 0 || !body.id || !body.title) {
      res.status(400).json({ error: 'Invalid package payload' });
      return;
    }
    const cleanImage =
      typeof body.image === 'string' && body.image.trim()
        ? body.image.trim()
        : '/src/assets/images/pkg_starter_vault_1795779453204.jpg';
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
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
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
      image: typeof body.image === 'string' ? body.image.trim() : existing.image,
    };
    store.packages = store.packages.map((p) => (p.id === id ? updated : p));
    writeStoreFile(store);
    res.json(updated);
  });

  app.delete('/api/packages/:id', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const id = req.params.id;
    store.packages = store.packages.filter((p) => p.id !== id);
    writeStoreFile(store);
    res.json({ ok: true });
  });

  // Group settings update (Admin only)
  app.put('/api/group-settings', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const body = req.body as Partial<StoreGroupSettings>;
    const groupId = Number(body.groupId);
    const groupUrl = typeof body.groupUrl === 'string' ? body.groupUrl.trim() : '';
    const rawRobux = Number(body.availableRobux);
    const availableRobux =
      typeof body.availableRobux === 'number' &&
      Number.isFinite(rawRobux) &&
      rawRobux >= 0
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
      typeof body.updatedAtMs === 'number' &&
      Number.isFinite(body.updatedAtMs) &&
      body.updatedAtMs > 0
        ? body.updatedAtMs
        : Date.now();
    store.groupSettings = { groupId, groupUrl, availableRobux, restockTimestamp, updatedAtMs };
    writeStoreFile(store);
    res.json(store.groupSettings);
  });

  // Orders CRUD (strictly enforces no client-side payment verification or status elevation)
  app.post('/api/orders', async (req: Request, res: Response) => {
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const body = req.body as Partial<StoreOrder> & { adminAction?: boolean };
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

      const adminAuthed = isAdminRequest(req);
      const isAdminAction = adminAuthed && Boolean(body.adminAction);

      // Non-admins can NEVER directly create Approved/Completed/paymentVerified orders via /api/orders
      const requestedStatus: OrderStatus =
        body.status && VALID_STATUSES.has(body.status) ? body.status : 'Pending';
      const effectiveStatus: OrderStatus = isAdminAction
        ? requestedStatus
        : requestedStatus === 'Waiting'
        ? 'Waiting'
        : 'Pending';
      const effectivePaymentVerified = isAdminAction ? Boolean(body.paymentVerified) : false;

      if (!isAdminAction && (body.paymentVerified || requestedStatus === 'Approved' || requestedStatus === 'Completed')) {
        appendSecurityLog(store, {
          category: 'suspicious',
          eventType: 'CLIENT_BYPASS_ATTEMPT_BLOCKED',
          trxId: String(body.transactionId || ''),
          paymentMethod: String(body.paymentMethod || ''),
          submittedAmountBdt: Number(body.priceBdt) || 0,
          orderNumber: String(body.orderNumber),
          userEmail: String(body.userEmail),
          reason: 'Blocked attempt to create pre-approved/verified order directly from client API.',
          source: 'orders_api',
          ip: getClientIp(req),
          flagged: true,
        });
        writeStoreFile(store);
        res.status(403).json({ error: 'Payments cannot be approved from the client side.' });
        return;
      }

      const pkg = (store.packages || []).find((p) => p.id === String(body.packageId || ''));
      const authoritativeRobux = pkg ? pkg.robux : Number(body.robuxAmount) || 0;
      const authoritativePriceBdt = pkg ? pkg.priceBdt : Number(body.priceBdt) || 0;

      const liveAvailable = store.groupSettings.availableRobux ?? 25400;
      if (!isAdminAction && effectiveStatus !== 'Waiting' && (liveAvailable <= 0 || authoritativeRobux > liveAvailable)) {
        res.status(409).json({
          error:
            liveAvailable <= 0
              ? 'Robux is currently out of stock (0 available). Orders cannot be placed until restocked.'
              : `Only ${liveAvailable.toLocaleString()} Robux available in stock.`,
        });
        return;
      }

      const cleanTrx =
        typeof body.transactionId === 'string' ? body.transactionId.trim().toUpperCase() : undefined;
      if (cleanTrx && !isAdminAction) {
        const dup = findDuplicateTrxRecord(store, cleanTrx, String(body.orderNumber));
        if (dup) {
          appendSecurityLog(store, {
            category: 'duplicate',
            eventType: 'DUPLICATE_TRXID_BLOCKED',
            trxId: cleanTrx,
            paymentMethod: String(body.paymentMethod || ''),
            submittedAmountBdt: authoritativePriceBdt,
            orderNumber: String(body.orderNumber),
            userEmail: String(body.userEmail),
            reason: `Duplicate TrxID ${cleanTrx} blocked in /api/orders.`,
            source: 'orders_api',
            ip: getClientIp(req),
            flagged: true,
          });
          writeStoreFile(store);
          res.status(409).json({
            error: `Duplicate Transaction ID blocked: TrxID ${cleanTrx} has already been used (${dup.orderNumber}).`,
          });
          return;
        }
        store.usedTrxIds[cleanTrx] = {
          trxId: cleanTrx,
          method: normalizeMethodName(String(body.paymentMethod || 'Nagad')),
          orderId,
          orderNumber: String(body.orderNumber),
          userEmail: String(body.userEmail),
          amountBdt: authoritativePriceBdt,
          status: 'reserved_pending',
          usedAt: new Date().toISOString(),
        };
      }

      const nowIso = new Date().toISOString();
      const created: StoreOrder = {
        id: orderId,
        orderNumber: String(body.orderNumber),
        userEmail: String(body.userEmail),
        userName: String(body.userName || 'Customer'),
        userPhone: typeof body.userPhone === 'string' ? body.userPhone : '',
        robloxUsername: String(body.robloxUsername || 'Verified Member'),
        robloxUserId: typeof body.robloxUserId === 'number' ? body.robloxUserId : null,
        packageId: pkg ? pkg.id : String(body.packageId || ''),
        packageTitle: pkg ? pkg.title : String(body.packageTitle),
        robuxAmount: authoritativeRobux,
        priceBdt: authoritativePriceBdt,
        paymentMethod: String(body.paymentMethod || 'Nagad'),
        senderPhone: typeof body.senderPhone === 'string' ? body.senderPhone : undefined,
        transactionId: cleanTrx,
        paymentVerified: effectivePaymentVerified,
        status: effectiveStatus,
        verifiedAtMs: typeof body.verifiedAtMs === 'number' ? body.verifiedAtMs : undefined,
        unlockAtMs: typeof body.unlockAtMs === 'number' ? body.unlockAtMs : undefined,
        createdAt: String(body.createdAt || nowIso),
        confirmedAt:
          effectiveStatus === 'Approved' || effectiveStatus === 'Completed'
            ? typeof body.confirmedAt === 'string'
              ? body.confirmedAt
              : nowIso
            : undefined,
      };

      store.orders = [created, ...store.orders];
      writeStoreFile(store);
      res.status(201).json(created);
    });
  });

  app.patch('/api/orders/:id', async (req: Request, res: Response) => {
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const id = req.params.id;
      const body = req.body as Partial<StoreOrder> & { adminAction?: boolean };
      if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
        res.status(400).json({ error: 'Invalid order status' });
        return;
      }
      const found = store.orders.find((o) => o.id === id);
      if (!found) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const adminAuthed = isAdminRequest(req);
      const isAdminAction = adminAuthed && Boolean(body.adminAction);

      if (body.adminAction && !adminAuthed) {
        res.status(401).json({ error: 'Admin authentication required.' });
        return;
      }

      if (
        !isAdminAction &&
        (body.status === 'Approved' ||
          body.status === 'Completed' ||
          body.paymentVerified === true ||
          typeof body.unlockAtMs === 'number')
      ) {
        appendSecurityLog(store, {
          category: 'suspicious',
          eventType: 'CLIENT_STATUS_ESCALATION_BLOCKED',
          trxId: String(found.transactionId || body.transactionId || ''),
          paymentMethod: found.paymentMethod,
          submittedAmountBdt: found.priceBdt,
          orderNumber: found.orderNumber,
          userEmail: found.userEmail,
          reason: `Blocked unauthorized status/verification update attempt (${String(body.status)}).`,
          source: 'orders_api',
          ip: getClientIp(req),
          flagged: true,
        });
        writeStoreFile(store);
        res.status(403).json({
          error: 'Unauthorized: only server verification or Admin can approve orders or unlock timers.',
        });
        return;
      }

      const nextStatus = isAdminAction
        ? body.status ?? found.status
        : found.status === 'Waiting' && body.status === 'Cancelled'
        ? 'Cancelled'
        : found.status;

      const selectedPkg =
        typeof body.packageId === 'string' && body.packageId.trim()
          ? (store.packages || []).find((p) => p.id === body.packageId!.trim())
          : null;

      const nextRobux = isAdminAction
        ? typeof body.robuxAmount === 'number' && body.robuxAmount > 0
          ? body.robuxAmount
          : found.robuxAmount
        : selectedPkg
        ? selectedPkg.robux
        : found.robuxAmount;

      const nextPriceBdt = isAdminAction
        ? typeof body.priceBdt === 'number' && body.priceBdt > 0
          ? body.priceBdt
          : found.priceBdt
        : selectedPkg
        ? selectedPkg.priceBdt
        : found.priceBdt;

      const nowIso = new Date().toISOString();
      const isConfirmedState = nextStatus === 'Approved' || nextStatus === 'Completed';
      const updated: StoreOrder = {
        ...found,
        status: nextStatus,
        paymentMethod:
          isAdminAction && typeof body.paymentMethod === 'string' && body.paymentMethod.trim()
            ? body.paymentMethod.trim()
            : found.paymentMethod,
        transactionId:
          isAdminAction && typeof body.transactionId === 'string'
            ? body.transactionId.trim().toUpperCase()
            : found.transactionId,
        paymentVerified: isAdminAction
          ? typeof body.paymentVerified === 'boolean'
            ? body.paymentVerified
            : isConfirmedState
            ? true
            : found.paymentVerified
          : found.paymentVerified,
        paymentFlag: isConfirmedState ? undefined : found.paymentFlag,
        paymentFlagReason: isConfirmedState ? undefined : found.paymentFlagReason,
        packageId: selectedPkg
          ? selectedPkg.id
          : isAdminAction && typeof body.packageId === 'string' && body.packageId.trim()
          ? body.packageId.trim()
          : found.packageId,
        packageTitle: selectedPkg
          ? selectedPkg.title
          : isAdminAction && typeof body.packageTitle === 'string' && body.packageTitle.trim()
          ? body.packageTitle.trim()
          : found.packageTitle,
        robuxAmount: nextRobux,
        priceBdt: nextPriceBdt,
        userName:
          typeof body.userName === 'string' && body.userName.trim()
            ? body.userName.trim()
            : found.userName,
        userEmail:
          typeof body.userEmail === 'string' && body.userEmail.trim()
            ? body.userEmail.trim()
            : found.userEmail,
        userPhone: typeof body.userPhone === 'string' ? body.userPhone : found.userPhone,
        unlockAtMs:
          isAdminAction && typeof body.unlockAtMs === 'number'
            ? body.unlockAtMs
            : found.unlockAtMs,
        confirmedAt: isConfirmedState ? found.confirmedAt || nowIso : found.confirmedAt,
      };

      if (isAdminAction && updated.transactionId && isConfirmedState) {
        store.usedTrxIds[updated.transactionId] = {
          trxId: updated.transactionId,
          method: normalizeMethodName(updated.paymentMethod),
          orderId: updated.id,
          orderNumber: updated.orderNumber,
          userEmail: updated.userEmail,
          amountBdt: updated.priceBdt,
          status: 'verified_approved',
          usedAt: updated.confirmedAt || nowIso,
        };
      }

      store.orders = store.orders.map((o) => (o.id === id ? updated : o));
      writeStoreFile(store);
      res.json(updated);
    });
  });

  app.delete('/api/orders/:id', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const id = String(req.params.id);
    if (id && !store.deletedOrderIds.includes(id)) {
      store.deletedOrderIds = [id, ...store.deletedOrderIds].slice(0, 500);
    }
    store.orders = store.orders.filter((o) => o.id !== id);
    writeStoreFile(store);
    res.json({ ok: true, deletedOrderIds: store.deletedOrderIds });
  });

  // Payment Security Logs (Admin only)
  app.get('/api/payments/security-logs', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    store = ensureStoreFile();
    const logs = store.paymentSecurityLogs || [];
    res.json({
      logs,
      summary: {
        total: logs.length,
        successful: logs.filter((l) => l.category === 'successful').length,
        failed: logs.filter((l) => l.category === 'failed').length,
        duplicate: logs.filter((l) => l.category === 'duplicate').length,
        suspicious: logs.filter((l) => l.category === 'suspicious').length,
      },
    });
  });

  // Payment Ledger (Admin only)
  app.get('/api/payments/ledger', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    store = ensureStoreFile();
    res.json(store.verifiedPayments);
  });

  app.post('/api/payments/ledger', async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const body = req.body as {
        method?: string;
        trxId?: string;
        amountBdt?: number;
        senderPhone?: string;
      };
      const method = normalizeMethodName(body.method || 'Nagad');
      const check = validateMfsTrxId(method, body.trxId || '');
      const senderCheck = validateSenderPhone(body.senderPhone || '');
      const amountBdt = Number(body.amountBdt);
      if (!check.valid) {
        res.status(400).json({ error: check.error });
        return;
      }
      if (!senderCheck.valid) {
        res.status(400).json({ error: senderCheck.error });
        return;
      }
      if (!amountBdt || !Number.isFinite(amountBdt) || amountBdt <= 0) {
        res.status(400).json({ error: 'Amount (BDT) must be greater than 0.' });
        return;
      }

      const existing = store.verifiedPayments.find((p) => p.trxId === check.normalized);
      if (existing) {
        appendSecurityLog(store, {
          category: 'duplicate',
          eventType: 'ADMIN_LEDGER_DUPLICATE_TRXID',
          trxId: check.normalized,
          paymentMethod: method,
          submittedAmountBdt: amountBdt,
          matchedAmountBdt: existing.amountBdt,
          senderPhone: senderCheck.normalized || undefined,
          reason: `TrxID ${check.normalized} already exists in verified payment ledger.`,
          source: 'admin_manual',
          ip: getClientIp(req),
          flagged: true,
        });
        writeStoreFile(store);
        res
          .status(409)
          .json({ error: `TrxID ${check.normalized} is already in the payment inbox.` });
        return;
      }

      const entry: VerifiedMfsPayment = {
        id: `pay-${Date.now()}`,
        method,
        trxId: check.normalized,
        amountBdt,
        senderPhone: senderCheck.normalized || undefined,
        receiverPhone: OFFICIAL_MFS_NUMBER,
        source: 'admin_manual',
        receivedAt: new Date().toISOString(),
      };

      // Check matching Pending order
      const matchingOrder = store.orders.find(
        (o) =>
          o.status === 'Pending' &&
          (o.transactionId || '').trim().toUpperCase() === entry.trxId &&
          normalizeMethodName(o.paymentMethod) === entry.method
      );

      let autoApprovedOrder: string | null = null;
      if (matchingOrder) {
        if (entry.amountBdt !== matchingOrder.priceBdt) {
          const mismatchType =
            entry.amountBdt < matchingOrder.priceBdt
              ? 'UNDERPAYMENT_FLAGGED'
              : 'OVERPAYMENT_FLAGGED';
          const flagReason = `Amount mismatch on Order ${matchingOrder.orderNumber}: received ৳${entry.amountBdt} vs required ৳${matchingOrder.priceBdt} BDT.`;
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? {
                  ...o,
                  paymentFlag:
                    entry.amountBdt < matchingOrder.priceBdt
                      ? 'underpayment_mismatch'
                      : 'overpayment_mismatch',
                  paymentFlagReason: flagReason,
                }
              : o
          );
          store.usedTrxIds[entry.trxId] = {
            trxId: entry.trxId,
            method: entry.method,
            orderId: matchingOrder.id,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            amountBdt: entry.amountBdt,
            status: 'flagged_mismatch',
            usedAt: entry.receivedAt,
          };
          appendSecurityLog(store, {
            category: 'suspicious',
            eventType: mismatchType,
            trxId: entry.trxId,
            paymentMethod: entry.method,
            submittedAmountBdt: matchingOrder.priceBdt,
            matchedAmountBdt: entry.amountBdt,
            senderPhone: entry.senderPhone,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            reason: flagReason,
            source: 'admin_manual',
            ip: getClientIp(req),
            flagged: true,
          });
        } else {
          entry.usedByOrderId = matchingOrder.orderNumber;
          autoApprovedOrder = matchingOrder.orderNumber;
          const confirmedAt = matchingOrder.confirmedAt || new Date().toISOString();
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? {
                  ...o,
                  status: 'Approved',
                  paymentVerified: true,
                  paymentFlag: undefined,
                  paymentFlagReason: undefined,
                  confirmedAt,
                }
              : o
          );
          store.usedTrxIds[entry.trxId] = {
            trxId: entry.trxId,
            method: entry.method,
            orderId: matchingOrder.id,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            amountBdt: entry.amountBdt,
            status: 'verified_approved',
            usedAt: confirmedAt,
          };
          appendSecurityLog(store, {
            category: 'successful',
            eventType: 'ADMIN_LEDGER_AUTO_APPROVED',
            trxId: entry.trxId,
            paymentMethod: entry.method,
            submittedAmountBdt: matchingOrder.priceBdt,
            matchedAmountBdt: entry.amountBdt,
            senderPhone: entry.senderPhone,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            reason: `Admin logged ৳${entry.amountBdt} BDT matching Order ${matchingOrder.orderNumber}.`,
            source: 'admin_manual',
            ip: getClientIp(req),
            flagged: false,
          });
        }
      } else {
        appendSecurityLog(store, {
          category: 'successful',
          eventType: 'ADMIN_LEDGER_RECORDED',
          trxId: entry.trxId,
          paymentMethod: entry.method,
          matchedAmountBdt: entry.amountBdt,
          senderPhone: entry.senderPhone,
          reason: `Admin added verified ${entry.method} payment (৳${entry.amountBdt} BDT) awaiting customer claim.`,
          source: 'admin_manual',
          ip: getClientIp(req),
          flagged: false,
        });
      }

      store.verifiedPayments = [entry, ...store.verifiedPayments];
      writeStoreFile(store);
      res.status(201).json({ entry, autoApprovedOrder });
    });
  });

  app.delete('/api/payments/ledger/:id', (req: Request, res: Response) => {
    if (!isAdminRequest(req)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    const id = req.params.id;
    store.verifiedPayments = store.verifiedPayments.filter((p) => p.id !== id);
    writeStoreFile(store);
    res.json({ ok: true });
  });

  // Secure Webhook endpoint for Android SMS Forwarder apps running on 01764088123
  app.post('/api/payments/webhook', async (req: Request, res: Response) => {
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const rawBody =
        typeof (req as RawBodyRequest).rawBody === 'string'
          ? (req as RawBodyRequest).rawBody!
          : JSON.stringify(req.body || {});
      const clientIp = getClientIp(req);

      const authCheck = verifyWebhookRequest(req, rawBody, store);
      if (!authCheck.ok) {
        appendSecurityLog(store, {
          category: authCheck.category || 'suspicious',
          eventType: authCheck.eventType || 'WEBHOOK_UNAUTHORIZED',
          reason: authCheck.error || 'Unauthorized webhook call.',
          source: 'sms_webhook',
          ip: clientIp,
          flagged: true,
        });
        writeStoreFile(store);
        res.status(authCheck.status || 401).json({ error: authCheck.error });
        return;
      }

      const body = req.body as {
        message?: string;
        text?: string;
        body?: string;
        sender?: string;
        from?: string;
        method?: string;
        trxId?: string;
        amountBdt?: number;
        senderPhone?: string;
        receiverPhone?: string;
      };

      const rawText = String(body.message || body.text || body.body || '').trim();
      const senderHint = String(body.sender || body.from || body.method || '');

      let parsed: {
        method: 'Nagad' | 'Rocket' | 'bKash';
        trxId: string;
        amountBdt: number;
        senderPhone?: string;
        receiverPhone?: string;
      } | null = null;

      if (rawText) {
        const strictParsed = parseMfsSmsStrict(rawText, senderHint);
        if (!strictParsed.ok) {
          appendSecurityLog(store, {
            category: strictParsed.suspicious ? 'suspicious' : 'failed',
            eventType: 'WEBHOOK_FAKE_OR_INVALID_SMS',
            trxId: strictParsed.trxId || '',
            paymentMethod: strictParsed.method || normalizeMethodName(senderHint || 'Nagad'),
            matchedAmountBdt: strictParsed.amountBdt,
            senderPhone: strictParsed.senderPhone,
            receiverPhone: strictParsed.receiverPhone || OFFICIAL_MFS_NUMBER,
            reason: strictParsed.error || 'Rejected invalid SMS format.',
            source: 'sms_webhook',
            ip: clientIp,
            flagged: Boolean(strictParsed.suspicious),
          });
          writeStoreFile(store);
          res.status(400).json({ error: strictParsed.error });
          return;
        }
        parsed = {
          method: strictParsed.method!,
          trxId: strictParsed.trxId!,
          amountBdt: strictParsed.amountBdt!,
          senderPhone: strictParsed.senderPhone,
          receiverPhone: strictParsed.receiverPhone || OFFICIAL_MFS_NUMBER,
        };
      } else if (body.trxId && body.amountBdt) {
        const payMethod = normalizeMethodName(body.method || senderHint || 'Nagad');
        const trxCheck = validateMfsTrxId(payMethod, body.trxId);
        const amt = Number(body.amountBdt);
        const rcv = body.receiverPhone ? normalizePhoneNumber(body.receiverPhone) : OFFICIAL_MFS_NUMBER;
        if (!trxCheck.valid || !Number.isFinite(amt) || amt <= 0 || amt > 500000) {
          appendSecurityLog(store, {
            category: 'suspicious',
            eventType: 'WEBHOOK_INVALID_STRUCTURED_PAYLOAD',
            trxId: String(body.trxId || ''),
            paymentMethod: payMethod,
            matchedAmountBdt: amt || undefined,
            reason: trxCheck.error || 'Invalid structured webhook amount or TrxID.',
            source: 'sms_webhook',
            ip: clientIp,
            flagged: true,
          });
          writeStoreFile(store);
          res.status(400).json({ error: trxCheck.error || 'Invalid structured webhook payload.' });
          return;
        }
        if (rcv && rcv !== normalizePhoneNumber(OFFICIAL_MFS_NUMBER)) {
          appendSecurityLog(store, {
            category: 'suspicious',
            eventType: 'WEBHOOK_RECEIVER_MISMATCH',
            trxId: trxCheck.normalized,
            paymentMethod: payMethod,
            matchedAmountBdt: amt,
            receiverPhone: rcv,
            reason: `Receiver ${rcv} does not match official ${OFFICIAL_MFS_NUMBER}.`,
            source: 'sms_webhook',
            ip: clientIp,
            flagged: true,
          });
          writeStoreFile(store);
          res.status(400).json({ error: 'Receiver wallet mismatch.' });
          return;
        }
        parsed = {
          method: payMethod,
          trxId: trxCheck.normalized,
          amountBdt: amt,
          senderPhone: normalizePhoneNumber(body.senderPhone || '') || undefined,
          receiverPhone: OFFICIAL_MFS_NUMBER,
        };
      }

      if (!parsed) {
        appendSecurityLog(store, {
          category: 'failed',
          eventType: 'WEBHOOK_EMPTY_PAYLOAD',
          reason: 'Could not extract TrxID and BDT amount from authenticated webhook payload.',
          source: 'sms_webhook',
          ip: clientIp,
        });
        writeStoreFile(store);
        res
          .status(400)
          .json({ error: 'Could not extract TrxID and BDT amount from SMS payload.' });
        return;
      }

      const existing = store.verifiedPayments.find((p) => p.trxId === parsed!.trxId);
      if (existing) {
        appendSecurityLog(store, {
          category: 'duplicate',
          eventType: 'WEBHOOK_DUPLICATE_TRXID',
          trxId: parsed.trxId,
          paymentMethod: parsed.method,
          matchedAmountBdt: parsed.amountBdt,
          senderPhone: parsed.senderPhone,
          reason: `Duplicate SMS webhook ignored: TrxID ${parsed.trxId} already logged.`,
          source: 'sms_webhook',
          ip: clientIp,
          flagged: true,
        });
        writeStoreFile(store);
        res.status(409).json({ ok: false, duplicate: true, error: `Duplicate TrxID ${parsed.trxId}.`, entry: existing });
        return;
      }

      const entry: VerifiedMfsPayment = {
        id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        method: parsed.method,
        trxId: parsed.trxId,
        amountBdt: parsed.amountBdt,
        senderPhone: parsed.senderPhone,
        receiverPhone: parsed.receiverPhone || OFFICIAL_MFS_NUMBER,
        source: 'sms_webhook',
        receivedAt: new Date().toISOString(),
      };

      const matchingOrder = store.orders.find(
        (o) =>
          o.status === 'Pending' &&
          (o.transactionId || '').trim().toUpperCase() === entry.trxId &&
          normalizeMethodName(o.paymentMethod) === entry.method
      );

      let autoApprovedOrder: string | null = null;
      let flagged = false;
      if (matchingOrder) {
        const senderConflict =
          Boolean(matchingOrder.senderPhone && entry.senderPhone) &&
          normalizePhoneNumber(matchingOrder.senderPhone || '') !==
            normalizePhoneNumber(entry.senderPhone || '');

        if (senderConflict) {
          flagged = true;
          const flagReason = `Sender phone mismatch on Order ${matchingOrder.orderNumber}: SMS from ${entry.senderPhone} vs customer ${matchingOrder.senderPhone}.`;
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? { ...o, paymentFlag: 'sender_mismatch', paymentFlagReason: flagReason }
              : o
          );
          appendSecurityLog(store, {
            category: 'suspicious',
            eventType: 'WEBHOOK_SENDER_MISMATCH',
            trxId: entry.trxId,
            paymentMethod: entry.method,
            submittedAmountBdt: matchingOrder.priceBdt,
            matchedAmountBdt: entry.amountBdt,
            senderPhone: `${matchingOrder.senderPhone} vs ${entry.senderPhone}`,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            reason: flagReason,
            source: 'sms_webhook',
            ip: clientIp,
            flagged: true,
          });
        } else if (entry.amountBdt !== matchingOrder.priceBdt) {
          flagged = true;
          const isUnder = entry.amountBdt < matchingOrder.priceBdt;
          const flagReason = `Amount mismatch (${isUnder ? 'underpayment' : 'overpayment'}) on Order ${matchingOrder.orderNumber}: SMS ৳${entry.amountBdt} vs expected ৳${matchingOrder.priceBdt} BDT.`;
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? {
                  ...o,
                  paymentFlag: isUnder ? 'underpayment_mismatch' : 'overpayment_mismatch',
                  paymentFlagReason: flagReason,
                }
              : o
          );
          store.usedTrxIds[entry.trxId] = {
            trxId: entry.trxId,
            method: entry.method,
            orderId: matchingOrder.id,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            amountBdt: entry.amountBdt,
            status: 'flagged_mismatch',
            usedAt: entry.receivedAt,
          };
          appendSecurityLog(store, {
            category: 'suspicious',
            eventType: isUnder ? 'UNDERPAYMENT_FLAGGED' : 'OVERPAYMENT_FLAGGED',
            trxId: entry.trxId,
            paymentMethod: entry.method,
            submittedAmountBdt: matchingOrder.priceBdt,
            matchedAmountBdt: entry.amountBdt,
            senderPhone: entry.senderPhone,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            reason: flagReason,
            source: 'sms_webhook',
            ip: clientIp,
            flagged: true,
          });
        } else {
          entry.usedByOrderId = matchingOrder.orderNumber;
          autoApprovedOrder = matchingOrder.orderNumber;
          const confirmedAt = matchingOrder.confirmedAt || new Date().toISOString();
          store.orders = store.orders.map((o) =>
            o.id === matchingOrder.id
              ? {
                  ...o,
                  status: 'Approved',
                  paymentVerified: true,
                  paymentFlag: undefined,
                  paymentFlagReason: undefined,
                  confirmedAt,
                }
              : o
          );
          store.usedTrxIds[entry.trxId] = {
            trxId: entry.trxId,
            method: entry.method,
            orderId: matchingOrder.id,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            amountBdt: entry.amountBdt,
            status: 'verified_approved',
            usedAt: confirmedAt,
          };
          appendSecurityLog(store, {
            category: 'successful',
            eventType: 'WEBHOOK_AUTO_APPROVED',
            trxId: entry.trxId,
            paymentMethod: entry.method,
            submittedAmountBdt: matchingOrder.priceBdt,
            matchedAmountBdt: entry.amountBdt,
            senderPhone: entry.senderPhone,
            orderNumber: matchingOrder.orderNumber,
            userEmail: matchingOrder.userEmail,
            reason: `Authenticated SMS webhook verified ৳${entry.amountBdt} BDT and approved Order ${matchingOrder.orderNumber}.`,
            source: 'sms_webhook',
            ip: clientIp,
            flagged: false,
          });
        }
      } else {
        appendSecurityLog(store, {
          category: 'successful',
          eventType: 'WEBHOOK_SMS_RECORDED',
          trxId: entry.trxId,
          paymentMethod: entry.method,
          matchedAmountBdt: entry.amountBdt,
          senderPhone: entry.senderPhone,
          reason: `Authenticated SMS received on ${OFFICIAL_MFS_NUMBER}: ${entry.method} ৳${entry.amountBdt} BDT (${entry.trxId}).`,
          source: 'sms_webhook',
          ip: clientIp,
          flagged: false,
        });
      }

      store.verifiedPayments = [entry, ...store.verifiedPayments];
      writeStoreFile(store);
      res.status(201).json({ ok: true, entry, autoApprovedOrder, flagged });
    });
  });

  // Atomic Customer Payment Verification & Order Submission (single transaction inside mutex lock)
  app.post('/api/payments/submit-order', async (req: Request, res: Response) => {
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const clientIp = getClientIp(req);
      const body = req.body as {
        method?: string;
        trxId?: string;
        senderPhone?: string;
        packageId?: string;
        expectedAmountBdt?: number;
        userEmail?: string;
        userName?: string;
        userPhone?: string;
        robloxUsername?: string;
        robloxUserId?: number | null;
        existingWaitingOrderId?: string;
        orderNumber?: string;
        verifiedAtMs?: number;
        unlockAtMs?: number;
      };

      const userEmail = String(body.userEmail || '').trim().toLowerCase();
      if (!userEmail || !body.packageId) {
        res.status(400).json({ error: 'Missing required customer email or package selection.' });
        return;
      }

      const pkg = (store.packages || []).find((p) => p.id === String(body.packageId));
      if (!pkg) {
        res.status(400).json({ error: 'Selected Robux package does not exist.' });
        return;
      }

      const adminAuthed = isAdminRequest(req);
      const liveAvailable = store.groupSettings.availableRobux ?? 25400;
      if (!adminAuthed && (liveAvailable <= 0 || pkg.robux > liveAvailable)) {
        res.status(409).json({
          error:
            liveAvailable <= 0
              ? 'Robux is currently out of stock (0 available). Orders cannot be placed until restocked.'
              : `Only ${liveAvailable.toLocaleString()} Robux available in stock.`,
        });
        return;
      }

      const existingWaiting = body.existingWaitingOrderId
        ? store.orders.find(
            (o) =>
              o.id === body.existingWaitingOrderId &&
              o.status === 'Waiting' &&
              o.userEmail.toLowerCase() === userEmail
          )
        : undefined;

      const orderNumber = existingWaiting
        ? existingWaiting.orderNumber
        : String(body.orderNumber || `BM-${Math.floor(1000 + Math.random() * 9000)}`)
            .toUpperCase()
            .replace(/[^A-Z0-9\-]/g, '')
            .slice(0, 32) || `BM-${Math.floor(1000 + Math.random() * 9000)}`;

      const check = verifyAndProcessCustomerPayment(
        store,
        {
          method: body.method || 'Nagad',
          trxId: body.trxId || '',
          senderPhone: body.senderPhone || '',
          packageId: pkg.id,
          expectedAmountBdt: pkg.priceBdt,
          orderNumber,
          userEmail,
        },
        clientIp
      );

      if (!check.ok) {
        writeStoreFile(store);
        res.status(check.status).json({
          valid: false,
          verified: false,
          duplicate: Boolean(check.duplicate),
          flagged: Boolean(check.flagged),
          error: check.error,
        });
        return;
      }

      const normalizedTrxId = check.normalizedTrxId!;
      const nowIso = new Date().toISOString();
      const normalizedMethod = normalizeMethodName(body.method || 'Nagad');
      const senderNorm = normalizePhoneNumber(body.senderPhone || '');

      if (check.verified && check.matchedPayment) {
        store.verifiedPayments = store.verifiedPayments.map((p) =>
          p.id === check.matchedPayment!.id ? { ...p, usedByOrderId: orderNumber } : p
        );
      }

      const orderId = existingWaiting ? existingWaiting.id : `ord-${Date.now()}`;
      store.usedTrxIds[normalizedTrxId] = {
        trxId: normalizedTrxId,
        method: normalizedMethod,
        orderId,
        orderNumber,
        userEmail,
        amountBdt: pkg.priceBdt,
        status: check.flagged
          ? 'flagged_mismatch'
          : check.verified
          ? 'verified_approved'
          : 'reserved_pending',
        usedAt: nowIso,
      };

      let savedOrder: StoreOrder;
      if (existingWaiting) {
        savedOrder = {
          ...existingWaiting,
          packageId: pkg.id,
          packageTitle: pkg.title,
          robuxAmount: pkg.robux,
          priceBdt: pkg.priceBdt,
          paymentMethod: normalizedMethod,
          senderPhone: senderNorm || existingWaiting.senderPhone,
          transactionId: normalizedTrxId,
          paymentVerified: Boolean(check.verified),
          paymentFlag: check.flagged ? check.flagReason : undefined,
          paymentFlagReason: check.flagged ? check.flagMessage : undefined,
          status: check.orderStatus || 'Pending',
          confirmedAt: check.verified ? existingWaiting.confirmedAt || nowIso : existingWaiting.confirmedAt,
        };
        store.orders = store.orders.map((o) => (o.id === existingWaiting.id ? savedOrder : o));
      } else {
        savedOrder = {
          id: orderId,
          orderNumber,
          userEmail,
          userName: String(body.userName || 'Customer').trim().slice(0, 120),
          userPhone: String(body.userPhone || '').trim().slice(0, 40),
          robloxUsername: String(body.robloxUsername || 'Verified Member').trim().slice(0, 40),
          robloxUserId: typeof body.robloxUserId === 'number' ? body.robloxUserId : null,
          packageId: pkg.id,
          packageTitle: pkg.title,
          robuxAmount: pkg.robux,
          priceBdt: pkg.priceBdt,
          paymentMethod: normalizedMethod,
          senderPhone: senderNorm || undefined,
          transactionId: normalizedTrxId,
          paymentVerified: Boolean(check.verified),
          paymentFlag: check.flagged ? check.flagReason : undefined,
          paymentFlagReason: check.flagged ? check.flagMessage : undefined,
          status: check.orderStatus || 'Pending',
          verifiedAtMs: typeof body.verifiedAtMs === 'number' ? body.verifiedAtMs : undefined,
          unlockAtMs: typeof body.unlockAtMs === 'number' ? body.unlockAtMs : undefined,
          createdAt: nowIso,
          confirmedAt: check.verified ? nowIso : undefined,
        };
        store.orders = [savedOrder, ...store.orders];
      }

      writeStoreFile(store);
      res.status(existingWaiting ? 200 : 201).json({
        ok: true,
        valid: true,
        verified: Boolean(check.verified),
        flagged: Boolean(check.flagged),
        flagMessage: check.flagMessage,
        normalizedTrxId,
        status: savedOrder.status,
        order: savedOrder,
      });
    });
  });

  // Legacy-compatible verification check endpoint (locked & backed by unique TrxID registry + security logs)
  app.post('/api/payments/verify', async (req: Request, res: Response) => {
    await withPaymentLock(async () => {
      store = ensureStoreFile();
      const body = req.body as {
        method?: string;
        trxId?: string;
        senderPhone?: string;
        packageId?: string;
        expectedAmountBdt?: number;
        orderNumber?: string;
        userEmail?: string;
      };
      const result = verifyAndProcessCustomerPayment(store, body, getClientIp(req));
      if (!result.ok) {
        writeStoreFile(store);
        res.status(result.status).json({
          valid: false,
          verified: false,
          duplicate: Boolean(result.duplicate),
          flagged: Boolean(result.flagged),
          error: result.error,
        });
        return;
      }

      if (result.verified && result.matchedPayment && body.orderNumber) {
        store.verifiedPayments = store.verifiedPayments.map((p) =>
          p.id === result.matchedPayment!.id ? { ...p, usedByOrderId: body.orderNumber } : p
        );
      }
      writeStoreFile(store);
      res.json({
        valid: true,
        verified: Boolean(result.verified),
        flagged: Boolean(result.flagged),
        flagMessage: result.flagMessage,
        normalizedTrxId: result.normalizedTrxId,
        status: result.orderStatus || 'Pending',
      });
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
    const existingByEmail = store.users.find((u) => u.email.toLowerCase() === cleanEmail);
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
        store.users = store.users.map((u) => (u.id === existingByEmail.id ? merged : u));
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
        typeof body.name === 'string' && body.name.trim() ? body.name.trim() : found.name,
      email: nextEmail,
      phone:
        typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : found.phone,
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
        incomingTimersMap !== undefined ? incomingTimersMap : found.verifiedRobloxTimers,
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
      const joined = list.some((item) => Number(item?.group?.id) === targetGroupId);

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
