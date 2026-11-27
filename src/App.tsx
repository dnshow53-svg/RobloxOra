import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Headphones,
  LogIn,
  Moon,
  Search,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sun,
  User,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  CLICK_REQUIRED_ERROR,
  DEFAULT_ROBUX_PACKAGES,
  FIFTEEN_DAYS_SECONDS,
  GroupSettings,
  NOT_JOINED_ERROR,
  OrderRecord,
  OrderStatus,
  PAYMENT_OPTIONS,
  PaymentSecurityLog,
  RegisteredUser,
  RobuxPackage,
  SessionState,
  UNJOINED_WARNING,
  VerificationTimerState,
  VerifiedPaymentRecord,
  calculateUserTotalSpend,
  getUserLoyaltyTier,
  normalizeOrderStatus,
} from './data/packages';
import {
  EMPTY_TIMER_STATE,
  clearPackageIdDeleted,
  loadDeletedPackageIds,
  loadDeletedOrderIds,
  loadGroupSettings,
  loadOrders,
  loadPackages,
  loadPushedOrderIds,
  loadPushedPackageIds,
  loadSession,
  loadTimerState,
  loadUsers,
  markOrderIdDeleted,
  markOrderIdsDeleted,
  markOrderIdPushed,
  markPackageIdDeleted,
  markPackageIdPushed,
  saveGroupSettings,
  saveOrders,
  savePackages,
  saveSession,
  saveTimerState,
  saveUsers,
  scanLocalVerifiedTimers,
} from './utils/storage';
import {
  isFirebaseAdminConnected,
  removeStoreOrder,
  removeStorePackage,
  reserveUniqueTrxIdInFirestore,
  saveStoreGroupSettings,
  signInAdminWithGoogle,
  subscribeFirebaseAuth,
  subscribePaymentSecurityLogs,
  subscribeStoreOrders,
  subscribeStorePackages,
  subscribeStoreSettings,
  upsertPaymentSecurityLog,
  upsertStoreOrder,
  upsertStorePackage,
} from './firebase';
import { verifyRobloxMembership } from './utils/robloxApi';
import { BrandShardLogo, ResilientImage, RobuxMark } from './components/RobuxIcon';
import { VerificationAndPaymentSection } from './components/VerificationAndPaymentSection';
import type { AuthModalMode } from './components/AuthModal';
import { CustomerOrdersSection } from './components/CustomerOrdersSection';

