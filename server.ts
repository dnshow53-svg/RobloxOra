import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

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
  emailStatus?: 'sent' | 'not_configured' | 'failed';
  emailSentAt?: string;
  emailError?: string;
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

interface StoreUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  avatar?: string;
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
                emailStatus:
                  o.emailStatus === 'sent' ||
                  o.emailStatus === 'not_configured' ||
                  o.emailStatus === 'failed'
                    ? o.emailStatus
                    : undefined,
                emailSentAt: typeof o.emailSentAt === 'string' ? o.emailSentAt : undefined,
                emailError: typeof o.emailError === 'string' ? o.emailError : undefined,
              };
            })
        : [],
      users: Array.isArray(parsed.users)
        ? parsed.users.map((u) => ({
            ...u,
            avatar: typeof u.avatar === 'string' ? u.avatar : '',
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

interface EmailDeliveryResult {
  sent: boolean;
  status: 'sent' | 'not_configured' | 'failed';
  recipient: string;
  sentAt?: string;
  error?: string;
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeSingleLineHeader(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

function isValidEmailRecipient(raw: string): boolean {
  const clean = sanitizeSingleLineHeader(raw);
  return clean.length >= 3 && clean.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
}

async function sendOrderConfirmationEmail(
  order: StoreOrder,
  status: 'Approved' | 'Completed'
): Promise<EmailDeliveryResult> {
  const recipient = sanitizeSingleLineHeader(String(order.userEmail || '').toLowerCase());
  if (!isValidEmailRecipient(recipient)) {
    return {
      sent: false,
      status: 'failed',
      recipient,
      error: 'Customer account does not have a valid email address.',
    };
  }

  const isCompleted = status === 'Completed';
  const safeOrderNo = sanitizeSingleLineHeader(order.orderNumber || 'BM-0000');
  const subject = `[RobuxOra] Order ${safeOrderNo} Confirmed — ${
    isCompleted ? 'Robux Delivered' : 'Approved for Payout'
  }`;

  const rawAppUrl = String(process.env.APP_URL || '').trim();
  const safeAppUrl =
    /^https?:\/\//i.test(rawAppUrl) && rawAppUrl !== 'MY_APP_URL'
      ? rawAppUrl.replace(/\/+$/, '')
      : '';

  const confirmedTimestamp = order.confirmedAt || new Date().toISOString();
  const statusHeadline = isCompleted
    ? 'Your Robux Order is Completed & Delivered!'
    : 'Your Order Has Been Confirmed by Admin!';
  const statusSubtext = isCompleted
    ? `Your ${order.packageTitle} payout has been completed for Roblox account "${order.robloxUsername}".`
    : `Great news! Our admin team has confirmed your order (${safeOrderNo}). Your ${order.packageTitle} payout is queued and will be transferred to "${order.robloxUsername}".`;

  const html = `
  <div style="background:#090B0E;color:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px 16px;">
    <div style="max-width:560px;margin:0 auto;background:#131820;border:1px solid #27272A;border-radius:14px;overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid #27272A;background:#0D1117;">
        <span style="display:inline-block;font-size:12px;font-weight:700;color:#FBBF24;letter-spacing:0.06em;text-transform:uppercase;">RobuxOra Order Bot</span>
        <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;color:#FFFFFF;">${escapeHtml(statusHeadline)}</h1>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.6;color:#D4D4D8;">
        <p style="margin:0 0 14px;">Hello <strong style="color:#FFFFFF;">${escapeHtml(order.userName || 'Customer')}</strong>,</p>
        <p style="margin:0 0 18px;">${escapeHtml(statusSubtext)}</p>
        <div style="background:#090B0E;border:1px solid #27272A;border-radius:10px;padding:16px;margin-bottom:18px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:5px 0;color:#A1A1AA;">Order Number</td><td style="padding:5px 0;text-align:right;font-family:monospace;font-weight:700;color:#FBBF24;">${escapeHtml(safeOrderNo)}</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Status</td><td style="padding:5px 0;text-align:right;font-weight:700;color:#34D399;">${isCompleted ? 'Completed (Delivered)' : 'Confirmed (Approved)'}</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Package</td><td style="padding:5px 0;text-align:right;color:#FFFFFF;font-weight:600;">${escapeHtml(order.packageTitle)}</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Amount</td><td style="padding:5px 0;text-align:right;font-family:monospace;color:#FFFFFF;">৳${escapeHtml(order.priceBdt)} BDT</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Roblox Account</td><td style="padding:5px 0;text-align:right;font-family:monospace;color:#FFFFFF;">${escapeHtml(order.robloxUsername || 'Verified Member')}</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Payment</td><td style="padding:5px 0;text-align:right;color:#FFFFFF;">${escapeHtml(order.paymentMethod)}${order.transactionId ? ` (TrxID: ${escapeHtml(order.transactionId)})` : ''}</td></tr>
            <tr><td style="padding:5px 0;color:#A1A1AA;">Confirmed At</td><td style="padding:5px 0;text-align:right;color:#A1A1AA;">${escapeHtml(new Date(confirmedTimestamp).toUTCString())}</td></tr>
          </table>
        </div>
        ${
          safeAppUrl
            ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(safeAppUrl)}/#my-orders" style="display:inline-block;background:#FBBF24;color:#090B0E;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;">View Order Status</a></p>`
            : ''
        }
        <p style="margin:0;font-size:12px;color:#71717A;">You received this automated confirmation because your account signed in with ${escapeHtml(recipient)} on RobuxOra.</p>
      </div>
    </div>
  </div>`;

  const text = [
    `Hello ${order.userName || 'Customer'},`,
    '',
    statusSubtext,
    '',
    `Order Number: ${safeOrderNo}`,
    `Status: ${isCompleted ? 'Completed (Delivered)' : 'Confirmed (Approved)'}`,
    `Package: ${order.packageTitle}`,
    `Amount: ৳${order.priceBdt} BDT`,
    `Roblox Username: ${order.robloxUsername || 'Verified Member'}`,
    `Payment: ${order.paymentMethod}${order.transactionId ? ` (TrxID: ${order.transactionId})` : ''}`,
    `Confirmed At: ${confirmedTimestamp}`,
    safeAppUrl ? `View Order Status: ${safeAppUrl}/#my-orders` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const rawSmtpPass = String(process.env.SMTP_PASS || '').trim();
  const smtpFromRaw = String(process.env.SMTP_FROM || '').trim();

  if (resendKey) {
    try {
      const fromHeader = smtpFromRaw || (smtpUser ? `RobuxOra <${smtpUser}>` : 'RobuxOra <onboarding@resend.dev>');
      const apiRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromHeader,
          to: [recipient],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!apiRes.ok) {
        const errBody = await apiRes.text().catch(() => '');
        return {
          sent: false,
          status: 'failed',
          recipient,
          error: `Email service returned HTTP ${apiRes.status}${errBody ? `: ${errBody.slice(0, 140)}` : ''}`,
        };
      }
      return {
        sent: true,
        status: 'sent',
        recipient,
        sentAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        sent: false,
        status: 'failed',
        recipient,
        error: err instanceof Error ? err.message : 'Unable to send email via Resend API.',
      };
    }
  }

  if (smtpUser && rawSmtpPass) {
    try {
      const isGmail =
        smtpUser.toLowerCase().endsWith('@gmail.com') ||
        smtpUser.toLowerCase().endsWith('@googlemail.com');
      const smtpHost = String(process.env.SMTP_HOST || '').trim() || (isGmail ? 'smtp.gmail.com' : '');
      if (!smtpHost) {
        return {
          sent: false,
          status: 'not_configured',
          recipient,
          error: 'SMTP_HOST is required when using a non-Gmail SMTP_USER.',
        };
      }
      const smtpPort = Number(process.env.SMTP_PORT) || (smtpHost === 'smtp.gmail.com' ? 465 : 587);
      const smtpPass = smtpHost === 'smtp.gmail.com' ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      const fromHeader = smtpFromRaw || `RobuxOra <${smtpUser}>`;
      await transporter.sendMail({
        from: fromHeader,
        to: recipient,
        subject,
        text,
        html,
      });
      return {
        sent: true,
        status: 'sent',
        recipient,
        sentAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        sent: false,
        status: 'failed',
        recipient,
        error: err instanceof Error ? err.message : 'SMTP delivery failed.',
      };
    }
  }

  return {
    sent: false,
    status: 'not_configured',
    recipient,
    error: 'Set SMTP_USER & SMTP_PASS (or RESEND_API_KEY) in Secrets to enable automated email sending.',
  };
}

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
    let created: StoreOrder = {
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

    let emailDelivery: EmailDeliveryResult | undefined;
    if (status === 'Approved' || status === 'Completed') {
      emailDelivery = await sendOrderConfirmationEmail(created, status);
      created = {
        ...created,
        emailStatus: emailDelivery.status,
        emailSentAt: emailDelivery.sentAt,
        emailError: emailDelivery.error,
      };
    }

    store.orders = [created, ...store.orders];
    writeStoreFile(store);
    res.status(201).json(emailDelivery ? { ...created, emailDelivery } : created);
  });

  app.patch('/api/orders/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = req.body as Partial<StoreOrder> & {
      adminAction?: boolean;
      resendConfirmationEmail?: boolean;
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
    const shouldResend = Boolean(body.resendConfirmationEmail);
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
    let updated: StoreOrder = {
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

    const statusChangedToConfirmed =
      isConfirmedState && found.status !== nextStatus;
    let emailDelivery: EmailDeliveryResult | undefined;
    if (statusChangedToConfirmed || (isConfirmedState && shouldResend)) {
      emailDelivery = await sendOrderConfirmationEmail(updated, nextStatus);
      updated = {
        ...updated,
        emailStatus: emailDelivery.status,
        emailSentAt: emailDelivery.sentAt || updated.emailSentAt,
        emailError: emailDelivery.error,
      };
    }

    store.orders = store.orders.map((o) => (o.id === id ? updated : o));
    writeStoreFile(store);
    res.json(emailDelivery ? { ...updated, emailDelivery } : updated);
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

  app.post('/api/payments/ledger', async (req: Request, res: Response) => {
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
      const approvedOrder: StoreOrder = {
        ...matchingOrder,
        status: 'Approved',
        paymentVerified: true,
        confirmedAt,
      };
      const emailDelivery = await sendOrderConfirmationEmail(approvedOrder, 'Approved');
      const finalApprovedOrder: StoreOrder = {
        ...approvedOrder,
        emailStatus: emailDelivery.status,
        emailSentAt: emailDelivery.sentAt,
        emailError: emailDelivery.error,
      };
      store.orders = store.orders.map((o) =>
        o.id === matchingOrder.id ? finalApprovedOrder : o
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
  app.post('/api/payments/webhook', async (req: Request, res: Response) => {
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
      const approvedOrder: StoreOrder = {
        ...matchingOrder,
        status: 'Approved',
        paymentVerified: true,
        confirmedAt,
      };
      const emailDelivery = await sendOrderConfirmationEmail(approvedOrder, 'Approved');
      const finalApprovedOrder: StoreOrder = {
        ...approvedOrder,
        emailStatus: emailDelivery.status,
        emailSentAt: emailDelivery.sentAt,
        emailError: emailDelivery.error,
      };
      store.orders = store.orders.map((o) =>
        o.id === matchingOrder.id ? finalApprovedOrder : o
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
    const cleanAvatar =
      typeof body.avatar === 'string' ? body.avatar.trim() : '';
    const incomingTs =
      typeof body.updatedAtMs === 'number' && Number.isFinite(body.updatedAtMs)
        ? body.updatedAtMs
        : Date.now();
    const existingByEmail = store.users.find(
      (u) => u.email.toLowerCase() === cleanEmail
    );
    if (existingByEmail) {
      if (incomingTs > (existingByEmail.updatedAtMs || 0) && cleanAvatar) {
        const merged: StoreUser = {
          ...existingByEmail,
          avatar: cleanAvatar,
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
          avatar: typeof body.avatar === 'string' ? body.avatar.trim() : '',
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
          ? body.avatar.trim()
          : found.avatar || '',
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
      const list = Array.isArray(groupsJson?.data) ? groupsJson.data : [];
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
