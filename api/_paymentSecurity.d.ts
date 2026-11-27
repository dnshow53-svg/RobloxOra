export const ADMIN_EMAIL: string;
export const ADMIN_PASSWORD_SALT: string;
export const ADMIN_PASSWORD_HASH: string;
export const OFFICIAL_MFS_NUMBER: string;
export const FIREBASE_PROJECT_ID: string;
export const VALID_STATUSES: Set<string>;
export const WEBHOOK_MAX_SKEW_MS: number;
export const NONCE_TTL_MS: number;

export function withPaymentLock<T>(fn: () => Promise<T> | T): Promise<T>;
export function verifyAdminPassword(candidate: string): boolean;
export function createAdminToken(email?: string): string;
export function verifyAdminTokenString(token: string): Record<string, unknown> | null;
export function extractBearerToken(req: unknown): string;
export function isAdminRequest(req: unknown): boolean;
export function verifyFirebaseAdminIdToken(idToken: string): Promise<Record<string, unknown> | null>;
export function normalizeMethodName(method: string): 'Nagad' | 'Rocket' | 'bKash';
export function normalizePhoneNumber(rawPhone: string): string;
export function validateSenderPhone(rawPhone: string): { valid: boolean; normalized: string; error?: string };
export function validateMfsTrxId(
  method: string,
  rawTrxId: string
): { valid: boolean; normalized: string; error?: string };
export function parseMfsSmsStrict(
  rawText: string,
  senderHint?: string
): {
  ok: boolean;
  suspicious?: boolean;
  error?: string;
  method?: 'Nagad' | 'Rocket' | 'bKash';
  trxId?: string;
  amountBdt?: number;
  senderPhone?: string;
  receiverPhone?: string;
};
export function getClientIp(req: unknown): string;
export function appendSecurityLog(store: Record<string, any>, logInput: Record<string, any>): Record<string, any>;
export function pruneWebhookNonces(store: Record<string, any>, nowMs?: number): void;
export function verifyWebhookRequest(
  req: unknown,
  rawBody: string,
  store: Record<string, any>
): { ok: boolean; status?: number; category?: string; eventType?: string; error?: string };
export function normalizeSecurityDatabaseFields<T>(store: T): T;
export function getPublicStoreView<T>(store: T, isAdmin?: boolean): T;
export function findDuplicateTrxRecord(
  store: Record<string, any>,
  normalizedTrxId: string,
  excludeOrderNumber?: string
): { orderNumber: string; status: string } | null;
export function verifyAndProcessCustomerPayment(
  store: Record<string, any>,
  params: Record<string, any>,
  clientIp?: string
): {
  ok: boolean;
  status: number;
  valid: boolean;
  verified: boolean;
  duplicate?: boolean;
  flagged?: boolean;
  flagReason?: string;
  flagMessage?: string;
  normalizedTrxId?: string;
  orderStatus?: 'Pending' | 'Approved';
  matchedPayment?: Record<string, any> | null;
  pkg?: Record<string, any> | null;
  error?: string;
};