const VerificationModal = lazy(() =>
  import('./components/VerificationModal').then((m) => ({ default: m.VerificationModal }))
);
const AuthModal = lazy(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const ProfileModal = lazy(() =>
  import('./components/ProfileModal').then((m) => ({ default: m.ProfileModal }))
);
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
import { RestockCountdownCard } from './components/RestockCountdownCard';

export const DEFAULT_PRODUCT_IMAGE = '/src/assets/images/pkg_starter_vault_1795779453204.jpg';

function sanitizeImage(url?: string): string {
  if (typeof url !== 'string') return DEFAULT_PRODUCT_IMAGE;
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_PRODUCT_IMAGE;
  return trimmed;
}

const VAULT_ARTWORKS = [DEFAULT_PRODUCT_IMAGE];

function formatRelativeAgo(isoString: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (diffSec < 90) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const FAQ_ITEMS = [
  {
    q: 'How does automatic Roblox group verification work?',
    a: 'After clicking Join Community and entering your Roblox username, RobuxOra checks your real-time Roblox profile and group roles against our official community ID before starting your 15-day hold.',
  },
  {
    q: 'What happens if I leave the Roblox community early?',
    a: 'Whenever you reload the page, open checkout, or submit payment, RobuxOra re-checks your membership automatically. Leaving the group immediately resets your 15-day timer and locks payment.',
  },
  {
    q: 'Do my account, profile edits, packages, orders, and timer stay saved?',
    a: 'Yes. Customer registrations, profile updates, Admin package & group settings, order statuses, and your active 15-day timer persist automatically in browser localStorage.',
  },
];

const THEME_STORAGE_KEY = 'robuxora_theme_v1';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage failure
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const [packages, setPackages] = useState<RobuxPackage[]>(() => loadPackages());
  const [users, setUsers] = useState<RegisteredUser[]>(() => loadUsers());
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [orders, setOrders] = useState<OrderRecord[]>(() => {
    const deleted = loadDeletedOrderIds();
    return loadOrders().filter((o) => !deleted.has(o.id));
  });
  const [groupSettings, setGroupSettings] = useState<GroupSettings>(() =>
    loadGroupSettings()
  );

  const [selectedPackageId, setSelectedPackageId] = useState<string>(
    () => loadPackages()[1]?.id || loadPackages()[0]?.id || ''
  );
  const [timerState, setTimerState] = useState<VerificationTimerState>(() => {
    const s = loadSession();
    if (!s) return EMPTY_TIMER_STATE;
    const loaded = loadTimerState(s);
    if (
      loaded.isGroupVerified &&
      loaded.verifiedAtMs > 0 &&
      loaded.unlockAtMs === loaded.verifiedAtMs + 14 * 24 * 60 * 60 * 1000
    ) {
      const migrated = {
        ...loaded,
        unlockAtMs: loaded.verifiedAtMs + FIFTEEN_DAYS_SECONDS * 1000,
      };
      saveTimerState(s, migrated);
      return migrated;
    }
    return loaded;
  });
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (!timerState.isGroupVerified) return 0;
    return Math.max(0, Math.ceil((timerState.unlockAtMs - Date.now()) / 1000));
  });

  // Modals & UI feedback
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('signin');
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [pendingCheckoutAfterAuth, setPendingCheckoutAfterAuth] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [isVerifyingApi, setIsVerifyingApi] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [verifiedPayments, setVerifiedPayments] = useState<VerifiedPaymentRecord[]>([]);
  const [paymentSecurityLogs, setPaymentSecurityLogs] = useState<PaymentSecurityLog[]>([]);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<{
    orderId: string;
    method: string;
    transactionId?: string;
    verified?: boolean;
    flagged?: boolean;
    flagMessage?: string;
  } | null>(null);
  const [outOfStockAlert, setOutOfStockAlert] = useState<{
    available: number;
    needed: number;
    packageTitle: string;
  } | null>(null);
  const [dismissedConfirmBannerKey, setDismissedConfirmBannerKey] = useState<string>('');

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [headerAvatarBroken, setHeaderAvatarBroken] = useState(false);
  const [currentView, setCurrentView] = useState<'store' | 'marketplace'>('store');
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [marketCategory, setMarketCategory] = useState('All Games');
  const [marketSearch, setMarketSearch] = useState('');
  const [marketSort, setMarketSort] = useState('Default');

  // Global interactive animations on every button & clickable element
  useEffect(() => {
    const handlePointerAction = (e: MouseEvent | PointerEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('button:not(:disabled), a[href], [role="button"]') as HTMLElement | null;
      if (!btn) return;

      const classList = (btn.className || '') + ' ' + (btn.getAttribute('class') || '');
      const btnText = (btn.textContent || '').trim();
      let shockwaveClass = 'shockwave-amber';
      let rippleBg =
        'radial-gradient(circle, rgba(255, 255, 255, 0.75) 0%, rgba(251, 191, 36, 0.5) 45%, transparent 70%)';

      if (
        classList.includes('red-') ||
        classList.includes('rose-') ||
        classList.includes('Delete') ||
        btnText.includes('Delete') ||
        btnText.includes('Cancel')
      ) {
        shockwaveClass = 'shockwave-red';
        rippleBg =
          'radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(248, 113, 113, 0.6) 45%, transparent 70%)';
      } else if (
        classList.includes('emerald-') ||
        classList.includes('green-') ||
        btnText.includes('Approve') ||
        btnText.includes('Complete')
      ) {
        shockwaveClass = 'shockwave-emerald';
        rippleBg =
          'radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(52, 211, 153, 0.6) 45%, transparent 70%)';
      } else if (
        classList.includes('zinc-') ||
        classList.includes('bg-[#110F1B]') ||
        classList.includes('bg-[#161422]') ||
        classList.includes('bg-[#0A090F]') ||
        classList.includes('bg-[#1C1928]') ||
        classList.includes('bg-[#131820]') ||
        classList.includes('bg-[#090B0E]') ||
        classList.includes('bg-white/') ||
        classList.includes('border-white')
      ) {
        shockwaveClass = 'shockwave-neutral';
        rippleBg =
          'radial-gradient(circle, rgba(255, 255, 255, 0.7) 0%, rgba(203, 213, 225, 0.45) 45%, transparent 70%)';
      }

      // Trigger energetic spring click pop + exterior shockwave
      btn.classList.remove(
        'is-btn-clicked',
        'shockwave-amber',
        'shockwave-emerald',
        'shockwave-red',
        'shockwave-neutral'
      );
      void btn.offsetWidth;
      btn.classList.add('is-btn-clicked', shockwaveClass);
      window.setTimeout(() => {
        btn.classList.remove(
          'is-btn-clicked',
          'shockwave-amber',
          'shockwave-emerald',
          'shockwave-red',
          'shockwave-neutral'
        );
      }, 440);

      // Spawn expanding ripple from click / touch position
      try {
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'btn-dynamic-ripple';
        ripple.style.background = rippleBg;
        const diameter = Math.max(rect.width, rect.height) * 2;

        let clientX = 0;
        let clientY = 0;
        if ('touches' in e && (e as TouchEvent).touches?.length > 0) {
          clientX = (e as TouchEvent).touches[0].clientX;
          clientY = (e as TouchEvent).touches[0].clientY;
        } else if ('clientX' in e && typeof (e as MouseEvent).clientX === 'number') {
          clientX = (e as MouseEvent).clientX;
          clientY = (e as MouseEvent).clientY;
        }

        let x = clientX - rect.left - diameter / 2;
        let y = clientY - rect.top - diameter / 2;
        if (!clientX && !clientY) {
          x = rect.width / 2 - diameter / 2;
          y = rect.height / 2 - diameter / 2;
        }

        ripple.style.width = `${diameter}px`;
        ripple.style.height = `${diameter}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        btn.appendChild(ripple);

        window.setTimeout(() => {
          ripple.remove();
        }, 580);
      } catch {
        // Safe fallback
      }
    };

    document.addEventListener('pointerdown', handlePointerAction as EventListener, { capture: true });
    return () => document.removeEventListener('pointerdown', handlePointerAction as EventListener, { capture: true });
  }, []);

  const currentUser = useMemo(() => {
    if (!session || session.role !== 'user') return null;
    return (
      users.find((u) => u.email.toLowerCase() === session.email.toLowerCase()) ||
      null
    );
  }, [session, users]);

  useEffect(() => {
    setHeaderAvatarBroken(false);
  }, [currentUser?.avatar]);

  const currentUserSpend = useMemo(() => {
    const userEmail = currentUser ? currentUser.email : session?.email;
    return calculateUserTotalSpend(orders, userEmail);
  }, [orders, currentUser, session]);

  const currentUserTier = useMemo(() => {
    return getUserLoyaltyTier(currentUserSpend);
  }, [currentUserSpend]);

  const isAdmin = session?.role === 'admin';
  const isSignedIn = Boolean(session);
  const isCloudConnected = isFirebaseAdminConnected(firebaseUser);

  const selectedPackage = useMemo(() => {
    return (
      packages.find((p) => p.id === selectedPackageId) || packages[0] || null
    );
  }, [packages, selectedPackageId]);

  const userOrders = useMemo(() => {
    const targetEmail = currentUser?.email || (session?.role === 'user' ? session.email : '');
    if (!targetEmail) return [];
    return orders.filter(
      (o) => o.userEmail.toLowerCase() === targetEmail.toLowerCase()
    );
  }, [orders, currentUser, session]);

  const confirmedUserOrders = useMemo(() => {
    return userOrders.filter(
      (o) => o.status === 'Approved' || o.status === 'Completed'
    );
  }, [userOrders]);

  const latestConfirmedOrder = confirmedUserOrders[0] || null;
  const confirmedBannerKey = latestConfirmedOrder
    ? `${latestConfirmedOrder.id}:${latestConfirmedOrder.status}`
    : '';

  const liveReceiptOrder = useMemo(() => {
    if (!orderReceipt) return null;
    return (
      orders.find((o) => o.orderNumber === orderReceipt.orderId) || null
    );
  }, [orders, orderReceipt]);

  // Refs for stable async callbacks & race-free server/Firestore synchronization
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const selectedPackageRef = useRef(selectedPackage);
  selectedPackageRef.current = selectedPackage;
  const packagesRef = useRef(packages);
  packagesRef.current = packages;
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const usersRef = useRef(users);
  usersRef.current = users;
  const groupSettingsRef = useRef(groupSettings);
  groupSettingsRef.current = groupSettings;
  const latestGroupSettingsTsRef = useRef<number>(groupSettings.updatedAtMs ?? 0);
  const isCloudConnectedRef = useRef(isCloudConnected);
  isCloudConnectedRef.current = isCloudConnected;
  const cloudPackagesCountRef = useRef(0);
  const inFlightPackageIdsRef = useRef<Set<string>>(new Set());
  const inFlightDeletedPackageIdsRef = useRef<Set<string>>(new Set());
  const inFlightOrderIdsRef = useRef<Set<string>>(new Set());
  const inFlightDeletedOrderIdsRef = useRef<Set<string>>(new Set());
  const inFlightGroupSettingsRef = useRef(false);
  const inFlightUserIdsRef = useRef<Set<string>>(new Set());
  const syncEpochRef = useRef(0);
  const cloudOrderIdsRef = useRef<Set<string>>(new Set());
  const isSwitchingUsernameRef = useRef(false);
  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;
  const paymentSecurityLogsRef = useRef(paymentSecurityLogs);
  paymentSecurityLogsRef.current = paymentSecurityLogs;

  const getAdminAuthHeaders = useCallback((includeJson = true): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }
    if (adminTokenRef.current) {
      headers.Authorization = `Bearer ${adminTokenRef.current}`;
    }
    return headers;
  }, []);

  const persistUserVerificationTimer = useCallback(
    (
      targetSession: SessionState,
      nextTimer: VerificationTimerState,
      options?: { tombstoneLeftUsername?: string }
    ) => {
      if (!targetSession || targetSession.role !== 'user') return;
      const emailLower = targetSession.email.toLowerCase();
      const matched = usersRef.current.find(
        (u) => u.email.toLowerCase() === emailLower
      );
      if (!matched) return;

      const updatedAtMs = Date.now();
      const nextMap: Record<string, VerificationTimerState> = {
        ...(matched.verifiedRobloxTimers || {}),
      };
      if (matched.verificationTimer?.isGroupVerified && matched.verificationTimer.robloxUsername.trim()) {
        const prevKey = matched.verificationTimer.robloxUsername.trim().toLowerCase();
        if (!nextMap[prevKey]) {
          nextMap[prevKey] = matched.verificationTimer;
        }
      }
      if (options?.tombstoneLeftUsername) {
        const leftKey = options.tombstoneLeftUsername.trim().toLowerCase();
        if (leftKey) {
          nextMap[leftKey] = {
            ...EMPTY_TIMER_STATE,
            hasClickedGroupLink: nextTimer.hasClickedGroupLink,
            robloxUsername: options.tombstoneLeftUsername.trim(),
            robloxUserId: null,
            verifiedAtMs: updatedAtMs,
            unlockAtMs: 0,
            isGroupVerified: false,
          };
        }
      } else if (nextTimer.isGroupVerified && nextTimer.robloxUsername.trim()) {
        const key = nextTimer.robloxUsername.trim().toLowerCase();
        nextMap[key] = nextTimer;
      }

      const updatedUser: RegisteredUser = {
        ...matched,
        verificationTimer: nextTimer,
        verifiedRobloxTimers: nextMap,
        updatedAtMs,
      };

      inFlightUserIdsRef.current.add(updatedUser.id);
      const nextUsers = usersRef.current.map((u) =>
        u.id === updatedUser.id ? updatedUser : u
      );
      setUsers(nextUsers);
      saveUsers(nextUsers);

      void fetch(`/api/users/${encodeURIComponent(updatedUser.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          password: updatedUser.password,
          avatar: updatedUser.avatar ?? '',
          verificationTimer: nextTimer,
          verifiedRobloxTimers: nextMap,
          updatedAtMs,
        }),
      })
        .catch(() => {})
        .finally(() => {
          inFlightUserIdsRef.current.delete(updatedUser.id);
        });
    },
    []
  );

  const savedVerifiedTimers = useMemo(() => {
    if (!session || session.role !== 'user') return [] as VerificationTimerState[];
    const byKey = new Map<string, VerificationTimerState>();
    const tombstoneTimestamps = new Map<string, number>();

    if (currentUser?.verifiedRobloxTimers) {
      for (const [k, entry] of Object.entries(currentUser.verifiedRobloxTimers)) {
        const key = (entry.robloxUsername || k).trim().toLowerCase();
        if (!key) continue;
        if (!entry.isGroupVerified) {
          tombstoneTimestamps.set(key, entry.verifiedAtMs || Date.now());
          continue;
        }
        if (entry.verifiedAtMs > 0) {
          byKey.set(key, entry);
        }
      }
    }

    if (
      currentUser?.verificationTimer?.isGroupVerified &&
      currentUser.verificationTimer.verifiedAtMs > 0 &&
      currentUser.verificationTimer.robloxUsername.trim()
    ) {
      const key = currentUser.verificationTimer.robloxUsername.trim().toLowerCase();
      if (!tombstoneTimestamps.has(key) && !byKey.has(key)) {
        byKey.set(key, currentUser.verificationTimer);
      }
    }

    for (const ord of userOrders) {
      if (
        ord.status === 'Cancelled' ||
        typeof ord.verifiedAtMs !== 'number' ||
        ord.verifiedAtMs <= 0 ||
        typeof ord.unlockAtMs !== 'number' ||
        ord.unlockAtMs <= 0
      ) {
        continue;
      }
      const cleanName = (ord.robloxUsername || '').trim();
      if (
        !cleanName ||
        cleanName === 'Verified Member' ||
        cleanName === 'Admin Test' ||
        cleanName === 'Admin Override'
      ) {
        continue;
      }
      const key = cleanName.toLowerCase();
      const leftAt = tombstoneTimestamps.get(key) || 0;
      if (leftAt > 0 && ord.verifiedAtMs <= leftAt) continue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          hasClickedGroupLink: true,
          isGroupVerified: true,
          verifiedAtMs: ord.verifiedAtMs,
          unlockAtMs: ord.unlockAtMs,
          robloxUsername: cleanName,
          robloxUserId: ord.robloxUserId ?? null,
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => a.unlockAtMs - b.unlockAtMs);
  }, [session, currentUser, userOrders]);

  const findSavedTimerForRobloxAccount = useCallback(
    (username: string, userId: number | null): VerificationTimerState | null => {
      const cleanKey = username.trim().toLowerCase();
      if (!cleanKey) return null;

      // If this username was explicitly marked as having left the group, never reuse old timers
      const directMapEntry = currentUser?.verifiedRobloxTimers?.[cleanKey];
      if (directMapEntry && !directMapEntry.isGroupVerified) {
        return null;
      }

      if (currentUser?.verifiedRobloxTimers) {
        for (const entry of Object.values(currentUser.verifiedRobloxTimers)) {
          if (!entry.isGroupVerified || entry.verifiedAtMs <= 0) continue;
          if (
            (userId !== null && entry.robloxUserId === userId) ||
            entry.robloxUsername.trim().toLowerCase() === cleanKey
          ) {
            return entry;
          }
        }
      }

      const activeSaved = currentUser?.verificationTimer;
      if (
        activeSaved?.isGroupVerified &&
        activeSaved.verifiedAtMs > 0 &&
        ((userId !== null && activeSaved.robloxUserId === userId) ||
          activeSaved.robloxUsername.trim().toLowerCase() === cleanKey)
      ) {
        return activeSaved;
      }

      const matchingOrder = userOrders.find((o) => {
        if (
          o.status === 'Cancelled' ||
          typeof o.verifiedAtMs !== 'number' ||
          o.verifiedAtMs <= 0 ||
          typeof o.unlockAtMs !== 'number' ||
          o.unlockAtMs <= 0
        ) {
          return false;
        }
        const leftAt = directMapEntry && !directMapEntry.isGroupVerified ? directMapEntry.verifiedAtMs : 0;
        if (leftAt > 0 && o.verifiedAtMs <= leftAt) return false;
        return (
          (userId !== null && o.robloxUserId === userId) ||
          o.robloxUsername.trim().toLowerCase() === cleanKey
        );
      });

      if (matchingOrder && matchingOrder.verifiedAtMs && matchingOrder.unlockAtMs) {
        return {
          hasClickedGroupLink: true,
          isGroupVerified: true,
          verifiedAtMs: matchingOrder.verifiedAtMs,
          unlockAtMs: matchingOrder.unlockAtMs,
          robloxUsername: matchingOrder.robloxUsername.trim() || username.trim(),
          robloxUserId: matchingOrder.robloxUserId ?? userId,
        };
      }

      return null;
    },
    [currentUser, userOrders]
  );

  const updateTimerState = useCallback(
    (updater: (prev: VerificationTimerState) => VerificationTimerState) => {
      setTimerState((prev) => {
        const next = updater(prev);
        saveTimerState(sessionRef.current, next);
        return next;
      });
    },
    []
  );

  const registerWaitingOrder = useCallback(
    async (
      verifiedState: VerificationTimerState,
      pkgOverride?: RobuxPackage | null
    ) => {
      const activeSession = sessionRef.current;
      const activeUser = currentUserRef.current;
      if (
        !activeSession ||
        !verifiedState.isGroupVerified ||
        !verifiedState.verifiedAtMs
      ) {
        return;
      }
      const pkg =
        pkgOverride || selectedPackageRef.current || packagesRef.current[0];
      if (!pkg) return;

      const userEmail = activeUser ? activeUser.email : activeSession.email;
      const syncFlagKey = `robuxora_wait_sync_v2_${userEmail.toLowerCase()}_${verifiedState.verifiedAtMs}`;
      const existing = loadOrders().find(
        (o) =>
          o.userEmail.toLowerCase() === userEmail.toLowerCase() &&
          o.verifiedAtMs === verifiedState.verifiedAtMs
      );

      const sanitizedEmail = userEmail.toLowerCase().replace(/[^a-z0-9]/g, '');
      const waitingId = `wait-${verifiedState.verifiedAtMs}-${sanitizedEmail}`;
      if (
        loadDeletedOrderIds().has(waitingId) ||
        inFlightDeletedOrderIdsRef.current.has(waitingId)
      ) {
        return;
      }

      const waitingOrder: OrderRecord = existing || {
        id: waitingId,
        orderNumber: `BM-${Math.floor(1000 + Math.random() * 9000)}`,
        userEmail,
        userName: activeUser ? activeUser.name : 'Store Admin',
        userPhone: activeUser ? activeUser.phone : '',
        robloxUsername: verifiedState.robloxUsername.trim() || 'Verified Member',
        robloxUserId: verifiedState.robloxUserId,
        packageId: pkg.id,
        packageTitle: pkg.title,
        robuxAmount: pkg.robux,
        priceBdt: pkg.priceBdt,
        paymentMethod: 'Waiting 15-Day Hold',
        status: 'Waiting',
        verifiedAtMs: verifiedState.verifiedAtMs,
        unlockAtMs: verifiedState.unlockAtMs,
        createdAt: new Date(verifiedState.verifiedAtMs).toISOString(),
      };

      inFlightOrderIdsRef.current.add(waitingOrder.id);
      syncEpochRef.current += 1;
      if (!existing) {
        const nextOrders = [
          waitingOrder,
          ...loadOrders().filter((o) => o.id !== waitingOrder.id),
        ];
        setOrders(nextOrders);
        saveOrders(nextOrders);
      }

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(waitingOrder),
        });
        if (res.ok) {
          markOrderIdPushed(waitingOrder.id);
          try {
            localStorage.setItem(syncFlagKey, '1');
          } catch {
            // ignore
          }
        }
        if (isCloudConnectedRef.current) {
          await upsertStoreOrder(waitingOrder).catch(() => {});
        }
      } catch {
        // Offline fallback preserved in localStorage
      } finally {
        inFlightOrderIdsRef.current.delete(waitingOrder.id);
      }
    },
    []
  );

  const cancelWaitingOrderForTimer = useCallback(async (verifiedAtMs: number) => {
    const activeSession = sessionRef.current;
    const activeUser = currentUserRef.current;
    if (!activeSession || !verifiedAtMs) return;
    const userEmail = activeUser ? activeUser.email : activeSession.email;
    const matching = loadOrders().find(
      (o) =>
        o.userEmail.toLowerCase() === userEmail.toLowerCase() &&
        o.verifiedAtMs === verifiedAtMs &&
        o.status === 'Waiting'
    );
    if (!matching) return;

    inFlightOrderIdsRef.current.add(matching.id);
    syncEpochRef.current += 1;
    const updatedOrder: OrderRecord = { ...matching, status: 'Cancelled' };
    const nextOrders = loadOrders().map((o) =>
      o.id === matching.id ? updatedOrder : o
    );
    setOrders(nextOrders);
    saveOrders(nextOrders);

    try {
      const patchRes = await fetch(`/api/orders/${encodeURIComponent(matching.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Cancelled' }),
      });
      if (patchRes.status === 404) {
        const postRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedOrder),
        });
        if (postRes.ok) markOrderIdPushed(updatedOrder.id);
      }
    } catch {
      // ignore offline
    } finally {
      inFlightOrderIdsRef.current.delete(matching.id);
    }
  }, []);

  // Automatic Unjoin Detection helper
  const isCheckingUnjoinRef = useRef(false);
  const verifyStillMemberInBackground = useCallback(
    async (
      targetState: VerificationTimerState,
      targetGroupId: number
    ): Promise<boolean> => {
      if (!targetState.isGroupVerified || !targetState.robloxUsername.trim()) {
        return false;
      }
      if (
        targetState.robloxUserId === null &&
        targetState.robloxUsername.trim() === 'Admin Override'
      ) {
        return true;
      }
      if (isCheckingUnjoinRef.current) return true;
      isCheckingUnjoinRef.current = true;

      try {
        const outcome = await verifyRobloxMembership(
          targetState.robloxUsername,
          targetGroupId,
          targetState.robloxUserId
        );

        if (outcome.status === 'verified') {
          if (targetState.robloxUserId === null) {
            setTimerState((prev) => {
              if (!prev.isGroupVerified) return prev;
              const updated = { ...prev, robloxUserId: outcome.userId };
              saveTimerState(sessionRef.current, updated);
              persistUserVerificationTimer(sessionRef.current, updated);
              return updated;
            });
          }
          return true;
        }

        if (outcome.status === 'not_joined') {
          void cancelWaitingOrderForTimer(targetState.verifiedAtMs);
          const reset: VerificationTimerState = {
            ...EMPTY_TIMER_STATE,
            hasClickedGroupLink: targetState.hasClickedGroupLink,
            robloxUsername: targetState.robloxUsername,
          };
          setTimerState(reset);
          saveTimerState(sessionRef.current, reset);
          persistUserVerificationTimer(sessionRef.current, reset, {
            tombstoneLeftUsername: targetState.robloxUsername,
          });
          setRemainingSeconds(FIFTEEN_DAYS_SECONDS);
          setSelectedPaymentId(null);
          setOrderReceipt(null);
          setErrorMessage(UNJOINED_WARNING);
          return false;
        }

        return true;
      } finally {
        isCheckingUnjoinRef.current = false;
      }
    },
    [cancelWaitingOrderForTimer, persistUserVerificationTimer]
  );

  // Reload scoped timer when active user identity or target group changes + backfill Waiting order
  const sessionKey = session ? `${session.role}:${session.email.toLowerCase()}` : '';
  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      setTimerState({ ...EMPTY_TIMER_STATE });
      setRemainingSeconds(0);
      setErrorMessage(null);
      setOrderReceipt(null);
      return;
    }
    let nextTimer = loadTimerState(activeSession);
    const matchedUser = usersRef.current.find(
      (u) => u.email.toLowerCase() === activeSession.email.toLowerCase()
    );
    const serverTimer = matchedUser?.verificationTimer;

    if (
      !nextTimer.isGroupVerified &&
      serverTimer?.isGroupVerified &&
      serverTimer.verifiedAtMs > 0
    ) {
      nextTimer = { ...serverTimer };
      saveTimerState(activeSession, nextTimer);
    } else if (
      nextTimer.isGroupVerified &&
      serverTimer?.isGroupVerified &&
      serverTimer.verifiedAtMs === nextTimer.verifiedAtMs &&
      serverTimer.unlockAtMs < nextTimer.unlockAtMs
    ) {
      nextTimer = {
        ...nextTimer,
        unlockAtMs: serverTimer.unlockAtMs,
      };
      saveTimerState(activeSession, nextTimer);
    } else if (!nextTimer.isGroupVerified && serverTimer === undefined) {
      const recoverableOrder = ordersRef.current.find(
        (o) =>
          o.userEmail.toLowerCase() === activeSession.email.toLowerCase() &&
          o.status !== 'Cancelled' &&
          typeof o.verifiedAtMs === 'number' &&
          o.verifiedAtMs > 0 &&
          typeof o.unlockAtMs === 'number' &&
          o.unlockAtMs > 0
      );
      if (recoverableOrder && recoverableOrder.verifiedAtMs && recoverableOrder.unlockAtMs) {
        nextTimer = {
          hasClickedGroupLink: true,
          isGroupVerified: true,
          verifiedAtMs: recoverableOrder.verifiedAtMs,
          unlockAtMs: recoverableOrder.unlockAtMs,
          robloxUsername: recoverableOrder.robloxUsername || 'Verified Member',
          robloxUserId: recoverableOrder.robloxUserId ?? null,
        };
        saveTimerState(activeSession, nextTimer);
        persistUserVerificationTimer(activeSession, nextTimer);
      }
    } else if (nextTimer.isGroupVerified && !serverTimer) {
      persistUserVerificationTimer(activeSession, nextTimer);
    }

    if (
      nextTimer.isGroupVerified &&
      nextTimer.verifiedAtMs > 0 &&
      nextTimer.unlockAtMs === nextTimer.verifiedAtMs + 14 * 24 * 60 * 60 * 1000
    ) {
      nextTimer = {
        ...nextTimer,
        unlockAtMs: nextTimer.verifiedAtMs + FIFTEEN_DAYS_SECONDS * 1000,
      };
      saveTimerState(activeSession, nextTimer);
      persistUserVerificationTimer(activeSession, nextTimer);
    }
    setTimerState(nextTimer);
    if (nextTimer.isGroupVerified) {
      setRemainingSeconds(
        Math.max(0, Math.ceil((nextTimer.unlockAtMs - Date.now()) / 1000))
      );
      if (activeSession && nextTimer.verifiedAtMs) {
        const syncFlagKey = `robuxora_wait_sync_v2_${activeSession.email.toLowerCase()}_${nextTimer.verifiedAtMs}`;
        let alreadySynced = false;
        try {
          alreadySynced = localStorage.getItem(syncFlagKey) === '1';
        } catch {
          alreadySynced = false;
        }
        const alreadyHasOrder = ordersRef.current.some(
          (o) =>
            o.userEmail.toLowerCase() === activeSession.email.toLowerCase() &&
            o.verifiedAtMs === nextTimer.verifiedAtMs
        );
        if (!alreadySynced && !alreadyHasOrder && nextTimer.unlockAtMs > Date.now()) {
          void registerWaitingOrder(nextTimer);
        }
      }
      void verifyStillMemberInBackground(nextTimer, groupSettings.groupId);
    } else {
      setRemainingSeconds(0);
    }
    setErrorMessage(null);
    setOrderReceipt(null);
  }, [
    sessionKey,
    groupSettings.groupId,
    verifyStillMemberInBackground,
    registerWaitingOrder,
    persistUserVerificationTimer,
  ]);

  // Continuous live unjoin detection: poll every 15s + re-check immediately on tab visibility/focus
  const timerStateRef = useRef(timerState);
  timerStateRef.current = timerState;
  const groupIdRef = useRef(groupSettings.groupId);
  groupIdRef.current = groupSettings.groupId;

  useEffect(() => {
    if (!session || !timerState.isGroupVerified) return;

    const runCheck = () => {
      const current = timerStateRef.current;
      if (!current.isGroupVerified || !current.robloxUsername.trim()) return;
      void verifyStillMemberInBackground(current, groupIdRef.current);
    };

    const intervalId = window.setInterval(runCheck, 15000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        runCheck();
      }
    };
    window.addEventListener('focus', runCheck);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', runCheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, timerState.isGroupVerified, verifyStillMemberInBackground]);

  // Live 15-day countdown tick (stable interval without churn)
  useEffect(() => {
    if (!timerState.isGroupVerified || timerState.unlockAtMs <= 0) return;
    const syncTick = () => {
      const next = Math.max(
        0,
        Math.ceil((timerState.unlockAtMs - Date.now()) / 1000)
      );
      setRemainingSeconds(next);
      return next;
    };
    if (syncTick() <= 0) return;
    const interval = window.setInterval(() => {
      if (syncTick() <= 0) {
        window.clearInterval(interval);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerState.isGroupVerified, timerState.unlockAtMs]);

  // Cross-device & cross-tab store synchronization
  const isSyncingRef = useRef(false);
  const syncFromServer = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const startEpoch = syncEpochRef.current;
    try {
      const fetchHeaders: Record<string, string> = {};
      if (adminTokenRef.current) {
        fetchHeaders.Authorization = `Bearer ${adminTokenRef.current}`;
      }
      const res = await fetch('/api/store', { cache: 'no-store', headers: fetchHeaders });
      if (!res.ok) return;
      const serverData = (await res.json()) as {
        packages?: RobuxPackage[];
        orders?: OrderRecord[];
        deletedOrderIds?: string[];
        users?: RegisteredUser[];
        groupSettings?: GroupSettings;
        verifiedPayments?: VerifiedPaymentRecord[];
        paymentSecurityLogs?: PaymentSecurityLog[];
      };

      if (Array.isArray(serverData.deletedOrderIds) && serverData.deletedOrderIds.length > 0) {
        markOrderIdsDeleted(serverData.deletedOrderIds);
      }

      if (Array.isArray(serverData.verifiedPayments)) {
        setVerifiedPayments(serverData.verifiedPayments);
      }

      if (Array.isArray(serverData.paymentSecurityLogs)) {
        setPaymentSecurityLogs(serverData.paymentSecurityLogs);
      }

      const serverUsers = Array.isArray(serverData.users)
        ? serverData.users
        : [];
      const localUsers = loadUsers();

      // Sync customer accounts both ways without losing newer local profile/avatar edits
      const missingUsersOnServer = localUsers.filter(
        (lu) =>
          !serverUsers.some(
            (su) =>
              su.id === lu.id ||
              su.email.toLowerCase() === lu.email.toLowerCase()
          )
      );
      for (const mu of missingUsersOnServer) {
        await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mu),
        }).catch(() => {});
      }

      const userByEmail = new Map<string, RegisteredUser>();
      for (const su of serverUsers) {
        userByEmail.set(su.email.toLowerCase(), su);
      }

      const usersToPushToServer: RegisteredUser[] = [];
      for (const lu of localUsers) {
        const key = lu.email.toLowerCase();
        const su = userByEmail.get(key);
        if (!su) {
          userByEmail.set(key, lu);
          continue;
        }
        const localTs = lu.updatedAtMs || 0;
        const serverTs = su.updatedAtMs || 0;
        const isInFlight =
          inFlightUserIdsRef.current.has(lu.id) ||
          inFlightUserIdsRef.current.has(su.id);
        if (
          isInFlight ||
          localTs > serverTs ||
          (localTs === serverTs &&
            Boolean(lu.avatar) &&
            !lu.avatar?.startsWith('/uploads/') &&
            !su.avatar)
        ) {
          const mergedTimersMap =
            su.verifiedRobloxTimers || lu.verifiedRobloxTimers
              ? {
                  ...(su.verifiedRobloxTimers || {}),
                  ...(lu.verifiedRobloxTimers || {}),
                }
              : undefined;
          const mergedLocal: RegisteredUser = {
            ...su,
            ...lu,
            id: su.id,
            verifiedRobloxTimers: mergedTimersMap,
            updatedAtMs: Math.max(localTs, serverTs),
          };
          userByEmail.set(key, mergedLocal);
          if (!isInFlight) {
            usersToPushToServer.push(mergedLocal);
          }
        }
      }

      for (const uPush of usersToPushToServer) {
        await fetch(`/api/users/${encodeURIComponent(uPush.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: uPush.name,
            email: uPush.email,
            phone: uPush.phone,
            password: uPush.password,
            avatar: uPush.avatar ?? '',
            verificationTimer: uPush.verificationTimer,
            verifiedRobloxTimers: uPush.verifiedRobloxTimers,
            updatedAtMs: uPush.updatedAtMs ?? Date.now(),
          }),
        }).catch(() => {});
      }

      // Preserve any profile/avatar edits made while async fetches above were in flight
      const latestLocalUsers = loadUsers();
      for (const llu of latestLocalUsers) {
        const key = llu.email.toLowerCase();
        const existingMerged = userByEmail.get(key);
        if (
          !existingMerged ||
          inFlightUserIdsRef.current.has(llu.id) ||
          inFlightUserIdsRef.current.has(existingMerged.id) ||
          (llu.updatedAtMs || 0) > (existingMerged.updatedAtMs || 0)
        ) {
          userByEmail.set(key, {
            ...(existingMerged || llu),
            ...llu,
            id: existingMerged?.id || llu.id,
          });
        }
      }

      const syncedUsers = Array.from(userByEmail.values());
      if (syncedUsers.length > 0) {
        setUsers(syncedUsers);
        saveUsers(syncedUsers);
      }

      const deletedOrderIds = loadDeletedOrderIds();
      const rawServerOrders = Array.isArray(serverData.orders)
        ? serverData.orders
        : [];
      for (const so of rawServerOrders) {
        if (deletedOrderIds.has(so.id)) {
          if (sessionRef.current?.role === 'admin' && adminTokenRef.current) {
            await fetch(`/api/orders/${encodeURIComponent(so.id)}`, {
              method: 'DELETE',
              headers: getAdminAuthHeaders(false),
            }).catch(() => {});
          }
          if (isCloudConnectedRef.current) {
            void removeStoreOrder(so.id).catch(() => {});
          }
        }
      }
      const serverOrders = rawServerOrders
        .filter(
          (so) =>
            !deletedOrderIds.has(so.id) &&
            !inFlightDeletedOrderIdsRef.current.has(so.id)
        )
        .map((so) => ({
          ...so,
          status: normalizeOrderStatus(so.status),
          priceBdt: Number(so.priceBdt) || 0,
          robuxAmount: Number(so.robuxAmount) || 0,
          paymentVerified: Boolean(so.paymentVerified),
        }));
      for (const so of serverOrders) {
        markOrderIdPushed(so.id);
      }

      const localOrders = loadOrders().filter(
        (lo) =>
          !deletedOrderIds.has(lo.id) &&
          !inFlightDeletedOrderIdsRef.current.has(lo.id)
      );
      const pushedIds = loadPushedOrderIds();

      // Recover any verified local user timers (even if customer signed out earlier) into Waiting orders
      const discoveredWaitingOrders: OrderRecord[] = [];
      const defaultPkg = packagesRef.current[0] || serverData.packages?.[0];
      if (defaultPkg) {
        for (const item of scanLocalVerifiedTimers()) {
          const emailLower = item.email.toLowerCase();
          const alreadyExists =
            serverOrders.some(
              (so) =>
                so.userEmail.toLowerCase() === emailLower &&
                so.verifiedAtMs === item.state.verifiedAtMs
            ) ||
            localOrders.some(
              (lo) =>
                lo.userEmail.toLowerCase() === emailLower &&
                lo.verifiedAtMs === item.state.verifiedAtMs
            );
          if (alreadyExists) continue;
          const sanitized = emailLower.replace(/[^a-z0-9]/g, '');
          const id = `wait-${item.state.verifiedAtMs}-${sanitized}`;
          if (
            inFlightDeletedOrderIdsRef.current.has(id) ||
            deletedOrderIds.has(id)
          ) {
            continue;
          }
          const matchedUser = syncedUsers.find(
            (u) => u.email.toLowerCase() === emailLower
          );
          discoveredWaitingOrders.push({
            id,
            orderNumber: `BM-${Math.floor(1000 + Math.random() * 9000)}`,
            userEmail: matchedUser ? matchedUser.email : emailLower,
            userName: matchedUser ? matchedUser.name : emailLower === 'dnshow53@gmail.com' ? 'Store Admin' : emailLower,
            userPhone: matchedUser ? matchedUser.phone : '',
            robloxUsername: item.state.robloxUsername.trim() || 'Verified Member',
            robloxUserId: item.state.robloxUserId,
            packageId: defaultPkg.id,
            packageTitle: defaultPkg.title,
            robuxAmount: defaultPkg.robux,
            priceBdt: defaultPkg.priceBdt,
            paymentMethod: 'Waiting 15-Day Hold',
            status: 'Waiting',
            verifiedAtMs: item.state.verifiedAtMs,
            unlockAtMs: item.state.unlockAtMs,
            createdAt: new Date(item.state.verifiedAtMs).toISOString(),
          });
        }
      }

      // Push any local orders missing from Express (always preserve Waiting timers if not deleted)
      const unsentLocalOrders = [
        ...discoveredWaitingOrders,
        ...localOrders.filter(
          (lo) =>
            !serverOrders.some((so) => so.id === lo.id) &&
            (!pushedIds.has(lo.id) || lo.status === 'Waiting') &&
            !deletedOrderIds.has(lo.id) &&
            !inFlightDeletedOrderIdsRef.current.has(lo.id)
        ),
      ];
      for (const uo of unsentLocalOrders) {
        try {
          const postRes = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(uo),
          });
          if (postRes.ok) {
            markOrderIdPushed(uo.id);
          }
        } catch {
          // retry next sync
        }
      }

      // Merge server orders + unsent local orders + latest local orders if a local mutation happened mid-sync
      const latestDeletedIds = loadDeletedOrderIds();
      const latestLocalOrders =
        syncEpochRef.current !== startEpoch ? loadOrders() : localOrders;
      const byId = new Map<string, OrderRecord>();
      for (const o of serverOrders) {
        if (!latestDeletedIds.has(o.id) && !inFlightDeletedOrderIdsRef.current.has(o.id)) {
          byId.set(o.id, o);
        }
      }
      for (const uo of unsentLocalOrders) {
        if (!latestDeletedIds.has(uo.id) && !inFlightDeletedOrderIdsRef.current.has(uo.id)) {
          byId.set(uo.id, uo);
        }
      }
      for (const lo of latestLocalOrders) {
        if (
          !latestDeletedIds.has(lo.id) &&
          !inFlightDeletedOrderIdsRef.current.has(lo.id) &&
          (inFlightOrderIdsRef.current.has(lo.id) ||
            syncEpochRef.current !== startEpoch ||
            !byId.has(lo.id))
        ) {
          byId.set(lo.id, lo);
        }
      }
      const sortedOrders = Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(sortedOrders);
      saveOrders(sortedOrders);

      // When Admin has Firestore connected, mirror newly synced customer timers/orders to Firestore
      if (sessionRef.current?.role === 'admin' && isCloudConnectedRef.current) {
        for (const ord of sortedOrders) {
          if (!cloudOrderIdsRef.current.has(ord.id)) {
            void upsertStoreOrder(ord).catch(() => {});
            if (ord.transactionId && ord.status !== 'Waiting' && ord.status !== 'Cancelled') {
              const normMethod: 'Nagad' | 'Rocket' | 'bKash' =
                ord.paymentMethod.toLowerCase().includes('rocket')
                  ? 'Rocket'
                  : ord.paymentMethod.toLowerCase().includes('bkash')
                  ? 'bKash'
                  : 'Nagad';
              void reserveUniqueTrxIdInFirestore({
                trxId: ord.transactionId,
                method: normMethod,
                orderId: ord.id,
                orderNumber: ord.orderNumber,
                userEmail: ord.userEmail,
                amountBdt: ord.priceBdt,
                status: ord.paymentFlag
                  ? 'flagged_mismatch'
                  : ord.paymentVerified || ord.status === 'Approved' || ord.status === 'Completed'
                  ? 'verified_approved'
                  : 'reserved_pending',
                usedAt: ord.confirmedAt || ord.createdAt,
              }).catch(() => {});
            }
          }
        }
      }

      // Sync verified/unlocked 15-day timer state both from server user record and Admin remote unlocks
      const activeSession = sessionRef.current;
      const currentTs = timerStateRef.current;
      if (activeSession) {
        const syncedActiveUser = syncedUsers.find(
          (u) => u.email.toLowerCase() === activeSession.email.toLowerCase()
        );
        const srvTimer = syncedActiveUser?.verificationTimer;

        if (!currentTs.isGroupVerified && !isSwitchingUsernameRef.current) {
          if (srvTimer?.isGroupVerified && srvTimer.verifiedAtMs > 0) {
            setTimerState(srvTimer);
            saveTimerState(activeSession, srvTimer);
            setRemainingSeconds(
              Math.max(0, Math.ceil((srvTimer.unlockAtMs - Date.now()) / 1000))
            );
          } else if (srvTimer === undefined) {
            const recoverableOrder = sortedOrders.find(
              (o) =>
                o.userEmail.toLowerCase() === activeSession.email.toLowerCase() &&
                o.status !== 'Cancelled' &&
                typeof o.verifiedAtMs === 'number' &&
                o.verifiedAtMs > 0 &&
                typeof o.unlockAtMs === 'number' &&
                o.unlockAtMs > 0
            );
            if (recoverableOrder && recoverableOrder.verifiedAtMs && recoverableOrder.unlockAtMs) {
              const recovered: VerificationTimerState = {
                hasClickedGroupLink: true,
                isGroupVerified: true,
                verifiedAtMs: recoverableOrder.verifiedAtMs,
                unlockAtMs: recoverableOrder.unlockAtMs,
                robloxUsername: recoverableOrder.robloxUsername || 'Verified Member',
                robloxUserId: recoverableOrder.robloxUserId ?? null,
              };
              setTimerState(recovered);
              saveTimerState(activeSession, recovered);
              persistUserVerificationTimer(activeSession, recovered);
              setRemainingSeconds(
                Math.max(0, Math.ceil((recovered.unlockAtMs - Date.now()) / 1000))
              );
            }
          }
        } else if (currentTs.verifiedAtMs) {
          const mapTimer =
            syncedActiveUser?.verifiedRobloxTimers?.[
              currentTs.robloxUsername.trim().toLowerCase()
            ];
          const matchedSrv = sortedOrders.find(
            (o) =>
              o.userEmail.toLowerCase() === activeSession.email.toLowerCase() &&
              o.verifiedAtMs === currentTs.verifiedAtMs
          );
          const remoteUnlockMs =
            matchedSrv &&
            typeof matchedSrv.unlockAtMs === 'number' &&
            matchedSrv.unlockAtMs <= Date.now()
              ? matchedSrv.unlockAtMs
              : mapTimer?.isGroupVerified &&
                mapTimer.verifiedAtMs === currentTs.verifiedAtMs &&
                mapTimer.unlockAtMs <= Date.now()
              ? mapTimer.unlockAtMs
              : srvTimer?.isGroupVerified &&
                srvTimer.verifiedAtMs === currentTs.verifiedAtMs &&
                srvTimer.unlockAtMs <= Date.now()
              ? srvTimer.unlockAtMs
              : null;
          if (remoteUnlockMs !== null && currentTs.unlockAtMs > Date.now()) {
            const unlockedState: VerificationTimerState = {
              ...currentTs,
              unlockAtMs: remoteUnlockMs,
            };
            setTimerState(unlockedState);
            saveTimerState(activeSession, unlockedState);
            persistUserVerificationTimer(activeSession, unlockedState);
            setRemainingSeconds(0);
          }
        }
      }

      // Sync packages safely: NEVER overwrite custom local additions with reset server defaults!
      const defaultIds = new Set(DEFAULT_ROBUX_PACKAGES.map((p) => p.id));
      const pushedPkgIds = loadPushedPackageIds();
      const deletedPkgIds = loadDeletedPackageIds();
      const localPackages = loadPackages();
      const serverPackagesRaw = Array.isArray(serverData.packages)
        ? serverData.packages
        : [];

      // If any package was explicitly deleted locally by Admin, propagate deletion to server
      if (sessionRef.current?.role === 'admin' && adminTokenRef.current) {
        for (const sp of serverPackagesRaw) {
          if (deletedPkgIds.has(sp.id)) {
            await fetch(`/api/packages/${encodeURIComponent(sp.id)}`, {
              method: 'DELETE',
              headers: getAdminAuthHeaders(false),
            }).catch(() => {});
          }
        }
      }

      const serverPackages = serverPackagesRaw.filter(
        (sp) =>
          !deletedPkgIds.has(sp.id) &&
          !inFlightDeletedPackageIdsRef.current.has(sp.id)
      );
      const serverPkgMap = new Map<string, RobuxPackage>();
      for (const sp of serverPackages) {
        serverPkgMap.set(sp.id, sp);
      }

      // Push any local custom/dirty packages that are missing on server (only when Admin is authenticated)
      const packagesToPush =
        sessionRef.current?.role === 'admin' && adminTokenRef.current
          ? localPackages.filter((lp) => {
              if (deletedPkgIds.has(lp.id) || inFlightDeletedPackageIdsRef.current.has(lp.id)) {
                return false;
              }
              const onServer = serverPkgMap.get(lp.id);
              if (!onServer) {
                return !pushedPkgIds.has(lp.id) || !defaultIds.has(lp.id);
              }
              return !pushedPkgIds.has(lp.id);
            })
          : [];

      for (const mp of packagesToPush) {
        try {
          const postRes = await fetch('/api/packages', {
            method: 'POST',
            headers: getAdminAuthHeaders(),
            body: JSON.stringify(mp),
          });
          if (postRes.ok) {
            markPackageIdPushed(mp.id);
          }
        } catch {
          // retry next sync
        }
      }

      // Only update packages from Express when Firestore hasn't taken over as cloud catalog
      if (cloudPackagesCountRef.current === 0) {
        const mergedPkgMap = new Map<string, RobuxPackage>();
        for (const sp of serverPackages) {
          mergedPkgMap.set(sp.id, sp);
        }
        for (const lp of localPackages) {
          if (
            !deletedPkgIds.has(lp.id) &&
            !inFlightDeletedPackageIdsRef.current.has(lp.id) &&
            (!mergedPkgMap.has(lp.id) ||
              inFlightPackageIdsRef.current.has(lp.id) ||
              !pushedPkgIds.has(lp.id))
          ) {
            mergedPkgMap.set(lp.id, lp);
          }
        }
        const mergedPackages = Array.from(mergedPkgMap.values()).sort(
          (a, b) => a.robux - b.robux
        );
        if (mergedPackages.length > 0) {
          setPackages(mergedPackages);
          savePackages(mergedPackages);
        }
      }

      if (
        !inFlightGroupSettingsRef.current &&
        serverData.groupSettings &&
        typeof serverData.groupSettings.groupId === 'number' &&
        serverData.groupSettings.groupUrl
      ) {
        const serverTs = serverData.groupSettings.updatedAtMs ?? 0;
        if (serverTs >= latestGroupSettingsTsRef.current) {
          latestGroupSettingsTsRef.current = serverTs;
          setGroupSettings(serverData.groupSettings);
          saveGroupSettings(serverData.groupSettings);
        }
      }
    } catch {
      // Keep localStorage fallback cleanly if offline
    } finally {
      isSyncingRef.current = false;
    }
  }, [getAdminAuthHeaders, persistUserVerificationTimer]);

  useEffect(() => {
    void syncFromServer();

    const handleStorageChange = () => {
      const deleted = loadDeletedOrderIds();
      setPackages(loadPackages());
      setOrders(loadOrders().filter((o) => !deleted.has(o.id)));
      setUsers(loadUsers());
      setGroupSettings(loadGroupSettings());
    };

    const handleFocus = () => {
      handleStorageChange();
      void syncFromServer();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [syncFromServer]);

  useEffect(() => {
    if (session) {
      void syncFromServer();
    }
    const poll = window.setInterval(
      () => {
        void syncFromServer();
      },
      session ? 5000 : 10000
    );
    return () => window.clearInterval(poll);
  }, [session, syncFromServer]);

  // Cloud Firestore real-time persistence subscriptions
  const syncAllToFirestore = useCallback(async () => {
    if (!isCloudConnectedRef.current) return;
    setIsSyncingCloud(true);
    try {
      const currentPkgs = packagesRef.current;
      for (const pkg of currentPkgs) {
        await upsertStorePackage(pkg);
      }
      await saveStoreGroupSettings(groupSettingsRef.current);
      const deletedOrders = loadDeletedOrderIds();
      const currentOrders = ordersRef.current;
      for (const ord of currentOrders) {
        if (!deletedOrders.has(ord.id) && !inFlightDeletedOrderIdsRef.current.has(ord.id)) {
          await upsertStoreOrder(ord);
          if (ord.transactionId && ord.status !== 'Waiting' && ord.status !== 'Cancelled') {
            const normMethod: 'Nagad' | 'Rocket' | 'bKash' =
              ord.paymentMethod.toLowerCase().includes('rocket')
                ? 'Rocket'
                : ord.paymentMethod.toLowerCase().includes('bkash')
                ? 'bKash'
                : 'Nagad';
            await reserveUniqueTrxIdInFirestore({
              trxId: ord.transactionId,
              method: normMethod,
              orderId: ord.id,
              orderNumber: ord.orderNumber,
              userEmail: ord.userEmail,
              amountBdt: ord.priceBdt,
              status: ord.paymentFlag
                ? 'flagged_mismatch'
                : ord.paymentVerified || ord.status === 'Approved' || ord.status === 'Completed'
                ? 'verified_approved'
                : 'reserved_pending',
              usedAt: ord.confirmedAt || ord.createdAt,
            }).catch(() => {});
          }
        }
      }
      for (const logItem of paymentSecurityLogsRef.current.slice(0, 60)) {
        await upsertPaymentSecurityLog(logItem).catch(() => {});
      }
    } catch {
      // Handled via handleFirestoreError logs
    } finally {
      setIsSyncingCloud(false);
    }
  }, []);

  useEffect(() => {
    const unsubAuth = subscribeFirebaseAuth((user) => {
      setFirebaseUser(user);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    const unsubPkgs = subscribeStorePackages((cloudPackages) => {
      cloudPackagesCountRef.current = cloudPackages.length;
      if (cloudPackages.length === 0) return;

      const deletedIds = loadDeletedPackageIds();
      const map = new Map<string, RobuxPackage>();
      for (const cp of cloudPackages) {
        if (!inFlightDeletedPackageIdsRef.current.has(cp.id) && !deletedIds.has(cp.id)) {
          map.set(cp.id, cp);
          markPackageIdPushed(cp.id);
        }
      }
      for (const lp of packagesRef.current) {
        if (inFlightPackageIdsRef.current.has(lp.id)) {
          map.set(lp.id, lp);
        }
      }
      const next = Array.from(map.values()).sort((a, b) => a.robux - b.robux);
      if (next.length > 0) {
        setPackages(next);
        savePackages(next);
      }
    });

    const unsubSettings = subscribeStoreSettings((cloudSettings) => {
      if (!cloudSettings || inFlightGroupSettingsRef.current) return;
      const cloudTs = cloudSettings.updatedAtMs ?? 0;
      if (cloudTs < latestGroupSettingsTsRef.current) return;
      latestGroupSettingsTsRef.current = cloudTs;
      setGroupSettings(cloudSettings);
      saveGroupSettings(cloudSettings);
    });

    return () => {
      unsubPkgs();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin || !isCloudConnected) return;
    void syncAllToFirestore();

    const unsubOrders = subscribeStoreOrders((cloudOrders) => {
      const deletedIds = loadDeletedOrderIds();
      const seenCloudIds = new Set<string>();
      const byId = new Map<string, OrderRecord>();
      for (const co of cloudOrders) {
        if (deletedIds.has(co.id) || inFlightDeletedOrderIdsRef.current.has(co.id)) {
          // Purge previously deleted orders from Firestore permanently so they never come back
          void removeStoreOrder(co.id).catch(() => {});
          continue;
        }
        seenCloudIds.add(co.id);
        byId.set(co.id, co);
        markOrderIdPushed(co.id);
      }
      cloudOrderIdsRef.current = seenCloudIds;
      for (const lo of ordersRef.current) {
        if (deletedIds.has(lo.id) || inFlightDeletedOrderIdsRef.current.has(lo.id)) {
          continue;
        }
        if (inFlightOrderIdsRef.current.has(lo.id) || !byId.has(lo.id)) {
          byId.set(lo.id, lo);
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(merged);
      saveOrders(merged);
    });

    const unsubSecurityLogs = subscribePaymentSecurityLogs((cloudLogs) => {
      setPaymentSecurityLogs((prev) => {
        const byId = new Map<string, PaymentSecurityLog>();
        for (const item of cloudLogs) byId.set(item.id, item);
        for (const item of prev) {
          if (!byId.has(item.id)) byId.set(item.id, item);
        }
        return Array.from(byId.values())
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 250);
      });
    });

    return () => {
      unsubOrders();
      unsubSecurityLogs();
    };
  }, [isAdmin, isCloudConnected, syncAllToFirestore]);

  useEffect(() => {
    if (!isAdmin || !isCloudConnected || !firebaseUser || adminToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const firebaseIdToken = await firebaseUser.getIdToken();
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firebaseIdToken }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => ({}))) as { token?: string };
        if (data.token && !cancelled) {
          adminTokenRef.current = data.token;
          setAdminToken(data.token);
          void syncFromServer();
        }
      } catch {
        // Admin can still sign in manually when prompted
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isCloudConnected, firebaseUser, adminToken, syncFromServer]);

  const handleConnectCloud = async (forceSelect = false) => {
    try {
      await signInAdminWithGoogle(forceSelect);
    } catch {
      // Popup closed or blocked
    }
  };

  // Auth Handlers
  const handleOpenAuth = (
    mode: AuthModalMode = 'signin',
    notice: string | null = null
  ) => {
    setAuthModalMode(mode);
    setAuthNotice(notice);
    setIsAuthModalOpen(true);
  };

  const promptAdminReauthIfNeeded = (res: Response): boolean => {
    if (res.status === 401) {
      adminTokenRef.current = null;
      setAdminToken(null);
      handleOpenAuth(
        'admin',
        'Admin server authorization expired or is missing. Enter your Admin password to continue.'
      );
      return true;
    }
    return false;
  };

  const handleUserSignIn = (user: RegisteredUser) => {
    const nextSession: SessionState = { role: 'user', email: user.email };
    setSession(nextSession);
    saveSession(nextSession);
    setAuthNotice(null);
    if (pendingCheckoutAfterAuth) {
      setPendingCheckoutAfterAuth(false);
      setIsCheckoutModalOpen(true);
    }
  };

  const handleUserSignUp = (newUser: RegisteredUser) => {
    const stampedNewUser: RegisteredUser = {
      ...newUser,
      updatedAtMs: Date.now(),
    };
    const updatedUsers = [...users, stampedNewUser];
    setUsers(updatedUsers);
    saveUsers(updatedUsers);
    const nextSession: SessionState = { role: 'user', email: stampedNewUser.email };
    setSession(nextSession);
    saveSession(nextSession);
    setAuthNotice(null);
    void fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stampedNewUser),
    }).catch(() => {});
    if (pendingCheckoutAfterAuth) {
      setPendingCheckoutAfterAuth(false);
      setIsCheckoutModalOpen(true);
    }
  };

  const handleAdminSignIn = (email: string, token: string) => {
    adminTokenRef.current = token;
    setAdminToken(token);
    const nextSession: SessionState = { role: 'admin', email };
    setSession(nextSession);
    saveSession(nextSession);
    setAuthNotice(null);
    void syncFromServer();
    if (pendingCheckoutAfterAuth) {
      setPendingCheckoutAfterAuth(false);
      setIsCheckoutModalOpen(true);
    }
  };

  const handleSignOut = () => {
    isSwitchingUsernameRef.current = false;
    adminTokenRef.current = null;
    setAdminToken(null);
    setVerifiedPayments([]);
    setPaymentSecurityLogs([]);
    setSession(null);
    saveSession(null);
    setTimerState({ ...EMPTY_TIMER_STATE });
    setRemainingSeconds(0);
    setIsProfileModalOpen(false);
    setIsCheckoutModalOpen(false);
    setPendingCheckoutAfterAuth(false);
    setSelectedPaymentId(null);
    setOrderReceipt(null);
  };

  const handleSaveProfile = (updated: RegisteredUser) => {
    const previousEmail = currentUser?.email;
    const stamped: RegisteredUser = {
      ...updated,
      verificationTimer:
        updated.verificationTimer ??
        (timerState.isGroupVerified ? timerState : undefined),
      verifiedRobloxTimers: updated.verifiedRobloxTimers ?? currentUser?.verifiedRobloxTimers,
      updatedAtMs: Date.now(),
    };

    inFlightUserIdsRef.current.add(stamped.id);
    setUsers((prev) => {
      const next = prev.map((u) =>
        u.id === stamped.id ||
        (previousEmail && u.email.toLowerCase() === previousEmail.toLowerCase())
          ? stamped
          : u
      );
      saveUsers(next);
      return next;
    });

    const nextSession: SessionState = { role: 'user', email: stamped.email };
    if (
      previousEmail &&
      previousEmail.toLowerCase() !== stamped.email.toLowerCase() &&
      timerState.isGroupVerified
    ) {
      saveTimerState(nextSession, timerState);
    }
    setSession(nextSession);
    saveSession(nextSession);

    void (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(stamped.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: stamped.name,
            email: stamped.email,
            phone: stamped.phone,
            password: stamped.password,
            avatar: stamped.avatar ?? '',
            verificationTimer: stamped.verificationTimer,
            verifiedRobloxTimers: stamped.verifiedRobloxTimers,
            updatedAtMs: stamped.updatedAtMs,
          }),
        });
        if (res.ok) {
          const savedFromServer = (await res.json()) as RegisteredUser;
          setUsers((prev) => {
            const next = prev.map((u) =>
              u.id === stamped.id || u.id === savedFromServer.id
                ? savedFromServer
                : u
            );
            saveUsers(next);
            return next;
          });
        }
      } catch {
        // Preserved in localStorage; syncFromServer will push when online
      } finally {
        inFlightUserIdsRef.current.delete(stamped.id);
      }
    })();

    const matchingUserOrders = orders.filter(
      (o) =>
        previousEmail &&
        o.userEmail.toLowerCase() === previousEmail.toLowerCase()
    );
    if (matchingUserOrders.length > 0) {
      const nextOrders = orders.map((o) =>
        previousEmail &&
        o.userEmail.toLowerCase() === previousEmail.toLowerCase()
          ? {
              ...o,
              userEmail: updated.email,
              userName: updated.name,
              userPhone: updated.phone,
            }
          : o
      );
      setOrders(nextOrders);
      saveOrders(nextOrders);
      for (const ord of matchingUserOrders) {
        inFlightOrderIdsRef.current.add(ord.id);
        void fetch(`/api/orders/${encodeURIComponent(ord.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userEmail: updated.email,
            userName: updated.name,
            userPhone: updated.phone,
          }),
        })
          .catch(() => {})
          .finally(() => {
            inFlightOrderIdsRef.current.delete(ord.id);
          });
      }
    }
  };

  // Admin Handlers (localStorage + authenticated Express /api sync + Firestore Cloud sync)
  const handleAddPackage = async (pkg: RobuxPackage) => {
    clearPackageIdDeleted(pkg.id);
    inFlightPackageIdsRef.current.add(pkg.id);
    const next = [...packages, pkg].sort((a, b) => a.robux - b.robux);
    setPackages(next);
    savePackages(next);
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify(pkg),
      });
      if (!promptAdminReauthIfNeeded(res) && res.ok) {
        markPackageIdPushed(pkg.id);
      }
    } catch {
      // preserved in localStorage
    }
    if (isCloudConnectedRef.current) {
      await upsertStorePackage(pkg).catch(() => {});
    }
    inFlightPackageIdsRef.current.delete(pkg.id);
  };

  const handleUpdatePackage = async (updatedPkg: RobuxPackage) => {
    inFlightPackageIdsRef.current.add(updatedPkg.id);
    const next = packages.map((p) => (p.id === updatedPkg.id ? updatedPkg : p));
    setPackages(next);
    savePackages(next);
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(updatedPkg.id)}`, {
        method: 'PATCH',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify({
          priceBdt: updatedPkg.priceBdt,
          deliveryNote: updatedPkg.deliveryNote,
          image: updatedPkg.image,
        }),
      });
      if (promptAdminReauthIfNeeded(res)) {
        // Re-auth modal triggered
      } else if (res.status === 404) {
        const postRes = await fetch('/api/packages', {
          method: 'POST',
          headers: getAdminAuthHeaders(),
          body: JSON.stringify(updatedPkg),
        });
        if (postRes.ok) markPackageIdPushed(updatedPkg.id);
      } else if (res.ok) {
        markPackageIdPushed(updatedPkg.id);
      }
    } catch {
      // preserved in localStorage
    }
    if (isCloudConnectedRef.current) {
      await upsertStorePackage(updatedPkg).catch(() => {});
    }
    inFlightPackageIdsRef.current.delete(updatedPkg.id);
  };

  const handleDeletePackage = async (id: string) => {
    inFlightDeletedPackageIdsRef.current.add(id);
    markPackageIdDeleted(id);
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    savePackages(next);
    if (selectedPackageId === id && next.length > 0) {
      setSelectedPackageId(next[0].id);
    }
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAdminAuthHeaders(false),
      });
      promptAdminReauthIfNeeded(res);
    } catch {
      // preserved in localStorage
    }
    if (isCloudConnectedRef.current) {
      await removeStorePackage(id).catch(() => {});
    }
    inFlightDeletedPackageIdsRef.current.delete(id);
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus) => {
    inFlightOrderIdsRef.current.add(orderId);
    syncEpochRef.current += 1;
    const isConfirmed = status === 'Approved' || status === 'Completed';
    const existingOrder = ordersRef.current.find((o) => o.id === orderId);
    const optimisticConfirmedAt = isConfirmed
      ? existingOrder?.confirmedAt || new Date().toISOString()
      : existingOrder?.confirmedAt;
    const nextOrder: OrderRecord | null = existingOrder
      ? {
          ...existingOrder,
          status,
          paymentVerified: isConfirmed ? true : existingOrder.paymentVerified,
          paymentFlag: isConfirmed ? undefined : existingOrder.paymentFlag,
          paymentFlagReason: isConfirmed ? undefined : existingOrder.paymentFlagReason,
          confirmedAt: optimisticConfirmedAt,
        }
      : null;
    const next = ordersRef.current.map((o) =>
      o.id === orderId && nextOrder ? nextOrder : o
    );
    setOrders(next);
    saveOrders(next);

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify({ status, adminAction: true }),
      });

      let savedPayload: OrderRecord | null = null;
      if (promptAdminReauthIfNeeded(res)) {
        // Re-auth modal triggered
      } else if (res.status === 404 && nextOrder) {
        const postRes = await fetch('/api/orders', {
          method: 'POST',
          headers: getAdminAuthHeaders(),
          body: JSON.stringify({ ...nextOrder, adminAction: true }),
        });
        if (!promptAdminReauthIfNeeded(postRes) && postRes.ok) {
          markOrderIdPushed(orderId);
          savedPayload = (await postRes.json().catch(() => null)) as OrderRecord | null;
        }
      } else if (res.ok) {
        markOrderIdPushed(orderId);
        savedPayload = (await res.json().catch(() => null)) as OrderRecord | null;
      }

      if (savedPayload) {
        const mergedSaved: OrderRecord = {
          ...(nextOrder || savedPayload),
          ...savedPayload,
          status: normalizeOrderStatus(savedPayload.status),
        };
        const syncedOrders = ordersRef.current.map((o) =>
          o.id === orderId ? mergedSaved : o
        );
        setOrders(syncedOrders);
        saveOrders(syncedOrders);
      }

      if (isCloudConnectedRef.current && nextOrder) {
        await upsertStoreOrder(nextOrder).catch(() => {});
        if (nextOrder.transactionId && isConfirmed) {
          const normMethod: 'Nagad' | 'Rocket' | 'bKash' =
            nextOrder.paymentMethod.toLowerCase().includes('rocket')
              ? 'Rocket'
              : nextOrder.paymentMethod.toLowerCase().includes('bkash')
              ? 'bKash'
              : 'Nagad';
          await reserveUniqueTrxIdInFirestore({
            trxId: nextOrder.transactionId,
            method: normMethod,
            orderId: nextOrder.id,
            orderNumber: nextOrder.orderNumber,
            userEmail: nextOrder.userEmail,
            amountBdt: nextOrder.priceBdt,
            status: 'verified_approved',
            usedAt: optimisticConfirmedAt,
          }).catch(() => {});
        }
      }
    } catch {
      // offline fallback preserved
    } finally {
      inFlightOrderIdsRef.current.delete(orderId);
    }
  };

  const handleUnlockOrderTimer = async (orderId: string) => {
    const nowMs = Date.now();
    inFlightOrderIdsRef.current.add(orderId);
    syncEpochRef.current += 1;
    const existingOrder = orders.find((o) => o.id === orderId);
    const nextOrder = existingOrder
      ? { ...existingOrder, unlockAtMs: nowMs }
      : null;
    const next = orders.map((o) =>
      o.id === orderId ? { ...o, unlockAtMs: nowMs } : o
    );
    setOrders(next);
    saveOrders(next);

    // Also mark that customer's saved verificationTimer unlocked so future orders require no timer
    if (existingOrder?.userEmail) {
      const emailLower = existingOrder.userEmail.toLowerCase();
      const targetUser = usersRef.current.find(
        (u) => u.email.toLowerCase() === emailLower
      );
      if (targetUser) {
        const resolvedUsername =
          existingOrder.robloxUsername || targetUser.verificationTimer?.robloxUsername || 'Verified Member';
        const nextUserTimer: VerificationTimerState = {
          hasClickedGroupLink: true,
          isGroupVerified: true,
          verifiedAtMs: existingOrder.verifiedAtMs || targetUser.verificationTimer?.verifiedAtMs || nowMs,
          unlockAtMs: nowMs,
          robloxUsername: resolvedUsername,
          robloxUserId: existingOrder.robloxUserId ?? targetUser.verificationTimer?.robloxUserId ?? null,
        };
        const nextMap: Record<string, VerificationTimerState> = {
          ...(targetUser.verifiedRobloxTimers || {}),
        };
        if (resolvedUsername.trim()) {
          nextMap[resolvedUsername.trim().toLowerCase()] = nextUserTimer;
        }
        const updatedAtMs = Date.now();
        const updatedUser: RegisteredUser = {
          ...targetUser,
          verificationTimer: nextUserTimer,
          verifiedRobloxTimers: nextMap,
          updatedAtMs,
        };
        const nextUsers = usersRef.current.map((u) =>
          u.id === updatedUser.id ? updatedUser : u
        );
        setUsers(nextUsers);
        saveUsers(nextUsers);
        void fetch(`/api/users/${encodeURIComponent(updatedUser.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: updatedUser.name,
            email: updatedUser.email,
            phone: updatedUser.phone,
            password: updatedUser.password,
            avatar: updatedUser.avatar ?? '',
            verificationTimer: nextUserTimer,
            verifiedRobloxTimers: nextMap,
            updatedAtMs,
          }),
        }).catch(() => {});
      }
    }

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify({ unlockAtMs: nowMs, adminAction: true }),
      });
      if (promptAdminReauthIfNeeded(res)) {
        // Re-auth modal triggered
      } else if (res.status === 404 && nextOrder) {
        const postRes = await fetch('/api/orders', {
          method: 'POST',
          headers: getAdminAuthHeaders(),
          body: JSON.stringify({ ...nextOrder, adminAction: true }),
        });
        if (postRes.ok) markOrderIdPushed(orderId);
      } else if (res.ok) {
        markOrderIdPushed(orderId);
      }
      if (isCloudConnectedRef.current && nextOrder) {
        await upsertStoreOrder(nextOrder).catch(() => {});
      }
    } catch {
      // offline fallback preserved
    } finally {
      inFlightOrderIdsRef.current.delete(orderId);
    }
  };

  const handleDeleteOrder = (orderId: string) => {
    inFlightDeletedOrderIdsRef.current.add(orderId);
    syncEpochRef.current += 1;
    markOrderIdDeleted(orderId);
    const next = orders.filter((o) => o.id !== orderId);
    setOrders(next);
    saveOrders(next);
    void fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
      headers: getAdminAuthHeaders(false),
    })
      .then((res) => {
        promptAdminReauthIfNeeded(res);
      })
      .catch(() => {})
      .finally(async () => {
        if (isCloudConnectedRef.current) {
          await removeStoreOrder(orderId).catch(() => {});
        }
        inFlightDeletedOrderIdsRef.current.delete(orderId);
      });
  };

  const handleSaveGroupSettings = async (settings: GroupSettings) => {
    const stamped: GroupSettings = {
      ...settings,
      updatedAtMs: Date.now(),
    };
    inFlightGroupSettingsRef.current = true;
    latestGroupSettingsTsRef.current = stamped.updatedAtMs ?? Date.now();
    setGroupSettings(stamped);
    saveGroupSettings(stamped);
    try {
      const res = await fetch('/api/group-settings', {
        method: 'PUT',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify(stamped),
      }).catch(() => null);
      if (res) {
        promptAdminReauthIfNeeded(res);
      }
      if (isCloudConnectedRef.current) {
        await saveStoreGroupSettings(stamped).catch(() => {});
      }
    } finally {
      inFlightGroupSettingsRef.current = false;
    }
  };

  const handleAddVerifiedPayment = async (payload: {
    method: 'Nagad' | 'Rocket' | 'bKash';
    trxId: string;
    amountBdt: number;
    senderPhone?: string;
  }): Promise<{ ok: boolean; error?: string; autoApprovedOrder?: string | null }> => {
    try {
      const res = await fetch('/api/payments/ledger', {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (promptAdminReauthIfNeeded(res)) {
        return { ok: false, error: 'Admin password required to record payment ledger entries.' };
      }
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? ((await res.json().catch(() => ({}))) as {
            error?: string;
            autoApprovedOrder?: string | null;
          })
        : {};
      if (!res.ok) {
        return { ok: false, error: data.error || 'Could not save payment record.' };
      }
      await syncFromServer();
      return { ok: true, autoApprovedOrder: data.autoApprovedOrder ?? null };
    } catch {
      return { ok: false, error: 'Network error while saving payment record.' };
    }
  };

  const handleDeleteVerifiedPayment = async (id: string) => {
    setVerifiedPayments((prev) => prev.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/payments/ledger/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAdminAuthHeaders(false),
      });
      promptAdminReauthIfNeeded(res);
    } catch {
      // ignore offline
    }
    await syncFromServer();
  };

  // Shop / Real-Time Roblox API Verification / Checkout Handlers
  const requireSignInPrompt = () => {
    handleOpenAuth(
      'signin',
      'Please sign in or create an account to verify your Roblox membership and buy Robux.'
    );
  };

  const handleBuyNow = (pkg: RobuxPackage) => {
    setSelectedPackageId(pkg.id);
    setErrorMessage(null);
    setOrderReceipt(null);

    if (!session) {
      setPendingCheckoutAfterAuth(true);
      requireSignInPrompt();
      return;
    }

    // If customer is currently waiting on a 15-day hold, keep their Waiting order's package up-to-date
    if (timerState.isGroupVerified && timerState.verifiedAtMs) {
      const userEmail = currentUser ? currentUser.email : session.email;
      const waitingOrd = orders.find(
        (o) =>
          o.userEmail.toLowerCase() === userEmail.toLowerCase() &&
          o.verifiedAtMs === timerState.verifiedAtMs &&
          o.status === 'Waiting'
      );
      if (waitingOrd) {
        const nextOrders = orders.map((o) =>
          o.id === waitingOrd.id
            ? {
                ...o,
                packageId: pkg.id,
                packageTitle: pkg.title,
                robuxAmount: pkg.robux,
                priceBdt: pkg.priceBdt,
              }
            : o
        );
        setOrders(nextOrders);
        saveOrders(nextOrders);
        void fetch(`/api/orders/${encodeURIComponent(waitingOrd.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packageId: pkg.id,
            packageTitle: pkg.title,
            robuxAmount: pkg.robux,
            priceBdt: pkg.priceBdt,
          }),
        }).catch(() => {});
      }
    }

    setIsCheckoutModalOpen(true);

    if (timerState.isGroupVerified) {
      void verifyStillMemberInBackground(timerState, groupSettings.groupId);
    }
  };

  const handleGroupLinkClick = () => {
    if (!session) {
      requireSignInPrompt();
      return;
    }
    updateTimerState((prev) => ({ ...prev, hasClickedGroupLink: true }));
    if (errorMessage === CLICK_REQUIRED_ERROR) {
      setErrorMessage(null);
    }
  };

  const handleUsernameChange = (value: string) => {
    if (!session) return;
    updateTimerState((prev) => ({
      ...prev,
      robloxUsername: value.slice(0, 32),
      robloxUserId: null,
    }));
  };

  const handleVerifyMembership = async () => {
    if (!session) {
      requireSignInPrompt();
      return;
    }

    if (!timerState.hasClickedGroupLink) {
      setErrorMessage(CLICK_REQUIRED_ERROR);
      return;
    }

    const cleanName = timerState.robloxUsername.trim();
    if (!cleanName) {
      setErrorMessage('Please enter your Roblox username before verifying membership.');
      return;
    }

    setErrorMessage(null);
    setIsVerifyingApi(true);

    const outcome = await verifyRobloxMembership(cleanName, groupSettings.groupId);
    setIsVerifyingApi(false);

    if (outcome.status === 'user_not_found') {
      setErrorMessage(outcome.message);
      return;
    }

    if (outcome.status === 'not_joined') {
      setErrorMessage(NOT_JOINED_ERROR);
      return;
    }

    // If live Roblox CORS proxy is blocked/offline in sandbox, gracefully fall back to simulated verification
    if (outcome.status === 'network_error') {
      if (cleanName.length < 3) {
        setErrorMessage('Please enter a valid Roblox username (at least 3 characters).');
        return;
      }
      const existingCompletedTimer = findSavedTimerForRobloxAccount(cleanName, null);
      const nowMs = Date.now();
      const verifiedAtMs = existingCompletedTimer?.verifiedAtMs || nowMs;
      const unlockAtMs =
        existingCompletedTimer?.unlockAtMs ?? nowMs + FIFTEEN_DAYS_SECONDS * 1000;
      const nextTimer: VerificationTimerState = {
        hasClickedGroupLink: true,
        isGroupVerified: true,
        verifiedAtMs,
        unlockAtMs,
        robloxUsername: existingCompletedTimer?.robloxUsername || cleanName,
        robloxUserId: existingCompletedTimer?.robloxUserId ?? null,
      };
      isSwitchingUsernameRef.current = false;
      setErrorMessage(null);
      setRemainingSeconds(Math.max(0, Math.ceil((unlockAtMs - nowMs) / 1000)));
      setTimerState(nextTimer);
      saveTimerState(session, nextTimer);
      persistUserVerificationTimer(session, nextTimer);
      if (unlockAtMs > nowMs) {
        void registerWaitingOrder(nextTimer, selectedPackage);
      }
      return;
    }

    // Verified Member -> only reuse saved/completed timer if THIS exact Roblox account already verified/completed 15 days;
    // any NEW Roblox username starts a fresh 15-day timer.
    const existingSavedTimer = findSavedTimerForRobloxAccount(
      outcome.username,
      outcome.userId
    );
    const nowMs = Date.now();
    const verifiedAtMs = existingSavedTimer?.verifiedAtMs || nowMs;
    const unlockAtMs =
      existingSavedTimer?.unlockAtMs ?? nowMs + FIFTEEN_DAYS_SECONDS * 1000;
    const nextTimer: VerificationTimerState = {
      hasClickedGroupLink: true,
      isGroupVerified: true,
      verifiedAtMs,
      unlockAtMs,
      robloxUsername: outcome.username,
      robloxUserId: outcome.userId,
    };
    isSwitchingUsernameRef.current = false;
    setErrorMessage(null);
    setRemainingSeconds(Math.max(0, Math.ceil((unlockAtMs - nowMs) / 1000)));
    setTimerState(nextTimer);
    saveTimerState(session, nextTimer);
    persistUserVerificationTimer(session, nextTimer);
    if (unlockAtMs > nowMs) {
      void registerWaitingOrder(nextTimer, selectedPackage);
    }
  };

  const handleSwitchRobloxUsername = () => {
    if (!session) return;
    isSwitchingUsernameRef.current = true;
    const switched: VerificationTimerState = {
      ...EMPTY_TIMER_STATE,
      hasClickedGroupLink: false,
    };
    setTimerState(switched);
    saveTimerState(session, switched);
    setRemainingSeconds(FIFTEEN_DAYS_SECONDS);
    setErrorMessage(null);
    setPaymentError(null);
    setSelectedPaymentId(null);
    setOrderReceipt(null);
  };

  const handleSelectSavedUsername = (saved: VerificationTimerState) => {
    if (!session) return;
    isSwitchingUsernameRef.current = false;
    const nowMs = Date.now();
    setErrorMessage(null);
    setPaymentError(null);
    setSelectedPaymentId(null);
    setOrderReceipt(null);
    setTimerState(saved);
    saveTimerState(session, saved);
    persistUserVerificationTimer(session, saved);
    setRemainingSeconds(Math.max(0, Math.ceil((saved.unlockAtMs - nowMs) / 1000)));
    void verifyStillMemberInBackground(saved, groupSettings.groupId);
  };

  const handleAdminUnlockTimer = () => {
    if (!isAdmin) return;
    const nowMs = Date.now();
    const verifiedAt = timerState.verifiedAtMs || nowMs;
    const unlocked: VerificationTimerState = {
      hasClickedGroupLink: true,
      isGroupVerified: true,
      verifiedAtMs: verifiedAt,
      unlockAtMs: nowMs,
      robloxUsername: timerState.robloxUsername.trim() || 'Admin Override',
      robloxUserId: timerState.robloxUserId,
    };
    setErrorMessage(null);
    setTimerState(unlocked);
    saveTimerState(session, unlocked);
    persistUserVerificationTimer(session, unlocked);
    setRemainingSeconds(0);

    // Also update any matching Waiting order on server
    if (session) {
      const matching = orders.find(
        (o) =>
          o.userEmail.toLowerCase() === session.email.toLowerCase() &&
          o.verifiedAtMs === verifiedAt &&
          o.status === 'Waiting'
      );
      if (matching) {
        void handleUnlockOrderTimer(matching.id);
      }
    }
  };

  const handleStartAnotherOrder = () => {
    setErrorMessage(null);
    setPaymentError(null);
    setSelectedPaymentId(null);
    setOrderReceipt(null);
  };

  const handleCompleteOrder = async (transactionId: string, senderPhone?: string) => {
    if (!session) {
      requireSignInPrompt();
      return;
    }

    if (!selectedPackage) {
      setPaymentError('Please select a Robux package first.');
      return;
    }

    if (!selectedPaymentId) {
      setPaymentError('Please select Nagad, Rocket, or bKash before submitting.');
      return;
    }

    if (!isAdmin && (!timerState.isGroupVerified || remainingSeconds > 0)) {
      setPaymentError('Please complete Roblox group verification and the 15-day countdown first.');
      return;
    }

    // Hard check live Robux stock before submitting payment
    let liveAvailable = groupSettings?.availableRobux ?? 25400;
    try {
      const stockRes = await fetch('/api/store', { cache: 'no-store' });
      if (stockRes.ok) {
        const latestStore = (await stockRes.json()) as { groupSettings?: GroupSettings };
        if (
          latestStore.groupSettings &&
          typeof latestStore.groupSettings.availableRobux === 'number'
        ) {
          const serverTs = latestStore.groupSettings.updatedAtMs ?? 0;
          if (serverTs >= latestGroupSettingsTsRef.current) {
            latestGroupSettingsTsRef.current = serverTs;
            liveAvailable = latestStore.groupSettings.availableRobux;
            setGroupSettings(latestStore.groupSettings);
            saveGroupSettings(latestStore.groupSettings);
          }
        }
      }
    } catch {
      // handled below during atomic server submission
    }

    if (!isAdmin && (liveAvailable <= 0 || selectedPackage.robux > liveAvailable)) {
      setOutOfStockAlert({
        available: Math.max(0, liveAvailable),
        needed: selectedPackage.robux,
        packageTitle: selectedPackage.title,
      });
      return;
    }

    const cleanTrxId = transactionId.trim().toUpperCase();
    if (!cleanTrxId) {
      setPaymentError('Please enter your Transaction ID (TrxID) from your Nagad/Rocket SMS.');
      return;
    }
    const cleanSenderPhone = typeof senderPhone === 'string' ? senderPhone.trim() : '';

    setPaymentError(null);
    setIsSubmittingOrder(true);

    try {
      // Re-verify Roblox community membership automatically before completing payment
      if (!isAdmin && timerState.robloxUserId !== null) {
        setIsVerifyingApi(true);
        const stillJoined = await verifyStillMemberInBackground(
          timerState,
          groupSettings.groupId
        );
        setIsVerifyingApi(false);

        if (!stillJoined) {
          return;
        }
      }

      const option = PAYMENT_OPTIONS.find((item) => item.id === selectedPaymentId);
      const methodLabel = option ? option.name : 'Nagad';
      const userEmail = currentUser ? currentUser.email : session.email;

      const existingWaiting = orders.find(
        (o) =>
          o.userEmail.toLowerCase() === userEmail.toLowerCase() &&
          o.verifiedAtMs === timerState.verifiedAtMs &&
          o.status === 'Waiting'
      );

      const orderNumber = existingWaiting
        ? existingWaiting.orderNumber
        : `BM-${Math.floor(1000 + Math.random() * 9000)}`;

      // Fail-closed server-side payment verification & atomic unique-TrxID reservation
      const submitRes = await fetch('/api/payments/submit-order', {
        method: 'POST',
        headers: adminTokenRef.current
          ? {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminTokenRef.current}`,
            }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: methodLabel,
          trxId: cleanTrxId,
          senderPhone: cleanSenderPhone || undefined,
          packageId: selectedPackage.id,
          expectedAmountBdt: selectedPackage.priceBdt,
          userEmail,
          userName: currentUser ? currentUser.name : 'Store Admin',
          userPhone: currentUser ? currentUser.phone : '',
          robloxUsername:
            timerState.robloxUsername.trim() ||
            (isAdmin ? 'Admin Test' : 'Verified Member'),
          robloxUserId: timerState.robloxUserId,
          existingWaitingOrderId: existingWaiting?.id,
          orderNumber,
          verifiedAtMs: timerState.verifiedAtMs || undefined,
          unlockAtMs: timerState.unlockAtMs || undefined,
        }),
      });

      const contentType = submitRes.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setPaymentError(
          'Server payment verification is required and unavailable right now. No payment can be approved offline.'
        );
        return;
      }

      const submitData = (await submitRes.json().catch(() => ({}))) as {
        ok?: boolean;
        valid?: boolean;
        verified?: boolean;
        flagged?: boolean;
        flagMessage?: string;
        normalizedTrxId?: string;
        status?: OrderStatus;
        order?: OrderRecord;
        error?: string;
      };

      if (!submitRes.ok || !submitData.ok || !submitData.order) {
        setPaymentError(
          submitData.error ||
            'Payment verification failed. Please double-check your TrxID from 01764088123 and try again.'
        );
        return;
      }

      const savedOrder: OrderRecord = {
        ...submitData.order,
        status: normalizeOrderStatus(submitData.order.status),
        priceBdt: Number(submitData.order.priceBdt) || selectedPackage.priceBdt,
        robuxAmount: Number(submitData.order.robuxAmount) || selectedPackage.robux,
        paymentVerified: Boolean(submitData.verified),
      };

      markOrderIdPushed(savedOrder.id);
      syncEpochRef.current += 1;
      const nextOrders = existingWaiting
        ? orders.map((o) => (o.id === existingWaiting.id ? savedOrder : o))
        : [savedOrder, ...orders.filter((o) => o.id !== savedOrder.id)];
      setOrders(nextOrders);
      saveOrders(nextOrders);

      setOrderReceipt({
        orderId: savedOrder.orderNumber,
        method: methodLabel,
        transactionId: submitData.normalizedTrxId || savedOrder.transactionId || cleanTrxId,
        verified: Boolean(submitData.verified),
        flagged: Boolean(submitData.flagged),
        flagMessage: submitData.flagMessage,
      });

      if (isCloudConnectedRef.current) {
        void upsertStoreOrder(savedOrder).catch(() => {});
        const normMethod: 'Nagad' | 'Rocket' | 'bKash' =
          methodLabel.toLowerCase().includes('rocket')
            ? 'Rocket'
            : methodLabel.toLowerCase().includes('bkash')
            ? 'bKash'
            : 'Nagad';
        void reserveUniqueTrxIdInFirestore({
          trxId: submitData.normalizedTrxId || cleanTrxId,
          method: normMethod,
          orderId: savedOrder.id,
          orderNumber: savedOrder.orderNumber,
          userEmail: savedOrder.userEmail,
          amountBdt: savedOrder.priceBdt,
          status: submitData.flagged
            ? 'flagged_mismatch'
            : submitData.verified
            ? 'verified_approved'
            : 'reserved_pending',
          usedAt: savedOrder.confirmedAt || savedOrder.createdAt,
        }).catch(() => {});
      }

      void syncFromServer();
    } catch {
      setPaymentError(
        'Unable to reach server payment verification right now. No payment can be approved without server verification.'
      );
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A090F] text-zinc-100 flex flex-col">
      {/* Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#0A090F]/85 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-8">
          <a
            href="#top"
            className="inline-flex items-center gap-2 font-display text-base sm:text-lg font-bold italic tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1] rounded"
          >
            <BrandShardLogo className="w-5 h-5 text-white shrink-0" />
            <span>robuxora</span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-xs sm:text-sm font-medium text-zinc-300"
          >
            <button
              type="button"
              onClick={() => setCurrentView('marketplace')}
              className={`inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'marketplace' ? 'text-white font-semibold' : 'text-zinc-300 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-hidden="true" />
              <span>Marketplace</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentView('store')}
              className={`inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'store' ? 'text-white font-semibold' : 'text-zinc-300 hover:text-white'
              }`}
            >
              <RobuxMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Robux Vault</span>
            </button>
            <a
              href="#verification"
              className="inline-flex items-center gap-2 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-hidden="true" />
              <span>Group Verify</span>
            </a>
            {session?.role === 'user' && (
              <a
                href="#my-orders"
                className="inline-flex items-center gap-2 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>My Orders</span>
              </a>
            )}
          </nav>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Switch to White (Light) Mode'
                  : 'Switch to Dark Mode'
              }
              title={
                theme === 'dark'
                  ? 'Switch to White Mode'
                  : 'Switch to Dark Mode'
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#171522] text-zinc-200 hover:border-[#764AF1]/60 hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-violet-300 shrink-0" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4 text-zinc-200 shrink-0" aria-hidden="true" />
              )}
            </button>

            {!session && (
              <button
                type="button"
                onClick={() => handleOpenAuth('signin')}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-[#171522] border border-white/10 px-5 py-2 text-xs font-semibold text-zinc-100 hover:border-[#764AF1]/70 hover:bg-[#764AF1] hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}

            {currentUser && (
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-full bg-[#171522] border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-zinc-100 hover:border-[#764AF1]/70 transition-colors whitespace-nowrap shrink-0"
              >
                {currentUser.avatar && !headerAvatarBroken ? (
                  <img
                    key={currentUser.avatar}
                    src={currentUser.avatar}
                    alt={currentUser.name}
                    onError={() => setHeaderAvatarBroken(true)}
                    className="w-5 h-5 rounded-full object-cover border border-[#764AF1]/70 shrink-0"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
                )}
                <span className="max-w-[110px] truncate">{currentUser.name}</span>
                {currentUserTier.id !== 'starter' && (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${currentUserTier.borderClass} ${currentUserTier.bgClass} ${currentUserTier.textClass}`}
                  >
                    {currentUserTier.name}
                  </span>
                )}
              </button>
            )}

            {isAdmin && (
              <a
                href="#admin-dashboard"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#764AF1] px-4 py-2 text-xs font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap shrink-0"
              >
                <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Admin Panel</span>
              </a>
            )}
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* LIVE CUSTOMER ORDER CONFIRMATION BANNER */}
        {session?.role === 'user' &&
          latestConfirmedOrder &&
          confirmedBannerKey !== dismissedConfirmBannerKey && (
            <div className="bg-emerald-500/10 border-b border-emerald-500/30">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2.5 text-xs text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                  <span>
                    <strong className="text-emerald-300 font-semibold">
                      {latestConfirmedOrder.status === 'Completed'
                        ? `Order #${latestConfirmedOrder.orderNumber} Delivered!`
                        : `Order #${latestConfirmedOrder.orderNumber} Confirmed by Admin!`}
                    </strong>{' '}
                    {latestConfirmedOrder.packageTitle} for{' '}
                    <span className="font-mono text-white">
                      {latestConfirmedOrder.robloxUsername}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <a
                    href="#my-orders"
                    className="inline-flex min-h-[34px] items-center justify-center rounded-full bg-emerald-400 px-3.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-300 transition-colors whitespace-nowrap"
                  >
                    View Order Status
                  </a>
                  <button
                    type="button"
                    aria-label="Dismiss confirmation banner"
                    onClick={() => setDismissedConfirmBannerKey(confirmedBannerKey)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-emerald-200/80 hover:bg-emerald-500/20 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* ADMIN CONTROL PANEL */}
        {isAdmin && (
          <Suspense fallback={null}>
            <AdminDashboard
              packages={packages}
              orders={orders}
              users={users}
              verifiedPayments={verifiedPayments}
              paymentSecurityLogs={paymentSecurityLogs}
              adminToken={adminToken}
              groupSettings={groupSettings}
              isCloudConnected={isCloudConnected}
              connectedCloudEmail={firebaseUser?.email || null}
              isSyncingCloud={isSyncingCloud}
              onConnectCloud={(force) => void handleConnectCloud(force)}
              onSyncCloudNow={() => void syncAllToFirestore()}
              onSignOut={handleSignOut}
              onAddPackage={handleAddPackage}
              onUpdatePackage={handleUpdatePackage}
              onDeletePackage={handleDeletePackage}
              onUpdateOrderStatus={(id, st) => handleUpdateOrderStatus(id, st)}
              onUnlockOrderTimer={(id) => void handleUnlockOrderTimer(id)}
              onDeleteOrder={handleDeleteOrder}
              onAddVerifiedPayment={handleAddVerifiedPayment}
              onDeleteVerifiedPayment={(id) => void handleDeleteVerifiedPayment(id)}
              onRefreshOrders={() => {
                void syncFromServer();
                if (isCloudConnected) void syncAllToFirestore();
              }}
              onSaveGroupSettings={handleSaveGroupSettings}
            />
          </Suspense>
        )}

        {/* MARKETPLACE VIEW OR STOREFRONT */}
        {currentView === 'marketplace' ? (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-in fade-in duration-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div>
                <h1 className="font-display text-3xl font-bold text-white">Marketplace</h1>
                <p className="text-sm text-zinc-400 mt-1">Browse thousands of premium items and currency packs.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    placeholder="Search marketplace..."
                    className="w-full sm:w-64 rounded-xl bg-[#141019] border border-white/15 pl-10 pr-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1]"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-[#141019] border border-white/15 px-3 py-2 text-xs font-medium text-zinc-300">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-violet-400" />
                  <span>Sort: {marketSort}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Sidebar: Games */}
              <div className="lg:col-span-3 rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 space-y-3">
                <h3 className="font-display text-sm font-semibold text-white uppercase tracking-wider mb-2">Games</h3>
                <div className="space-y-1">
                  {['All Games', 'BloxFruits', 'MM2', 'BloxFruit Physical Fruit', 'Rivals', "Gift Card's", 'Robux'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setMarketCategory(cat)}
                      className={`w-full text-left rounded-xl px-3.5 py-2.5 text-xs font-medium transition-colors flex items-center justify-between ${
                        marketCategory === cat
                          ? 'bg-[#764AF1] text-white font-semibold'
                          : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      <span>{cat}</span>
                      <span className="text-[10px] opacity-75 font-mono">
                        {cat === 'All Games'
                          ? packages.length
                          : packages.filter((p) => (p.category || 'Robux').toLowerCase() === cat.toLowerCase()).length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Item Grid */}
              <div className="lg:col-span-9 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {packages
                    .filter((pkg) => {
                      if (marketCategory !== 'All Games') {
                        const pkgCat = (pkg.category || 'Robux').toLowerCase();
                        const selCat = marketCategory.toLowerCase();
                        if (pkgCat !== selCat) return false;
                      }
                      if (marketSearch.trim()) {
                        const q = marketSearch.trim().toLowerCase();
                        return pkg.title.toLowerCase().includes(q) || pkg.deliveryNote.toLowerCase().includes(q);
                      }
                      return true;
                    })
                    .map((pkg) => {
                      const cleanImg = sanitizeImage(pkg.image);
                      const hasDiscount = typeof pkg.originalPriceBdt === 'number' && pkg.originalPriceBdt > pkg.priceBdt;
                      return (
                        <div
                          key={pkg.id}
                          className="rounded-2xl bg-[#130F1A] border border-white/[0.09] hover:border-[#764AF1]/50 p-4 flex flex-col justify-between space-y-4 transition-all duration-200 hover:-translate-y-1 shadow-xl group"
                        >
                          <div className="relative aspect-square rounded-xl bg-[#09070B] border border-white/[0.08] overflow-hidden flex items-center justify-center p-4">
                            <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-violet-500/20 border border-violet-500/40 px-2.5 py-0.5 text-[10px] font-bold text-violet-300 uppercase">
                              {pkg.category || 'Robux'}
                            </span>
                            <span className="absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 uppercase">
                              SALE
                            </span>
                            {cleanImg ? (
                              <img
                                src={cleanImg}
                                alt={pkg.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 rounded-lg"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-center space-y-2">
                                <RobuxMark className="w-12 h-12 text-[#764AF1]" />
                                <span className="text-xs font-mono text-zinc-400">{pkg.tierLabel}</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <div className="font-display font-semibold text-sm text-zinc-100">{pkg.title}</div>
                            <div className="text-[11px] text-zinc-400">{pkg.deliveryNote}</div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-white/[0.07]">
                            <div>
                              {hasDiscount && (
                                <div className="text-[11px] text-zinc-500 line-through font-mono">
                                  ৳{pkg.originalPriceBdt} BDT
                                </div>
                              )}
                              <div className="font-mono font-bold text-sm text-[#E6C7DC]">
                                ৳{pkg.priceBdt} BDT
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPackageId(pkg.id);
                                setCurrentView('store');
                                const el = document.getElementById('packages');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#764AF1] hover:bg-[#855DF7] px-4 py-1.5 text-xs font-semibold text-white transition-colors"
                            >
                              <ShoppingBag className="w-3.5 h-3.5" />
                              <span>Buy Now</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-0">
        {/* 1. CURVED COSMIC HERO SECTION */}
        <section className="hero-cosmic-canvas relative overflow-hidden pt-12 pb-20 sm:pt-16 sm:pb-24">
          <div className="max-w-6xl mx-auto px-6 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.35rem] font-bold tracking-tight text-white leading-[1.1] text-balance">
                  Meet the <span className="italic font-semibold text-[#8B5CF6]">best</span> Robux marketplace in Roblox
                </h1>

                <p className="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-md">
                  Unforgettable experience of verified Group Payouts, real-time Roblox API checks, and automatic 15-day security holds — with zero account password needed.
                </p>

                <div className="flex flex-wrap items-center gap-6 pt-1">
                  <a
                    href="#packages"
                    className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-full bg-[#764AF1] px-7 py-3 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
                  >
                    <span>Visit Market</span>
                    <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>

                  <a
                    href="#verification"
                    className="inline-flex min-h-[44px] items-center justify-center text-sm font-medium text-zinc-200 hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] rounded px-1"
                  >
                    Learn more
                  </a>
                </div>

                <div className="pt-4 border-t border-white/[0.08] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>Velvet Visions Studio</span>
                  <span aria-hidden="true">·</span>
                  <span>Live Roblox API Verification</span>
                  <span aria-hidden="true">·</span>
                  <span>15-Day Security Hold</span>
                </div>
              </div>

              <div className="lg:col-span-6 relative flex items-center justify-center min-h-[300px] sm:min-h-[380px]">
                {/* Geometric angled diamond outline & violet triangle accent behind character */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute w-64 h-64 sm:w-80 sm:h-80 rotate-45 rounded-2xl border border-[#764AF1]/25 bg-gradient-to-br from-[#764AF1]/15 via-transparent to-transparent"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute right-10 sm:right-16 top-16 w-44 h-44 sm:w-56 sm:h-56 rotate-45 rounded-xl bg-gradient-to-tr from-[#6D28D9]/45 to-[#8B5CF6]/70 blur-[1px]"
                />
                <div className="relative z-10 w-64 sm:w-80 aspect-[3/4] flex items-end justify-center">
                  <ResilientImage
                    src="/src/assets/images/hero_roblox_character_1795779452167.jpg"
                    alt="Stylized Roblox avatar steampunk character in violet vault lighting"
                    title="RobuxOra Verified Vault"
                    className="w-full h-full object-cover rounded-3xl [mask-image:radial-gradient(ellipse_at_center,black_62%,transparent_100%)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sweeping Curved Horizon Divider */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 overflow-hidden leading-none"
          >
            <svg
              viewBox="0 0 1440 84"
              preserveAspectRatio="none"
              className="w-full h-10 sm:h-16 block"
            >
              <path
                d="M0,12 Q720,96 1440,12 L1440,84 L0,84 Z"
                fill={theme === 'light' ? '#f8f9fc' : '#0A090F'}
              />
              <path
                d="M0,12 Q720,96 1440,12"
                fill="none"
                stroke="rgba(139, 92, 246, 0.38)"
                strokeWidth="1.5"
              />
            </svg>
          </div>
        </section>

        {/* 2. TRENDING NOW / ROBUX PACKAGES SECTION */}
        <section
          id="packages"
          className="pt-8 pb-20"
          aria-labelledby="packages-heading"
        >
          <div className="max-w-6xl mx-auto px-6 space-y-12">
            <div className="text-center max-w-md mx-auto space-y-2.5">
              <h2
                id="packages-heading"
                className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white"
              >
                Trending Now
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Packages gaining popularity right now. Most users select a vault pack to activate their instant group verification.
              </p>
            </div>

            {(groupSettings?.availableRobux ?? 25400) <= 0 && (
              <RestockCountdownCard
                availableRobux={groupSettings?.availableRobux ?? 0}
                restockTimestamp={groupSettings?.restockTimestamp}
              />
            )}

            {packages.length === 0 ? (
              <div className="rounded-2xl bg-[#110F1B] border border-white/[0.06] p-10 text-center text-sm text-zinc-400">
                No Robux packages are currently listed. Sign in as Admin to add new packages.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {packages.map((pkg, idx) => {
                  const isSelected = selectedPackage?.id === pkg.id;
                  const displayArtwork = pkg.image?.trim() || DEFAULT_PRODUCT_IMAGE;
                  return (
                    <article
                      key={pkg.id}
                      className={`group relative flex flex-col rounded-2xl bg-[#110F1B] border p-5 transition-all duration-200 ${
                        isSelected
                          ? 'border-[#764AF1]/80 shadow-xl shadow-[#764AF1]/15'
                          : 'border-white/[0.06] hover:border-[#764AF1]/45'
                      }`}
                    >
                      {/* Clean Centered Header Row */}
                      <div className="flex items-center justify-center gap-2 pb-4 text-sm font-semibold text-zinc-100">
                        <RobuxMark className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                        <span>{pkg.tierLabel || 'Robux Vault'}</span>
                      </div>

                      {/* Inner Item Showcase Box */}
                      <div className="rounded-xl bg-[#161422] border border-white/[0.05] p-3.5 flex flex-col justify-between flex-1">
                        <div className="aspect-square w-full overflow-hidden rounded-lg bg-[#12101B] flex items-center justify-center mb-3.5">
                          <ResilientImage
                            src={displayArtwork}
                            alt={`${pkg.title} vault bundle`}
                            title={pkg.title}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        </div>

                        <div className="space-y-1">
                          <h3 className="font-display text-base font-semibold text-zinc-100 truncate">
                            {pkg.title}
                          </h3>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono font-bold text-zinc-100 tabular-nums">
                              ৳{pkg.priceBdt}.00
                            </span>
                            <span className="text-zinc-400 truncate">
                              {pkg.deliveryNote || 'Group Payout'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Centered Rounded Pill Action */}
                      <div className="pt-5 flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleBuyNow(pkg)}
                          className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-6 py-2 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] ${
                            isSelected
                              ? 'bg-[#764AF1] text-white border border-[#8B5CF6]'
                              : 'bg-[#181524] border border-white/[0.08] text-zinc-200 hover:bg-[#764AF1] hover:border-[#764AF1] hover:text-white'
                          }`}
                        >
                          <span>Visit Market</span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 3. BUY ROBUX INSTANTLY PROMOTIONAL BANNER + LIVE STOCK STATUS */}
        {(() => {
          const liveAvailable = groupSettings?.availableRobux ?? 25400;
          const isOutOfStock = liveAvailable <= 0;
          const primaryPkg = selectedPackage || packages[0] || null;
          return (
            <section className="py-10">
              <div className="max-w-6xl mx-auto px-6 space-y-4">
                <div
                  className={`relative rounded-3xl bg-gradient-to-r from-[#110F1B] via-[#141120] to-[#1A1626] border overflow-hidden ${
                    isOutOfStock
                      ? 'border-red-500/45 stock-alert-red'
                      : 'border-white/[0.06]'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 items-center">
                    <div className="lg:col-span-7 p-7 sm:p-11 space-y-5 relative z-10">
                      <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight max-w-md text-balance">
                        Buy Robux instantly. Without any limits.
                      </h2>
                      <p className="text-sm text-zinc-400 leading-relaxed max-w-md">
                        RobuxOra provides verified Robux group-fund delivery directly through our official Roblox community with live stock checks.
                      </p>

                      {/* Clean Real-Time Stock Status Line */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            isOutOfStock ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {liveAvailable.toLocaleString()} Robux Available
                        </span>
                        <span className="text-zinc-600" aria-hidden="true">·</span>
                        <span className="text-zinc-400">
                          {isOutOfStock
                            ? 'Out of Stock — Waiting for Admin Restock'
                            : 'Official Group Funds Active'}
                        </span>
                      </div>

                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (primaryPkg) {
                              handleBuyNow(primaryPkg);
                            } else {
                              document
                                .getElementById('packages')
                                ?.scrollIntoView({ behavior: 'smooth' });
                            }
                          }}
                          className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-full bg-[#1C1928] border border-white/10 px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#764AF1] hover:border-[#764AF1] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
                        >
                          <span>Buy Robux</span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="lg:col-span-5 relative h-56 sm:h-72 lg:h-full min-h-[240px] flex items-center justify-end overflow-hidden">
                      <ResilientImage
                        src="/src/assets/images/promo_gold_robux_1795779452895.jpg"
                        alt="Gold hexagonal Robux emblem"
                        title="Instant Robux Vault"
                        className="w-full h-full object-cover object-center [mask-image:linear-gradient(to_left,black_55%,transparent_100%)]"
                      />

                      {/* Floating Payout Proof Tags matching reference mockup */}
                      <div className="pointer-events-none absolute bottom-6 left-4 sm:left-8 rounded-full bg-[#181523]/90 backdrop-blur-md border border-white/10 px-3.5 py-2 flex items-center gap-2.5 shadow-xl">
                        <div className="w-7 h-7 rounded-full bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
                          <RobuxMark className="w-3.5 h-3.5" />
                        </div>
                        <div className="leading-tight">
                          <div className="font-mono text-xs font-bold text-white tabular-nums">
                            +{(primaryPkg?.robux ?? 1700).toLocaleString()} R$
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {isOutOfStock ? 'Restock pending' : 'Group funds ready'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isOutOfStock && (
                  <RestockCountdownCard
                    availableRobux={liveAvailable}
                    restockTimestamp={groupSettings?.restockTimestamp}
                  />
                )}
              </div>
            </section>
          );
        })()}

        {/* 4. LIVE FEED SECTION */}
        <section id="live-feed" className="py-16" aria-labelledby="live-feed-heading">
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <div className="text-center max-w-md mx-auto space-y-2.5">
              <h2
                id="live-feed-heading"
                className="font-display text-3xl font-bold tracking-tight text-white"
              >
                Live Feed
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Here you can view real-time statistics and data on the latest transactions on our platform
              </p>
            </div>

            {(() => {
              const recentOrders = orders
                .filter((o) => normalizeOrderStatus(o.status) !== 'Cancelled')
                .slice(0, 4);
              if (recentOrders.length > 0) {
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {recentOrders.map((order, idx) => (
                      <div
                        key={order.id}
                        className="rounded-2xl bg-[#110F1B] border border-white/[0.06] p-4 flex items-center gap-3.5 hover:border-[#764AF1]/40 transition-colors"
                      >
                        <div className="w-12 h-12 rounded-xl bg-[#161422] border border-white/[0.06] overflow-hidden shrink-0">
                          <ResilientImage
                            src={VAULT_ARTWORKS[idx % VAULT_ARTWORKS.length]}
                            alt={order.packageTitle}
                            title={order.packageTitle}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-zinc-100 truncate">
                            {order.packageTitle}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1 text-xs">
                            <span className="font-mono font-semibold text-zinc-300 tabular-nums">
                              ৳{order.priceBdt}.00
                            </span>
                            <span className="text-[11px] text-zinc-500 whitespace-nowrap">
                              {formatRelativeAgo(order.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {packages.slice(0, 4).map((pkg, idx) => (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => handleBuyNow(pkg)}
                      className="text-left rounded-2xl bg-[#110F1B] border border-white/[0.06] p-4 flex items-center gap-3.5 hover:border-[#764AF1]/50 transition-colors"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[#161422] border border-white/[0.06] overflow-hidden shrink-0">
                        <ResilientImage
                          src={pkg.image?.trim() || DEFAULT_PRODUCT_IMAGE}
                          alt={pkg.title}
                          title={pkg.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-zinc-100 truncate">
                          {pkg.title}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1 text-xs">
                          <span className="font-mono font-semibold text-zinc-300 tabular-nums">
                            ৳{pkg.priceBdt}.00
                          </span>
                          <span className="text-[11px] text-emerald-400 whitespace-nowrap">
                            Available
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </section>

        {/* 3. ON-PAGE VERIFICATION, 15-DAY TIMER & PAYMENT SECTION */}
        <VerificationAndPaymentSection
          isSignedIn={isSignedIn}
          isAdmin={isAdmin}
          selectedPackage={selectedPackage}
          groupSettings={groupSettings}
          availableRobux={groupSettings?.availableRobux ?? 25400}
          robloxUsername={timerState.robloxUsername}
          onUsernameChange={handleUsernameChange}
          hasClickedGroupLink={timerState.hasClickedGroupLink}
          isGroupVerified={isSignedIn && timerState.isGroupVerified}
          isVerifyingApi={isVerifyingApi}
          isSubmittingOrder={isSubmittingOrder}
          remainingSeconds={
            isSignedIn && timerState.isGroupVerified
              ? remainingSeconds
              : FIFTEEN_DAYS_SECONDS
          }
          savedVerifiedTimers={savedVerifiedTimers}
          errorMessage={errorMessage}
          paymentError={paymentError}
          selectedPaymentId={selectedPaymentId}
          orderReceipt={orderReceipt}
          liveReceiptOrder={liveReceiptOrder}
          onRequireSignIn={requireSignInPrompt}
          onGroupLinkClick={handleGroupLinkClick}
          onVerifyMembership={handleVerifyMembership}
          onSwitchRobloxUsername={handleSwitchRobloxUsername}
          onSelectSavedUsername={handleSelectSavedUsername}
          onAdminUnlockTimer={handleAdminUnlockTimer}
          onStartAnotherOrder={handleStartAnotherOrder}
          onClearPaymentError={() => setPaymentError(null)}
          onSelectPayment={(id) => {
            setPaymentError(null);
            setSelectedPaymentId(id);
          }}
          onShowOutOfStock={() => {
            if (!selectedPackage) return;
            setOutOfStockAlert({
              available: Math.max(0, groupSettings?.availableRobux ?? 25400),
              needed: selectedPackage.robux,
              packageTitle: selectedPackage.title,
            });
          }}
          onCompleteOrder={(trxId, senderPhone) => void handleCompleteOrder(trxId, senderPhone)}
        />

        {/* LIVE CUSTOMER ORDER STATUS & CONFIRMATION TRACKER */}
        {session?.role === 'user' && (
          <CustomerOrdersSection
            userEmail={currentUser ? currentUser.email : session.email}
            orders={userOrders}
            onRefresh={() => void syncFromServer()}
          />
        )}

        {/* 5. FAQ SECTION */}
        <section
          id="faq"
          className="py-16 border-t border-white/[0.06]"
          aria-labelledby="faq-heading"
        >
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <div className="text-center max-w-md mx-auto space-y-2">
              <h2
                id="faq-heading"
                className="font-display text-3xl font-bold tracking-tight text-white"
              >
                Frequently Asked Questions
              </h2>
              <p className="text-xs text-zinc-400">
                Payout policy, live group verification, and 15-day hold details
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {FAQ_ITEMS.map((item, idx) => (
                <div
                  key={item.q}
                  className="rounded-2xl bg-[#110F1B] border border-white/[0.06] p-6 space-y-3"
                >
                  <h3 className="font-display text-base font-semibold text-zinc-100 leading-snug">
                    0{idx + 1}. {item.q}
                  </h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10 bg-[#0A090F]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-2.5">
            <BrandShardLogo className="w-4 h-4 text-zinc-300 shrink-0" />
            <span className="font-display font-bold italic text-zinc-200">
              robuxora
            </span>
            <span aria-hidden="true">·</span>
            <span>Velvet Visions Studio Community Storefront</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <a
              href="#packages"
              className="hover:text-zinc-200 transition-colors whitespace-nowrap"
            >
              Robux Vault
            </a>
            <a
              href="#verification"
              className="hover:text-zinc-200 transition-colors whitespace-nowrap"
            >
              Group Verify
            </a>
            <a
              href="#live-feed"
              className="hover:text-zinc-200 transition-colors whitespace-nowrap"
            >
              Live Feed
            </a>
          </div>
        </div>
      </footer>

      {/* Checkout & Real-Time API Verification Modal */}
      {isCheckoutModalOpen && (
        <Suspense fallback={null}>
          <VerificationModal
            isOpen={isCheckoutModalOpen}
            isSignedIn={isSignedIn}
            isAdmin={isAdmin}
            selectedPackage={selectedPackage}
            groupSettings={groupSettings}
            availableRobux={groupSettings?.availableRobux ?? 25400}
            robloxUsername={timerState.robloxUsername}
            onUsernameChange={handleUsernameChange}
            hasClickedGroupLink={timerState.hasClickedGroupLink}
            isGroupVerified={isSignedIn && timerState.isGroupVerified}
            isVerifyingApi={isVerifyingApi}
            isSubmittingOrder={isSubmittingOrder}
            remainingSeconds={
              isSignedIn && timerState.isGroupVerified
                ? remainingSeconds
                : FIFTEEN_DAYS_SECONDS
            }
            savedVerifiedTimers={savedVerifiedTimers}
            errorMessage={errorMessage}
            paymentError={paymentError}
            selectedPaymentId={selectedPaymentId}
            orderReceipt={orderReceipt}
            onClose={() => setIsCheckoutModalOpen(false)}
            onRequireSignIn={requireSignInPrompt}
            onGroupLinkClick={handleGroupLinkClick}
            onVerifyMembership={handleVerifyMembership}
            onSwitchRobloxUsername={handleSwitchRobloxUsername}
            onSelectSavedUsername={handleSelectSavedUsername}
            onAdminUnlockTimer={handleAdminUnlockTimer}
            onClearPaymentError={() => setPaymentError(null)}
            onSelectPayment={(id) => {
              setPaymentError(null);
              setSelectedPaymentId(id);
            }}
            onShowOutOfStock={() => {
              if (!selectedPackage) return;
              setOutOfStockAlert({
                available: Math.max(0, groupSettings?.availableRobux ?? 25400),
                needed: selectedPackage.robux,
                packageTitle: selectedPackage.title,
              });
            }}
            onSubmitOrder={(trxId, senderPhone) => void handleCompleteOrder(trxId, senderPhone)}
          />
        </Suspense>
      )}

      {/* Sign In / Create Account / Admin Sign In Modal */}
      {isAuthModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            isOpen={isAuthModalOpen}
            initialMode={authModalMode}
            noticeMessage={authNotice}
            users={users}
            onClose={() => {
              setIsAuthModalOpen(false);
              setAuthNotice(null);
              setPendingCheckoutAfterAuth(false);
            }}
            onUserSignIn={handleUserSignIn}
            onUserSignUp={handleUserSignUp}
            onAdminSignIn={handleAdminSignIn}
          />
        </Suspense>
      )}

      {/* User Profile & Personal Order History Modal */}
      {isProfileModalOpen && (
        <Suspense fallback={null}>
          <ProfileModal
            isOpen={isProfileModalOpen}
            user={currentUser}
            existingUsers={users}
            orders={userOrders}
            onClose={() => setIsProfileModalOpen(false)}
            onSaveProfile={handleSaveProfile}
            onSignOut={handleSignOut}
          />
        </Suspense>
      )}

      {/* Robux Out of Stock Popup */}
      {outOfStockAlert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="out-of-stock-popup-title"
          onClick={() => setOutOfStockAlert(null)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#110F1B] border border-red-500/50 p-6 shadow-2xl space-y-4 stock-alert-red"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400 border border-red-500/35">
                  <AlertTriangle className="w-5 h-5 animate-pulse" aria-hidden="true" />
                </div>
                <div>
                  <h4
                    id="out-of-stock-popup-title"
                    className="font-display text-lg font-bold text-red-300"
                  >
                    Robux Out of Stock
                  </h4>
                  <p className="text-xs font-mono text-red-400">
                    {outOfStockAlert.available.toLocaleString()} Robux Available
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close out of stock message"
                onClick={() => setOutOfStockAlert(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3.5 text-sm text-zinc-200 leading-relaxed">
              {outOfStockAlert.available <= 0 ? (
                <>
                  Sorry, Robux is currently <span className="font-semibold text-red-300">Out of Stock (0 Robux available)</span>. Your order for <span className="font-semibold">{outOfStockAlert.packageTitle}</span> cannot be placed right now. Please wait until Robux is restocked!
                </>
              ) : (
                <>
                  Sorry, only <span className="font-semibold text-red-300">{outOfStockAlert.available.toLocaleString()} Robux</span> is currently in stock, which is not enough for <span className="font-semibold">{outOfStockAlert.packageTitle}</span>. Please wait until Robux is restocked.
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOutOfStockAlert(null)}
              className="w-full min-h-[42px] rounded-lg bg-red-500/20 border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/30 transition-colors"
            >
              Okay, Wait for Restock
            </button>
          </div>
        </div>
      )}

      {/* Need Help? Floating Button & Support Popup */}
      <div className="fixed bottom-6 right-6 z-50">
        {isHelpMenuOpen && (
          <div className="absolute bottom-16 right-0 w-64 rounded-2xl bg-[#17131D] border border-white/15 p-3.5 shadow-2xl space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-semibold text-white">Need Help &amp; Support?</span>
              <button
                type="button"
                aria-label="Close help menu"
                onClick={() => setIsHelpMenuOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <a
              href="https://t.me/01764088123"
              target="_blank"
              rel="noreferrer"
              onClick={() => setIsHelpMenuOpen(false)}
              className="flex items-center gap-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] p-2.5 text-xs font-medium text-zinc-200 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 font-bold shrink-0">
                TG
              </div>
              <div>
                <div className="text-white font-semibold">Telegram Support</div>
                <div className="text-[11px] text-zinc-400 font-mono">01764088123</div>
              </div>
            </a>
            <a
              href="https://instagram.com/robuxora"
              target="_blank"
              rel="noreferrer"
              onClick={() => setIsHelpMenuOpen(false)}
              className="flex items-center gap-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] p-2.5 text-xs font-medium text-zinc-200 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/40 flex items-center justify-center text-fuchsia-400 font-bold shrink-0">
                IG
              </div>
              <div>
                <div className="text-white font-semibold">Instagram Profile</div>
                <div className="text-[11px] text-zinc-400 font-mono">@robuxora</div>
              </div>
            </a>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsHelpMenuOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-full bg-[#D946EF] hover:bg-[#C026D3] text-white px-5 py-3 text-sm font-semibold shadow-2xl hover:scale-105 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Headphones className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Need Help?</span>
        </button>
      </div>
    </div>
  );
}
