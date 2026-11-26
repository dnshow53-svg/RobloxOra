import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  LogIn,
  Moon,
  Shield,
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
  saveStoreGroupSettings,
  signInAdminWithGoogle,
  subscribeFirebaseAuth,
  subscribeStoreOrders,
  subscribeStorePackages,
  subscribeStoreSettings,
  upsertStoreOrder,
  upsertStorePackage,
} from './firebase';
import { verifyRobloxMembership } from './utils/robloxApi';
import { ResilientImage, RobuxMark } from './components/RobuxIcon';
import { VerificationModal } from './components/VerificationModal';
import { VerificationAndPaymentSection } from './components/VerificationAndPaymentSection';
import { AuthModal, AuthModalMode } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';
import { AdminDashboard } from './components/AdminDashboard';
import { CustomerOrdersSection } from './components/CustomerOrdersSection';
import { LoyaltyTierBar } from './components/LoyaltyTierBar';
import { RestockCountdownCard } from './components/RestockCountdownCard';

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
  const [orderReceipt, setOrderReceipt] = useState<{
    orderId: string;
    method: string;
    transactionId?: string;
    verified?: boolean;
  } | null>(null);
  const [outOfStockAlert, setOutOfStockAlert] = useState<{
    available: number;
    needed: number;
    packageTitle: string;
  } | null>(null);
  const [dismissedConfirmBannerKey, setDismissedConfirmBannerKey] = useState<string>('');

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

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
    [cancelWaitingOrderForTimer]
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
        if (!alreadySynced) {
          void registerWaitingOrder(nextTimer);
        }
      }
      void verifyStillMemberInBackground(nextTimer, groupSettings.groupId);
    } else {
      setRemainingSeconds(0);
    }
    setErrorMessage(null);
    setOrderReceipt(null);
  }, [sessionKey, groupSettings.groupId, verifyStillMemberInBackground, registerWaitingOrder]);

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
      const res = await fetch('/api/store', { cache: 'no-store' });
      if (!res.ok) return;
      const serverData = (await res.json()) as {
        packages?: RobuxPackage[];
        orders?: OrderRecord[];
        deletedOrderIds?: string[];
        users?: RegisteredUser[];
        groupSettings?: GroupSettings;
        verifiedPayments?: VerifiedPaymentRecord[];
      };

      if (Array.isArray(serverData.deletedOrderIds) && serverData.deletedOrderIds.length > 0) {
        markOrderIdsDeleted(serverData.deletedOrderIds);
      }

      if (Array.isArray(serverData.verifiedPayments)) {
        setVerifiedPayments(serverData.verifiedPayments);
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
          (localTs === serverTs && Boolean(lu.avatar) && !su.avatar)
        ) {
          const mergedLocal: RegisteredUser = {
            ...su,
            ...lu,
            id: su.id,
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
            updatedAtMs: uPush.updatedAtMs ?? Date.now(),
          }),
        }).catch(() => {});
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
          await fetch(`/api/orders/${encodeURIComponent(so.id)}`, {
            method: 'DELETE',
          }).catch(() => {});
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
          }
        }
      }

      // Sync Admin remote "Unlock Timer" back to the active customer's timer live
      const activeSession = sessionRef.current;
      const currentTs = timerStateRef.current;
      if (activeSession && currentTs.isGroupVerified && currentTs.verifiedAtMs) {
        const matchedSrv = sortedOrders.find(
          (o) =>
            o.userEmail.toLowerCase() === activeSession.email.toLowerCase() &&
            o.verifiedAtMs === currentTs.verifiedAtMs
        );
        if (
          matchedSrv &&
          typeof matchedSrv.unlockAtMs === 'number' &&
          matchedSrv.unlockAtMs <= Date.now() &&
          currentTs.unlockAtMs > Date.now()
        ) {
          const unlockedState: VerificationTimerState = {
            ...currentTs,
            unlockAtMs: matchedSrv.unlockAtMs,
          };
          setTimerState(unlockedState);
          saveTimerState(activeSession, unlockedState);
          setRemainingSeconds(0);
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

      // If any package was explicitly deleted locally, propagate deletion to server
      for (const sp of serverPackagesRaw) {
        if (deletedPkgIds.has(sp.id)) {
          await fetch(`/api/packages/${encodeURIComponent(sp.id)}`, {
            method: 'DELETE',
          }).catch(() => {});
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

      // Push any local custom/dirty packages that are missing on server (e.g. after server restart)
      const packagesToPush = localPackages.filter((lp) => {
        if (deletedPkgIds.has(lp.id) || inFlightDeletedPackageIdsRef.current.has(lp.id)) {
          return false;
        }
        const onServer = serverPkgMap.get(lp.id);
        if (!onServer) {
          return !pushedPkgIds.has(lp.id) || !defaultIds.has(lp.id);
        }
        return !pushedPkgIds.has(lp.id);
      });

      for (const mp of packagesToPush) {
        try {
          const postRes = await fetch('/api/packages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
  }, []);

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
        }
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

    return () => unsubOrders();
  }, [isAdmin, isCloudConnected, syncAllToFirestore]);

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

  const handleAdminSignIn = (email: string) => {
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

  // Admin Handlers (localStorage + Express /api sync + Firestore Cloud sync)
  const handleAddPackage = async (pkg: RobuxPackage) => {
    clearPackageIdDeleted(pkg.id);
    inFlightPackageIdsRef.current.add(pkg.id);
    const next = [...packages, pkg].sort((a, b) => a.robux - b.robux);
    setPackages(next);
    savePackages(next);
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pkg),
      });
      if (res.ok) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceBdt: updatedPkg.priceBdt,
          deliveryNote: updatedPkg.deliveryNote,
          image: updatedPkg.image,
        }),
      });
      if (res.status === 404) {
        const postRes = await fetch('/api/packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      await fetch(`/api/packages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
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
      ? { ...existingOrder, status, confirmedAt: optimisticConfirmedAt }
      : null;
    const next = ordersRef.current.map((o) =>
      o.id === orderId
        ? { ...o, status, confirmedAt: optimisticConfirmedAt }
        : o
    );
    setOrders(next);
    saveOrders(next);

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminAction: true }),
      });

      let savedPayload: OrderRecord | null = null;
      if (res.status === 404 && nextOrder) {
        const postRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...nextOrder, adminAction: true }),
        });
        if (postRes.ok) {
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
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlockAtMs: nowMs, adminAction: true }),
      });
      if (res.status === 404 && nextOrder) {
        const postRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      await fetch('/api/group-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stamped),
      }).catch(() => {});
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        autoApprovedOrder?: string | null;
      };
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
      await fetch(`/api/payments/ledger/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
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
      const nowMs = Date.now();
      const unlockAtMs = nowMs + FIFTEEN_DAYS_SECONDS * 1000;
      const nextTimer: VerificationTimerState = {
        hasClickedGroupLink: true,
        isGroupVerified: true,
        verifiedAtMs: nowMs,
        unlockAtMs,
        robloxUsername: cleanName,
        robloxUserId: null,
      };
      setErrorMessage(null);
      setRemainingSeconds(FIFTEEN_DAYS_SECONDS);
      setTimerState(nextTimer);
      saveTimerState(session, nextTimer);
      void registerWaitingOrder(nextTimer, selectedPackage);
      return;
    }

    // Verified Member -> save username, userId, join timestamp, start 15-day timer, and register Waiting order!
    const nowMs = Date.now();
    const unlockAtMs = nowMs + FIFTEEN_DAYS_SECONDS * 1000;
    const nextTimer: VerificationTimerState = {
      hasClickedGroupLink: true,
      isGroupVerified: true,
      verifiedAtMs: nowMs,
      unlockAtMs,
      robloxUsername: outcome.username,
      robloxUserId: outcome.userId,
    };
    setErrorMessage(null);
    setRemainingSeconds(FIFTEEN_DAYS_SECONDS);
    setTimerState(nextTimer);
    saveTimerState(session, nextTimer);
    void registerWaitingOrder(nextTimer, selectedPackage);
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

  const handleResetVerification = () => {
    void cancelWaitingOrderForTimer(timerState.verifiedAtMs);
    setErrorMessage(null);
    setPaymentError(null);
    setSelectedPaymentId(null);
    setOrderReceipt(null);
    setRemainingSeconds(FIFTEEN_DAYS_SECONDS);
    const resetState = { ...EMPTY_TIMER_STATE };
    setTimerState(resetState);
    saveTimerState(session, resetState);
  };

  const handleCompleteOrder = async (transactionId: string) => {
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

    // Hard check live Robux stock before checking TrxID or placing any order
    let liveAvailable = groupSettings?.availableRobux ?? 25400;
    try {
      const stockRes = await fetch('/api/store');
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
      // fall back to current state
    }

    if (liveAvailable <= 0 || selectedPackage.robux > liveAvailable) {
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

    setPaymentError(null);
    setIsSubmittingOrder(true);

    try {
      // Re-verify automatically before completing payment (for non-admin customers verified via live Roblox userId)
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

      // Verify TrxID format, duplicate check, and live 01764088123 Nagad/Rocket SMS inbox match
      let isPaymentVerified = false;
      let nextStatus: OrderStatus = 'Pending';
      let finalTrxId = cleanTrxId;

      let usedFallbackValidation = false;
      try {
        const verifyRes = await fetch('/api/payments/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: methodLabel,
            trxId: cleanTrxId,
            expectedAmountBdt: selectedPackage.priceBdt,
            orderNumber,
          }),
        });

        const contentType = verifyRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const verifyData = (await verifyRes.json()) as {
            valid?: boolean;
            verified?: boolean;
            normalizedTrxId?: string;
            status?: OrderStatus;
            error?: string;
          };

          if (!verifyRes.ok || !verifyData.valid) {
            setPaymentError(
              verifyData.error ||
                'Invalid Transaction ID. Please copy the exact TrxID from your 01764088123 Nagad/Rocket payment SMS.'
            );
            return;
          }

          isPaymentVerified = Boolean(verifyData.verified);
          nextStatus = isPaymentVerified ? 'Approved' : 'Pending';
          finalTrxId = verifyData.normalizedTrxId || cleanTrxId;
        } else {
          usedFallbackValidation = true;
        }
      } catch {
        usedFallbackValidation = true;
      }

      if (usedFallbackValidation) {
        if (!/^[A-Z0-9]{8,20}$/.test(cleanTrxId) || (cleanTrxId.match(/\d/g) || []).length < 2) {
          setPaymentError(
            'Invalid Transaction ID format. Please enter the exact 8–20 character TrxID from your Nagad/Rocket SMS.'
          );
          return;
        }
        const duplicate = orders.find(
          (o) =>
            o.status !== 'Cancelled' &&
            (o.transactionId || '').trim().toUpperCase() === cleanTrxId
        );
        if (duplicate) {
          setPaymentError(
            `Transaction ID ${cleanTrxId} has already been used for Order ${duplicate.orderNumber}.`
          );
          return;
        }
      }

      if (existingWaiting) {
        const updatedOrder: OrderRecord = {
          ...existingWaiting,
          packageId: selectedPackage.id,
          packageTitle: selectedPackage.title,
          robuxAmount: selectedPackage.robux,
          priceBdt: selectedPackage.priceBdt,
          paymentMethod: methodLabel,
          transactionId: finalTrxId,
          paymentVerified: isPaymentVerified,
          status: nextStatus,
        };
        const nextOrders = orders.map((o) =>
          o.id === existingWaiting.id ? updatedOrder : o
        );
        syncEpochRef.current += 1;
        setOrders(nextOrders);
        saveOrders(nextOrders);
        setOrderReceipt({
          orderId: existingWaiting.orderNumber,
          method: methodLabel,
          transactionId: finalTrxId,
          verified: isPaymentVerified,
        });

        inFlightOrderIdsRef.current.add(existingWaiting.id);
        try {
          await fetch(`/api/orders/${encodeURIComponent(existingWaiting.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              packageId: selectedPackage.id,
              packageTitle: selectedPackage.title,
              robuxAmount: selectedPackage.robux,
              priceBdt: selectedPackage.priceBdt,
              paymentMethod: methodLabel,
              transactionId: finalTrxId,
              paymentVerified: isPaymentVerified,
              status: nextStatus,
            }),
          });
          if (isCloudConnectedRef.current) {
            await upsertStoreOrder(updatedOrder).catch(() => {});
          }
        } catch {
          // ignore offline
        } finally {
          inFlightOrderIdsRef.current.delete(existingWaiting.id);
        }
        void syncFromServer();
        return;
      }

      const newOrder: OrderRecord = {
        id: `ord-${Date.now()}`,
        orderNumber,
        userEmail,
        userName: currentUser ? currentUser.name : 'Store Admin',
        userPhone: currentUser ? currentUser.phone : '',
        robloxUsername:
          timerState.robloxUsername.trim() ||
          (isAdmin ? 'Admin Test' : 'Verified Member'),
        robloxUserId: timerState.robloxUserId,
        packageId: selectedPackage.id,
        packageTitle: selectedPackage.title,
        robuxAmount: selectedPackage.robux,
        priceBdt: selectedPackage.priceBdt,
        paymentMethod: methodLabel,
        transactionId: finalTrxId,
        paymentVerified: isPaymentVerified,
        status: nextStatus,
        verifiedAtMs: timerState.verifiedAtMs || undefined,
        unlockAtMs: timerState.unlockAtMs || undefined,
        createdAt: new Date().toISOString(),
      };

      inFlightOrderIdsRef.current.add(newOrder.id);
      syncEpochRef.current += 1;
      const nextOrders = [newOrder, ...orders];
      setOrders(nextOrders);
      saveOrders(nextOrders);
      setOrderReceipt({
        orderId: orderNumber,
        method: methodLabel,
        transactionId: finalTrxId,
        verified: isPaymentVerified,
      });

      try {
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newOrder),
        });
        if (isCloudConnectedRef.current) {
          await upsertStoreOrder(newOrder).catch(() => {});
        }
      } catch {
        // ignore offline
      } finally {
        inFlightOrderIdsRef.current.delete(newOrder.id);
      }
      void syncFromServer();
    } catch {
      setPaymentError('Unable to verify payment right now. Please try again.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090B0E] text-zinc-100 flex flex-col">
      {/* Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#090B0E]/90 backdrop-blur-md border-b border-white/[0.08]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-8">
          <a
            href="#top"
            className="inline-flex items-center gap-2 font-display text-base sm:text-lg font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
          >
            <RobuxMark className="w-5 h-5 text-amber-400 shrink-0" />
            <span>RobuxOra</span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
          >
            <a
              href="#packages"
              className="hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Packages
            </a>
            <a
              href="#verification"
              className="hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Verification
            </a>
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
              className="inline-flex h-9 w-9 sm:h-10 sm:w-auto sm:px-3 items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#131820] text-zinc-200 hover:border-amber-400/60 hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline text-xs font-medium">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-zinc-200 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline text-xs font-medium">Dark</span>
                </>
              )}
            </button>

            {!session && (
              <button
                type="button"
                onClick={() => handleOpenAuth('signin')}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}

            {currentUser && (
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#131820] border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-100 hover:border-amber-400/60 transition-colors whitespace-nowrap shrink-0"
              >
                {currentUser.avatar ? (
                  <img
                    src={currentUser.avatar}
                    alt={currentUser.name}
                    className="w-5 h-5 rounded-full object-cover border border-amber-400/50 shrink-0"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                )}
                <span className="max-w-[110px] truncate">{currentUser.name}</span>
                {currentUserTier.id !== 'starter' && (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${currentUserTier.borderClass} ${currentUserTier.bgClass} ${currentUserTier.textClass}`}
                  >
                    {currentUserTier.name}
                  </span>
                )}
              </button>
            )}

            {isAdmin && (
              <a
                href="#admin-dashboard"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
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
                    className="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-emerald-400 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-300 transition-colors whitespace-nowrap"
                  >
                    View Order Status
                  </a>
                  <button
                    type="button"
                    aria-label="Dismiss confirmation banner"
                    onClick={() => setDismissedConfirmBannerKey(confirmedBannerKey)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-200/80 hover:bg-emerald-500/20 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* ADMIN CONTROL PANEL */}
        {isAdmin && (
          <AdminDashboard
            packages={packages}
            orders={orders}
            users={users}
            verifiedPayments={verifiedPayments}
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
        )}

        {/* 1. HERO SECTION */}
        <section className="py-16 lg:py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <p className="text-xs font-medium tracking-wide text-amber-400">
                  Velvet Visions Studio · Live API Verification
                </p>

                <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-zinc-100 leading-[1.08] text-balance">
                  Verified Robux Packages Delivered via Group Funds
                </h1>

                <p className="text-base text-zinc-400 leading-relaxed max-w-xl">
                  Select a Robux package, join our official Roblox community, and verify your username via the Roblox Public API to activate your 15-day security countdown.
                </p>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <a
                    href="#packages"
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <span>Browse Packages</span>
                    <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>

                  <a
                    href="#verification"
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#131820] px-5 py-3 text-sm font-medium text-zinc-200 hover:border-white/25 hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <span>Verify Membership</span>
                    <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>
                </div>

                <div className="pt-4 border-t border-white/[0.08] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>Real-Time Roblox API Check</span>
                  <span aria-hidden="true">·</span>
                  <span>15-Day Security Hold</span>
                  <span aria-hidden="true">·</span>
                  <span>Zero Password Required</span>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="relative h-full min-h-[280px] sm:min-h-[340px] rounded-xl overflow-hidden border border-white/[0.08] bg-[#131820]">
                  <ResilientImage
                    src="/src/assets/images/hero_robux_vault_1794846839199.jpg"
                    alt="Stacked brushed gold hexagonal Robux tokens on dark slate"
                    title="RobuxOra Robux Vault"
                    className="w-full h-full lg:h-full object-cover"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#090B0E]/70 via-transparent to-transparent"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. SHOP / ROBUX PACKAGES SECTION */}
        <section
          id="packages"
          className="py-20 border-t border-white/[0.08]"
          aria-labelledby="packages-heading"
        >
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-amber-400 mb-2">
                  Robux Storefront
                </p>
                <h2
                  id="packages-heading"
                  className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-100"
                >
                  Select a Robux Package
                </h2>
              </div>
              <p className="text-sm text-zinc-400 max-w-md">
                Click Buy Now on any package to verify your Roblox username against our community group in real time.
              </p>
            </div>

            {(groupSettings?.availableRobux ?? 25400) <= 0 && (
              <RestockCountdownCard
                availableRobux={groupSettings?.availableRobux ?? 0}
                restockTimestamp={groupSettings?.restockTimestamp}
              />
            )}

            {packages.length === 0 ? (
              <div className="rounded-xl bg-[#131820] border border-white/[0.08] p-10 text-center text-sm text-zinc-400">
                No Robux packages are currently listed. Sign in as Admin to add new packages.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {packages.map((pkg, idx) => {
                  const isSelected = selectedPackage?.id === pkg.id;
                  const hasCustomImage = Boolean(
                    pkg.image && !pkg.image.startsWith('/src/assets/images/pkg_')
                  );
                  const originalPrice = Math.round(pkg.priceBdt * 1.25);
                  const saveAmount = originalPrice - pkg.priceBdt;
                  return (
                    <article
                      key={pkg.id}
                      className={`group relative flex flex-col rounded-2xl overflow-hidden bg-[#131820] border transition-all duration-200 hover:-translate-y-1 ${
                        isSelected
                          ? 'border-amber-400/80 shadow-lg shadow-amber-400/10'
                          : 'border-white/[0.08] hover:border-purple-500/40 hover:shadow-xl hover:shadow-purple-500/5'
                      }`}
                    >
                      {/* Top Absolute Badges (Save & Hot) */}
                      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 text-white px-2.5 py-0.5 text-xs font-bold shadow-md backdrop-blur">
                          Save ৳{saveAmount}
                        </span>
                        {idx === 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-zinc-950 px-2.5 py-0.5 text-xs font-extrabold shadow-md">
                            🔥 Hot
                          </span>
                        )}
                      </div>

                      {/* Package Image Area */}
                      <div className="aspect-[4/3] w-full overflow-hidden bg-[#0D1117] border-b border-white/[0.06] relative flex items-center justify-center">
                        {hasCustomImage ? (
                          <ResilientImage
                            src={pkg.image}
                            alt={`${pkg.title} product image`}
                            title={pkg.title}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-purple-600/15 to-zinc-900 flex flex-col items-center justify-center p-4">
                            <RobuxMark className="w-16 h-16 text-amber-400 drop-shadow-lg mb-2" />
                            <span className="font-display font-bold text-lg text-zinc-100">{pkg.title}</span>
                          </div>
                        )}
                      </div>

                      <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
                        <div className="space-y-2.5">
                          {/* Pill Category Badge */}
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/[0.06] border border-white/10 text-zinc-300">
                              {pkg.tierLabel || 'TopUp'}
                            </span>
                            <span className="text-xs text-zinc-500">·</span>
                            <span className="text-xs text-emerald-400 font-medium">{pkg.deliveryNote || 'Automated'}</span>
                          </div>

                          <h3 className="font-display text-xl font-bold text-zinc-100 flex items-center gap-2">
                            <span className="tabular-nums">{pkg.title}</span>
                          </h3>

                          {/* Star Rating */}
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="flex text-amber-400">
                              {'★★★★★'.split('').map((s, i) => (
                                <span key={i} className="text-sm">{s}</span>
                              ))}
                            </div>
                            <span className="font-bold text-zinc-200">4.9</span>
                            <span className="text-zinc-500">(48)</span>
                          </div>

                          {/* Pricing block */}
                          <div className="pt-2 border-t border-white/[0.06] flex items-baseline justify-between gap-2">
                            <div>
                              <div className="text-[11px] text-zinc-400">Starting from</div>
                              <div className="font-mono text-xl font-extrabold text-zinc-100 tabular-nums">
                                ৳{pkg.priceBdt}.00
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-xs text-zinc-500 line-through tabular-nums">
                                ৳{originalPrice}.00
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Purple Action Button */}
                        <button
                          type="button"
                          onClick={() => handleBuyNow(pkg)}
                          className="w-full min-h-[44px] rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-500 transition-colors shadow-lg shadow-purple-600/25 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 flex items-center justify-center gap-2"
                        >
                          <span>অপশন বেছে নিন</span>
                          <span className="text-xs opacity-80">(Select Option)</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Robux Available Stock Bar */}
        {(() => {
          const liveAvailable = groupSettings?.availableRobux ?? 25400;
          const isOutOfStock = liveAvailable <= 0;
          return (
            <div className="max-w-6xl mx-auto px-6 pt-10 pb-2">
              <div
                className={`rounded-xl bg-[#131820] border p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl transition-all duration-500 ${
                  isOutOfStock
                    ? 'border-red-500/50 bg-red-500/[0.06] shadow-red-500/15 stock-alert-red'
                    : 'border-emerald-500/30 shadow-emerald-500/5'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-xl border shrink-0 transition-colors duration-500 ${
                      isOutOfStock
                        ? 'bg-red-500/15 text-red-400 border-red-500/40'
                        : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    }`}
                  >
                    {isOutOfStock ? (
                      <AlertTriangle className="w-5 h-5 animate-pulse" aria-hidden="true" />
                    ) : (
                      <Shield className="w-5 h-5" aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            isOutOfStock ? 'bg-red-400' : 'bg-emerald-400'
                          }`}
                        />
                        <span
                          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                            isOutOfStock ? 'bg-red-500' : 'bg-emerald-400'
                          }`}
                        />
                      </span>
                      <span
                        className={`font-display font-bold text-xl sm:text-2xl tabular-nums transition-colors duration-500 ${
                          isOutOfStock ? 'text-red-400' : 'text-zinc-100'
                        }`}
                      >
                        {liveAvailable.toLocaleString()} Robux Available
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {isOutOfStock
                        ? 'Robux stock is currently empty (0 available). Please wait for restock before placing an order.'
                        : 'Official community group funds ready for instant transfer · 15-hour delivery window.'}
                    </p>
                  </div>
                </div>
                <div
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-all duration-500 ${
                    isOutOfStock
                      ? 'bg-red-500/15 border-red-500/40 text-red-300 animate-pulse'
                      : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                  }`}
                >
                  {isOutOfStock ? '🔴 Out of Stock' : '🟢 Live Stock Active'}
                </div>
              </div>
              {isOutOfStock && (
                <div className="mt-4">
                  <RestockCountdownCard
                    availableRobux={liveAvailable}
                    restockTimestamp={groupSettings?.restockTimestamp}
                  />
                </div>
              )}
            </div>
          );
        })()}

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
          errorMessage={errorMessage}
          paymentError={paymentError}
          selectedPaymentId={selectedPaymentId}
          orderReceipt={orderReceipt}
          liveReceiptOrder={liveReceiptOrder}
          onRequireSignIn={requireSignInPrompt}
          onGroupLinkClick={handleGroupLinkClick}
          onVerifyMembership={handleVerifyMembership}
          onAdminUnlockTimer={handleAdminUnlockTimer}
          onResetVerification={handleResetVerification}
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
          onCompleteOrder={(trxId) => void handleCompleteOrder(trxId)}
        />

        {/* LIVE CUSTOMER ORDER STATUS & CONFIRMATION TRACKER */}
        {session?.role === 'user' && (
          <CustomerOrdersSection
            userEmail={currentUser ? currentUser.email : session.email}
            orders={userOrders}
            onRefresh={() => void syncFromServer()}
          />
        )}

        {/* 4. FAQ SECTION */}
        <section
          id="faq"
          className="py-20 border-t border-white/[0.08]"
          aria-labelledby="faq-heading"
        >
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <div className="max-w-xl">
              <p className="text-xs font-medium tracking-wide text-amber-400 mb-2">
                Payout Policy
              </p>
              <h2
                id="faq-heading"
                className="font-display text-3xl font-bold tracking-tight text-zinc-100"
              >
                Frequently Asked Questions
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {FAQ_ITEMS.map((item, idx) => (
                <div
                  key={item.q}
                  className="rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-3"
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
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] py-10 bg-[#090B0E]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display font-semibold text-zinc-300">
              RobuxOra
            </span>
            <span aria-hidden="true">·</span>
            <span>Velvet Visions Studio Community Storefront</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <a
              href="#packages"
              className="hover:text-zinc-300 transition-colors whitespace-nowrap"
            >
              Packages
            </a>
            <a
              href="#verification"
              className="hover:text-zinc-300 transition-colors whitespace-nowrap"
            >
              Verification
            </a>
            <a
              href="#payment"
              className="hover:text-zinc-300 transition-colors whitespace-nowrap"
            >
              Payment
            </a>
          </div>
        </div>
      </footer>

      {/* Checkout & Real-Time API Verification Modal */}
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
        errorMessage={errorMessage}
        paymentError={paymentError}
        selectedPaymentId={selectedPaymentId}
        orderReceipt={orderReceipt}
        onClose={() => setIsCheckoutModalOpen(false)}
        onRequireSignIn={requireSignInPrompt}
        onGroupLinkClick={handleGroupLinkClick}
        onVerifyMembership={handleVerifyMembership}
        onAdminUnlockTimer={handleAdminUnlockTimer}
        onResetVerification={handleResetVerification}
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
        onSubmitOrder={(trxId) => void handleCompleteOrder(trxId)}
      />

      {/* Sign In / Create Account / Admin Sign In Modal */}
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

      {/* User Profile & Personal Order History Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        user={currentUser}
        existingUsers={users}
        orders={userOrders}
        onClose={() => setIsProfileModalOpen(false)}
        onSaveProfile={handleSaveProfile}
        onSignOut={handleSignOut}
      />

      {/* Robux Out of Stock Popup */}
      {outOfStockAlert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="out-of-stock-popup-title"
          onClick={() => setOutOfStockAlert(null)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl bg-[#131820] border border-red-500/50 p-6 shadow-2xl space-y-4 stock-alert-red"
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
    </div>
  );
}
