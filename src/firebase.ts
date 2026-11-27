import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ADMIN_EMAIL,
  GroupSettings,
  OrderRecord,
  RobuxPackage,
  normalizeOrderStatus,
} from './data/packages';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'storeSettings', 'group'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export interface PersistedVerification {
  userId: string;
  packageId: 'pkg-400' | 'pkg-800' | 'pkg-1700';
  robloxUsername: string;
  hasClickedGroupLink: boolean;
  hasConfirmedCheckbox: boolean;
  isGroupVerified: boolean;
  unlockAtMs: number;
}

export interface PersistedOrder {
  id: string;
  userId: string;
  orderNumber: string;
  packageId: 'pkg-400' | 'pkg-800' | 'pkg-1700';
  packageTitle: string;
  robuxAmount: number;
  priceUsd: number;
  paymentMethod: string;
  robloxUsername: string;
  status: 'queued' | 'completed';
  createdAtMs: number;
}

export async function signInWithGoogleAccount(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const safeName = (user.displayName || user.email?.split('@')[0] || 'Player')
    .trim()
    .slice(0, 100);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: user.uid,
        displayName: safeName || 'Player',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: safeName || 'Player',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveVerificationState(
  userId: string,
  state: Omit<PersistedVerification, 'userId'>
): Promise<void> {
  const path = `users/${userId}/verifications/current`;
  const ref = doc(db, 'users', userId, 'verifications', 'current');
  const sanitizedUsername = state.robloxUsername.trim().slice(0, 32);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId,
        packageId: state.packageId,
        robloxUsername: sanitizedUsername,
        hasClickedGroupLink: state.hasClickedGroupLink,
        hasConfirmedCheckbox: state.hasConfirmedCheckbox,
        isGroupVerified: state.isGroupVerified,
        unlockAtMs: state.unlockAtMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        packageId: state.packageId,
        robloxUsername: sanitizedUsername,
        hasClickedGroupLink: state.hasClickedGroupLink,
        hasConfirmedCheckbox: state.hasConfirmedCheckbox,
        isGroupVerified: state.isGroupVerified,
        unlockAtMs: state.unlockAtMs,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeVerificationState(
  userId: string,
  onData: (data: PersistedVerification | null) => void,
  onError?: (error: Error) => void
) {
  const path = `users/${userId}/verifications/current`;
  const ref = doc(db, 'users', userId, 'verifications', 'current');

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      const d = snapshot.data();
      onData({
        userId: String(d.userId || userId),
        packageId: d.packageId as PersistedVerification['packageId'],
        robloxUsername: String(d.robloxUsername || ''),
        hasClickedGroupLink: Boolean(d.hasClickedGroupLink),
        hasConfirmedCheckbox: Boolean(d.hasConfirmedCheckbox),
        isGroupVerified: Boolean(d.isGroupVerified),
        unlockAtMs: Number(d.unlockAtMs || 0),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createRobuxOrder(
  userId: string,
  order: Omit<PersistedOrder, 'id' | 'userId' | 'status' | 'createdAtMs'>
): Promise<void> {
  const orderId = order.orderNumber.replace(/[^A-Z0-9\-]/g, '');
  const path = `users/${userId}/orders/${orderId}`;
  const ref = doc(db, 'users', userId, 'orders', orderId);

  try {
    await setDoc(ref, {
      userId,
      orderNumber: orderId.slice(0, 32),
      packageId: order.packageId,
      packageTitle: order.packageTitle.slice(0, 40),
      robuxAmount: order.robuxAmount,
      priceUsd: order.priceUsd,
      paymentMethod: order.paymentMethod.slice(0, 64),
      robloxUsername: order.robloxUsername.trim().slice(0, 32),
      status: 'queued',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeUserOrders(
  userId: string,
  onData: (orders: PersistedOrder[]) => void,
  onError?: (error: Error) => void
) {
  const path = `users/${userId}/orders`;
  const q = query(
    collection(db, 'users', userId, 'orders'),
    where('userId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: PersistedOrder[] = snapshot.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const createdAtTs = d.createdAt as { toMillis?: () => number } | null;
          return {
            id: docSnap.id,
            userId: String(d.userId || userId),
            orderNumber: String(d.orderNumber || docSnap.id),
            packageId: d.packageId as PersistedOrder['packageId'],
            packageTitle: String(d.packageTitle || ''),
            robuxAmount: Number(d.robuxAmount || 0),
            priceUsd: Number(d.priceUsd || 0),
            paymentMethod: String(d.paymentMethod || ''),
            robloxUsername: String(d.robloxUsername || ''),
            status: (d.status as PersistedOrder['status']) || 'queued',
            createdAtMs: createdAtTs?.toMillis
              ? createdAtTs.toMillis()
              : Date.now(),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

// ---------- RobuxOra Storefront Cloud Persistence (Firestore) ----------

export function isFirebaseAdminConnected(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );
}

export function subscribeFirebaseAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signInAdminWithGoogle(forceSelect = false): Promise<User> {
  if (forceSelect) {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  } else {
    googleProvider.setCustomParameters({});
  }
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(credential.user);
  return credential.user;
}

function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  return cleaned || `id-${Date.now()}`;
}

export function subscribeStorePackages(
  onData: (packages: RobuxPackage[]) => void,
  onError?: (error: Error) => void
) {
  const path = 'packages';
  // Matches allow list: if resource.data.robux > 0;
  const q = query(collection(db, path), where('robux', '>', 0));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: RobuxPackage[] = snapshot.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            robux: Number(d.robux || 0),
            title: String(d.title || ''),
            tierLabel: String(d.tierLabel || 'Custom Bundle'),
            priceBdt: Number(d.priceBdt || 0),
            deliveryNote: String(d.deliveryNote || 'Group Payout'),
            image:
              typeof d.image === 'string' &&
              !d.image.startsWith('/src/assets/images/pkg_')
                ? d.image
                : '',
          };
        })
        .filter((p) => p.robux > 0 && p.priceBdt > 0)
        .sort((a, b) => a.robux - b.robux);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function upsertStorePackage(pkg: RobuxPackage): Promise<void> {
  const safeId = sanitizeDocId(pkg.id);
  const path = `packages/${safeId}`;
  const ref = doc(db, 'packages', safeId);

  const cleanImage =
    typeof pkg.image === 'string' &&
    !pkg.image.startsWith('/src/assets/images/pkg_')
      ? pkg.image.trim().slice(0, 500)
      : '';

  const payload = {
    robux: Math.max(1, Math.min(10000000, Number(pkg.robux) || 1)),
    title: String(pkg.title || `${pkg.robux} Robux`).trim().slice(0, 80),
    tierLabel: String(pkg.tierLabel || 'Custom Bundle').trim().slice(0, 80),
    priceBdt: Math.max(1, Math.min(10000000, Number(pkg.priceBdt) || 1)),
    deliveryNote: String(pkg.deliveryNote || 'Group Payout').trim().slice(0, 80),
    image: cleanImage,
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: safeId,
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeStorePackage(packageId: string): Promise<void> {
  const safeId = sanitizeDocId(packageId);
  const path = `packages/${safeId}`;
  try {
    await deleteDoc(doc(db, 'packages', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeStoreSettings(
  onData: (settings: GroupSettings | null) => void,
  onError?: (error: Error) => void
) {
  const path = 'storeSettings/group';
  const ref = doc(db, 'storeSettings', 'group');

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      const d = snapshot.data();
      const groupId = Number(d.groupId);
      const groupUrl = String(d.groupUrl || '').trim();
      const availableRobux = Number(d.availableRobux);
      const restockTimestamp = Number(d.restockTimestamp);
      const updatedAtMs =
        d.updatedAt && typeof d.updatedAt.toMillis === 'function'
          ? d.updatedAt.toMillis()
          : 0;
      if (groupId > 0 && groupUrl) {
        onData({
          groupId,
          groupUrl,
          availableRobux: !isNaN(availableRobux) && availableRobux >= 0 ? availableRobux : 25400,
          restockTimestamp: !isNaN(restockTimestamp) && restockTimestamp > 0 ? restockTimestamp : undefined,
          updatedAtMs,
        });
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveStoreGroupSettings(
  settings: GroupSettings
): Promise<void> {
  const path = 'storeSettings/group';
  const ref = doc(db, 'storeSettings', 'group');
  const payload: Record<string, unknown> = {
    groupId: Math.max(1, Number(settings.groupId) || 1),
    groupUrl: String(settings.groupUrl || '').trim().slice(0, 500),
    availableRobux: Math.max(0, Math.min(1000000000, Math.round(Number(settings.availableRobux ?? 25400) || 0))),
    updatedAt: serverTimestamp(),
  };
  if (
    typeof settings.restockTimestamp === 'number' &&
    Number.isFinite(settings.restockTimestamp) &&
    settings.restockTimestamp >= 0
  ) {
    payload.restockTimestamp = Math.round(settings.restockTimestamp);
  }

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, payload);
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeStoreOrders(
  onData: (orders: OrderRecord[]) => void,
  onError?: (error: Error) => void
) {
  const path = 'storeOrders';
  const col = collection(db, path);

  return onSnapshot(
    col,
    (snapshot) => {
      const items: OrderRecord[] = snapshot.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id || docSnap.id),
            orderNumber: String(d.orderNumber || 'BM-0000'),
            userEmail: String(d.userEmail || ''),
            userName: String(d.userName || 'Customer'),
            userPhone: String(d.userPhone || ''),
            robloxUsername: String(d.robloxUsername || 'Verified Member'),
            robloxUserId:
              typeof d.robloxUserId === 'number' && d.robloxUserId > 0
                ? d.robloxUserId
                : null,
            packageId: String(d.packageId || ''),
            packageTitle: String(d.packageTitle || ''),
            robuxAmount: Number(d.robuxAmount || 0),
            priceBdt: Number(d.priceBdt || 0),
            paymentMethod: String(d.paymentMethod || 'Nagad'),
            transactionId:
              typeof d.transactionId === 'string' && d.transactionId
                ? d.transactionId
                : undefined,
            paymentVerified: Boolean(d.paymentVerified),
            status: normalizeOrderStatus(d.status),
            verifiedAtMs: Number(d.verifiedAtMs || 0) || undefined,
            unlockAtMs: Number(d.unlockAtMs || 0) || undefined,
            createdAt: String(d.createdAtIso || new Date().toISOString()),
          };
        })
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function upsertStoreOrder(order: OrderRecord): Promise<void> {
  const safeId = sanitizeDocId(order.id);
  const path = `storeOrders/${safeId}`;
  const ref = doc(db, 'storeOrders', safeId);

  const safeOrderNum =
    String(order.orderNumber || 'BM-0000')
      .toUpperCase()
      .replace(/[^A-Z0-9\-]/g, '')
      .slice(0, 32) || 'BM-0000';

  const mutableFields = {
    orderNumber: safeOrderNum.length >= 4 ? safeOrderNum : 'BM-0000',
    userEmail: String(order.userEmail || 'customer@gmail.com')
      .trim()
      .slice(0, 160),
    userName: (String(order.userName || 'Customer').trim() || 'Customer').slice(
      0,
      120
    ),
    userPhone: String(order.userPhone || '').trim().slice(0, 40),
    robloxUsername: String(order.robloxUsername || 'Verified Member')
      .trim()
      .slice(0, 40),
    robloxUserId:
      typeof order.robloxUserId === 'number' && order.robloxUserId >= 0
        ? order.robloxUserId
        : 0,
    packageId: String(order.packageId || '').slice(0, 128),
    packageTitle: (
      String(order.packageTitle || 'Robux').trim() || 'Robux'
    ).slice(0, 80),
    robuxAmount: Math.max(0, Math.min(10000000, Number(order.robuxAmount) || 0)),
    priceBdt: Math.max(0, Math.min(10000000, Number(order.priceBdt) || 0)),
    paymentMethod: (
      String(order.paymentMethod || 'Nagad').trim() || 'Nagad'
    ).slice(0, 80),
    transactionId: String(order.transactionId || '')
      .trim()
      .toUpperCase()
      .slice(0, 32),
    paymentVerified: Boolean(order.paymentVerified),
    status: order.status,
    verifiedAtMs: Math.max(0, Number(order.verifiedAtMs) || 0),
    unlockAtMs: Math.max(0, Number(order.unlockAtMs) || 0),
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: safeId,
        ...mutableFields,
        createdAtIso: String(order.createdAt || new Date().toISOString()).slice(
          0,
          64
        ),
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, mutableFields);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeStoreOrder(orderId: string): Promise<void> {
  const safeId = sanitizeDocId(orderId);
  const path = `storeOrders/${safeId}`;
  try {
    await deleteDoc(doc(db, 'storeOrders', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

