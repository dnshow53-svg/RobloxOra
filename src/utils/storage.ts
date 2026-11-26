import {
  DEFAULT_ROBUX_PACKAGES,
  GroupSettings,
  OrderRecord,
  ROBLOX_GROUP_URL,
  RegisteredUser,
  RobuxPackage,
  SessionState,
  TARGET_GROUP_ID,
  VerificationTimerState,
  normalizeOrderStatus,
} from '../data/packages';

const KEYS = {
  PACKAGES: 'bloxmint_packages_v1',
  USERS: 'bloxmint_users_v1',
  SESSION: 'bloxmint_session_v1',
  ORDERS: 'bloxmint_orders_v1',
  GROUP_SETTINGS: 'bloxmint_group_settings_v1',
  TIMER_PREFIX: 'bloxmint_timer_v2_',
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function loadPackages(): RobuxPackage[] {
  const stored = safeRead<Array<RobuxPackage & { priceUsd?: number }> | null>(
    KEYS.PACKAGES,
    null
  );
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    safeWrite(KEYS.PACKAGES, DEFAULT_ROBUX_PACKAGES);
    return DEFAULT_ROBUX_PACKAGES;
  }
  return stored.map((pkg) => ({
    id: pkg.id,
    robux: pkg.robux,
    title: pkg.title,
    tierLabel: pkg.tierLabel,
    priceBdt: Number(pkg.priceBdt) || Math.round(Number(pkg.priceUsd || 5) * 118),
    deliveryNote: pkg.deliveryNote,
    image:
      typeof pkg.image === 'string' &&
      !pkg.image.startsWith('/src/assets/images/pkg_')
        ? pkg.image
        : '',
  }));
}

export function savePackages(packages: RobuxPackage[]): void {
  safeWrite(KEYS.PACKAGES, packages);
}

export function loadUsers(): RegisteredUser[] {
  return safeRead<RegisteredUser[]>(KEYS.USERS, []);
}

export function saveUsers(users: RegisteredUser[]): void {
  safeWrite(KEYS.USERS, users);
}

export function loadSession(): SessionState {
  const stored = safeRead<SessionState>(KEYS.SESSION, null);
  if (!stored || stored.email === 'guest@robuxora.com') {
    return null;
  }
  return stored;
}

export function saveSession(session: SessionState): void {
  if (session === null) {
    window.localStorage.removeItem(KEYS.SESSION);
  } else {
    safeWrite(KEYS.SESSION, session);
  }
}

export function loadOrders(): OrderRecord[] {
  const stored = safeRead<Array<OrderRecord & { priceUsd?: number }>>(KEYS.ORDERS, []);
  return stored.map((ord) => ({
    id: ord.id,
    orderNumber: ord.orderNumber,
    userEmail: ord.userEmail,
    userName: ord.userName,
    userPhone: ord.userPhone || '',
    robloxUsername: ord.robloxUsername,
    robloxUserId: typeof ord.robloxUserId === 'number' ? ord.robloxUserId : null,
    packageId: ord.packageId,
    packageTitle: ord.packageTitle,
    robuxAmount: ord.robuxAmount,
    priceBdt: Number(ord.priceBdt) || Math.round(Number(ord.priceUsd || 0) * 118),
    paymentMethod: ord.paymentMethod,
    transactionId: ord.transactionId,
    paymentVerified: Boolean(ord.paymentVerified),
    status: normalizeOrderStatus(ord.status),
    verifiedAtMs: typeof ord.verifiedAtMs === 'number' ? ord.verifiedAtMs : undefined,
    unlockAtMs: typeof ord.unlockAtMs === 'number' ? ord.unlockAtMs : undefined,
    createdAt: ord.createdAt,
    confirmedAt: typeof ord.confirmedAt === 'string' ? ord.confirmedAt : undefined,
  }));
}

export function saveOrders(orders: OrderRecord[]): void {
  safeWrite(KEYS.ORDERS, orders);
}

export function loadGroupSettings(): GroupSettings {
  const settings = safeRead<GroupSettings>(KEYS.GROUP_SETTINGS, {
    groupId: TARGET_GROUP_ID,
    groupUrl: ROBLOX_GROUP_URL,
    availableRobux: 25400,
  });
  return {
    ...settings,
    availableRobux: typeof settings.availableRobux === 'number' ? settings.availableRobux : 25400,
  };
}

export function saveGroupSettings(settings: GroupSettings): void {
  safeWrite(KEYS.GROUP_SETTINGS, settings);
}

export function getTimerStorageKey(session: SessionState): string {
  const scope = session?.email ? session.email.toLowerCase() : 'guest';
  return `${KEYS.TIMER_PREFIX}${scope}`;
}

export const EMPTY_TIMER_STATE: VerificationTimerState = {
  hasClickedGroupLink: false,
  isGroupVerified: false,
  unlockAtMs: 0,
  verifiedAtMs: 0,
  robloxUsername: '',
  robloxUserId: null,
};

export function loadTimerState(session: SessionState): VerificationTimerState {
  if (!session) return EMPTY_TIMER_STATE;
  return safeRead<VerificationTimerState>(
    getTimerStorageKey(session),
    EMPTY_TIMER_STATE
  );
}

export function saveTimerState(
  session: SessionState,
  state: VerificationTimerState
): void {
  safeWrite(getTimerStorageKey(session), state);
}

const PUSHED_ORDER_IDS_KEY = 'robuxora_pushed_order_ids_v1';

export function loadPushedOrderIds(): Set<string> {
  const arr = safeRead<string[]>(PUSHED_ORDER_IDS_KEY, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

export function markOrderIdPushed(orderId: string): void {
  const set = loadPushedOrderIds();
  set.add(orderId);
  safeWrite(PUSHED_ORDER_IDS_KEY, Array.from(set));
}

export function scanLocalVerifiedTimers(): Array<{
  email: string;
  state: VerificationTimerState;
}> {
  const found: Array<{ email: string; state: VerificationTimerState }> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(KEYS.TIMER_PREFIX)) continue;
      const scope = key.slice(KEYS.TIMER_PREFIX.length);
      if (!scope || scope === 'guest') continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as VerificationTimerState;
      if (parsed && parsed.isGroupVerified && parsed.verifiedAtMs > 0) {
        found.push({ email: scope, state: parsed });
      }
    }
  } catch {
    // ignore storage read errors
  }
  return found;
}

const PUSHED_PACKAGE_IDS_KEY = 'robuxora_pushed_pkg_ids_v1';
const DELETED_PACKAGE_IDS_KEY = 'robuxora_deleted_pkg_ids_v1';

export function loadPushedPackageIds(): Set<string> {
  const arr = safeRead<string[]>(PUSHED_PACKAGE_IDS_KEY, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

export function markPackageIdPushed(pkgId: string): void {
  const set = loadPushedPackageIds();
  set.add(pkgId);
  safeWrite(PUSHED_PACKAGE_IDS_KEY, Array.from(set));
}

export function loadDeletedPackageIds(): Set<string> {
  const arr = safeRead<string[]>(DELETED_PACKAGE_IDS_KEY, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

export function markPackageIdDeleted(pkgId: string): void {
  const set = loadDeletedPackageIds();
  set.add(pkgId);
  safeWrite(DELETED_PACKAGE_IDS_KEY, Array.from(set));
}

export function clearPackageIdDeleted(pkgId: string): void {
  const set = loadDeletedPackageIds();
  if (set.delete(pkgId)) {
    safeWrite(DELETED_PACKAGE_IDS_KEY, Array.from(set));
  }
}

const DELETED_ORDER_IDS_KEY = 'robuxora_deleted_order_ids_v1';

export function loadDeletedOrderIds(): Set<string> {
  const arr = safeRead<string[]>(DELETED_ORDER_IDS_KEY, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

export function markOrderIdDeleted(orderId: string): void {
  const set = loadDeletedOrderIds();
  set.add(orderId);
  safeWrite(DELETED_ORDER_IDS_KEY, Array.from(set));
}

export function markOrderIdsDeleted(orderIds: string[]): void {
  if (!orderIds.length) return;
  const set = loadDeletedOrderIds();
  let changed = false;
  for (const id of orderIds) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) {
    safeWrite(DELETED_ORDER_IDS_KEY, Array.from(set));
  }
}
