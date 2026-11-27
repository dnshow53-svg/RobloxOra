import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Copy,
  ImagePlus,
  Loader2,
  LogOut,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  User,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  ADMIN_EMAIL,
  GroupSettings,
  OrderRecord,
  OrderStatus,
  RegisteredUser,
  RobuxPackage,
  VerifiedPaymentRecord,
  formatCountdown,
  getSecurityHoldProgress,
  normalizeOrderStatus,
} from '../data/packages';

interface AdminDashboardProps {
  packages: RobuxPackage[];
  orders: OrderRecord[];
  users: RegisteredUser[];
  verifiedPayments: VerifiedPaymentRecord[];
  groupSettings: GroupSettings;
  isCloudConnected: boolean;
  connectedCloudEmail: string | null;
  isSyncingCloud: boolean;
  onConnectCloud: (forceSelect?: boolean) => void;
  onSyncCloudNow: () => void;
  onSignOut: () => void;
  onAddPackage: (pkg: RobuxPackage) => Promise<void> | void;
  onUpdatePackage: (pkg: RobuxPackage) => Promise<void> | void;
  onDeletePackage: (id: string) => Promise<void> | void;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void> | void;
  onUnlockOrderTimer: (orderId: string) => void;
  onDeleteOrder: (orderId: string) => void;
  onAddVerifiedPayment: (payload: {
    method: 'Nagad' | 'Rocket' | 'bKash';
    trxId: string;
    amountBdt: number;
    senderPhone?: string;
  }) => Promise<{ ok: boolean; error?: string; autoApprovedOrder?: string | null }>;
  onDeleteVerifiedPayment: (id: string) => void;
  onRefreshOrders: () => void;
  onSaveGroupSettings: (settings: GroupSettings) => Promise<void> | void;
}

const sanitizeImage = (url?: string): string => {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('/src/assets/images/pkg_')) return '';
  return trimmed;
};

async function compressImageToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file'));
      el.src = objectUrl;
    });

    const maxDim = 1000;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || maxDim) * scale));
    const height = Math.max(1, Math.round((img.height || maxDim) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas unavailable');
    }
    ctx.drawImage(img, 0, 0, width, height);
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(mime, 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadProductPhoto(file: File): Promise<string> {
  let dataUrl: string;
  try {
    dataUrl = await compressImageToDataUrl(file);
  } catch {
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Could not read file'));
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  try {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        return data.url;
      }
    } else if (contentType.includes('application/json')) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 400 && errBody.error) {
        throw new Error(errBody.error);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Image')) {
      throw err;
    }
  }

  return dataUrl;
}

export function AdminDashboard({
  packages,
  orders,
  users,
  verifiedPayments,
  groupSettings,
  isCloudConnected,
  connectedCloudEmail,
  isSyncingCloud,
  onConnectCloud,
  onSyncCloudNow,
  onSignOut,
  onAddPackage,
  onUpdatePackage,
  onDeletePackage,
  onUpdateOrderStatus,
  onUnlockOrderTimer,
  onDeleteOrder,
  onAddVerifiedPayment,
  onDeleteVerifiedPayment,
  onRefreshOrders,
  onSaveGroupSettings,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'packages' | 'orders' | 'payments' | 'group'>(
    'packages'
  );
  const [orderFilter, setOrderFilter] = useState<'All' | OrderStatus>('All');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [pkgNotice, setPkgNotice] = useState<string | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [robuxAmount, setRobuxAmount] = useState('');
  const [priceBdt, setPriceBdt] = useState('');
  const [bonusTag, setBonusTag] = useState('Group Payout');
  const [productImage, setProductImage] = useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const addPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Inline edit state for existing packages
  const [editingPkgId, setEditingPkgId] = useState<string | null>(null);
  const [editBdt, setEditBdt] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editImage, setEditImage] = useState('');
  const [isUploadingEditPhoto, setIsUploadingEditPhoto] = useState(false);

  // Payment Inbox (01764088123) state
  const [payMethod, setPayMethod] = useState<'Nagad' | 'Rocket' | 'bKash'>('Nagad');
  const [payTrxId, setPayTrxId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [paySender, setPaySender] = useState('');
  const [payNotice, setPayNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const defaultRestockRemainingSec = groupSettings.restockTimestamp
    ? Math.max(0, Math.ceil((groupSettings.restockTimestamp - Date.now()) / 1000))
    : 153833;
  const [editRestockDays, setEditRestockDays] = useState(
    String(Math.floor(defaultRestockRemainingSec / 86400))
  );
  const [editRestockHours, setEditRestockHours] = useState(
    String(Math.floor((defaultRestockRemainingSec % 86400) / 3600))
  );
  const [liveRestockDays, setLiveRestockDays] = useState(
    String(Math.floor(defaultRestockRemainingSec / 86400))
  );
  const [liveRestockHours, setLiveRestockHours] = useState(
    String(Math.floor((defaultRestockRemainingSec % 86400) / 3600))
  );

  const [editGroupId, setEditGroupId] = useState(String(groupSettings.groupId));
  const [editGroupUrl, setEditGroupUrl] = useState(groupSettings.groupUrl);
  const [editAvailableRobux, setEditAvailableRobux] = useState(
    String(groupSettings.availableRobux ?? 25400)
  );
  const [liveRobuxInput, setLiveRobuxInput] = useState(
    String(groupSettings.availableRobux ?? 25400)
  );
  const [isSavingLiveRobux, setIsSavingLiveRobux] = useState(false);
  const [liveRobuxNotice, setLiveRobuxNotice] = useState<string | null>(null);
  const [liveRobuxError, setLiveRobuxError] = useState<string | null>(null);
  const [groupSavedNotice, setGroupSavedNotice] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [brokenAvatarUrls, setBrokenAvatarUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const markAvatarBroken = (url: string) => {
    setBrokenAvatarUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  const normalizedOrders = useMemo(() => {
    return orders.map((ord) => ({
      ...ord,
      status: normalizeOrderStatus(ord.status),
    }));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return normalizedOrders.filter((ord) => {
      if (orderFilter !== 'All' && ord.status !== orderFilter) return false;
      if (!q) return true;
      return (
        ord.orderNumber.toLowerCase().includes(q) ||
        ord.userName.toLowerCase().includes(q) ||
        ord.userEmail.toLowerCase().includes(q) ||
        (ord.userPhone || '').toLowerCase().includes(q) ||
        (ord.transactionId || '').toLowerCase().includes(q) ||
        ord.robloxUsername.toLowerCase().includes(q) ||
        ord.packageTitle.toLowerCase().includes(q) ||
        ord.paymentMethod.toLowerCase().includes(q)
      );
    });
  }, [normalizedOrders, orderFilter, orderSearch]);

  const userAvatarByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      if (u.email && u.avatar) {
        map.set(u.email.toLowerCase(), u.avatar);
      }
    }
    return map;
  }, [users]);

  const formatWaitRemaining = (ord: OrderRecord): string | null => {
    if (typeof ord.unlockAtMs !== 'number' || ord.unlockAtMs <= 0) return null;
    const secsLeft = Math.max(0, Math.ceil((ord.unlockAtMs - nowMs) / 1000));
    if (secsLeft === 0) return '15-Day Hold Completed (Ready to Pay)';
    const c = formatCountdown(secsLeft);
    return `${c.days}d ${c.hours}h ${c.minutes}m ${c.seconds}s left`;
  };

  const handleOrderStatusClick = async (order: OrderRecord, status: OrderStatus) => {
    await onUpdateOrderStatus(order.id, status);
    setOrderNotice(`Order ${order.orderNumber} marked ${status}.`);
  };

  useEffect(() => {
    setEditGroupId(String(groupSettings.groupId));
    setEditGroupUrl(groupSettings.groupUrl);
    const stockStr = String(groupSettings.availableRobux ?? 25400);
    setEditAvailableRobux(stockStr);
    setLiveRobuxInput(stockStr);
    if (groupSettings.restockTimestamp) {
      const secs = Math.max(0, Math.ceil((groupSettings.restockTimestamp - Date.now()) / 1000));
      const dStr = String(Math.floor(secs / 86400));
      const hStr = String(Math.floor((secs % 86400) / 3600));
      setEditRestockDays(dStr);
      setEditRestockHours(hStr);
      setLiveRestockDays(dStr);
      setLiveRestockHours(hStr);
    }
  }, [groupSettings]);

  const handleAddPhotoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoUploadError('Please select a PNG, JPG, WEBP, or GIF image file.');
      return;
    }
    setPhotoUploadError(null);
    setIsUploadingPhoto(true);
    try {
      const uploadedUrl = await uploadProductPhoto(file);
      setProductImage(uploadedUrl);
    } catch (err) {
      setPhotoUploadError(
        err instanceof Error ? err.message : 'Failed to upload product photo.'
      );
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleEditPhotoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPkgError('Please select a PNG, JPG, WEBP, or GIF image file.');
      return;
    }
    setPkgError(null);
    setIsUploadingEditPhoto(true);
    try {
      const uploadedUrl = await uploadProductPhoto(file);
      setEditImage(uploadedUrl);
    } catch (err) {
      setPkgError(
        err instanceof Error ? err.message : 'Failed to upload product photo.'
      );
    } finally {
      setIsUploadingEditPhoto(false);
    }
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isUploadingPhoto) return;
    const robux = Number(robuxAmount);
    const bdt = Number(priceBdt);

    if (!robux || robux <= 0 || !bdt || bdt <= 0) {
      setPkgError('Please enter valid positive numbers for Robux Amount and Price (BDT).');
      return;
    }

    setPkgError(null);
    const newPkg: RobuxPackage = {
      id: `pkg-${robux}-${Date.now()}`,
      robux,
      title: `${robux.toLocaleString()} Robux`,
      tierLabel: 'Custom Bundle',
      priceBdt: bdt,
      deliveryNote: bonusTag.trim() || 'Group Payout',
      image: sanitizeImage(productImage),
    };

    await onAddPackage(newPkg);
    setRobuxAmount('');
    setPriceBdt('');
    setBonusTag('Group Payout');
    setProductImage('');
    setPhotoUploadError(null);
    if (addPhotoInputRef.current) {
      addPhotoInputRef.current.value = '';
    }
    setPkgNotice(
      isCloudConnected
        ? `"${newPkg.title}" saved permanently to Cloud Database & Storefront.`
        : `"${newPkg.title}" added to Storefront. Connect Cloud Database above to keep it saved permanently across days & shared links.`
    );
  };

  const startEditingPackage = (pkg: RobuxPackage) => {
    setEditingPkgId(pkg.id);
    setEditBdt(String(pkg.priceBdt));
    setEditTag(pkg.deliveryNote);
    setEditImage(sanitizeImage(pkg.image));
  };

  const saveEditedPackage = async (pkg: RobuxPackage) => {
    if (isUploadingEditPhoto) return;
    const bdt = Number(editBdt);
    if (!bdt || bdt <= 0) {
      setPkgError('Price (BDT) must be greater than 0.');
      return;
    }
    setPkgError(null);
    await onUpdatePackage({
      ...pkg,
      priceBdt: bdt,
      deliveryNote: editTag.trim() || pkg.deliveryNote,
      image: sanitizeImage(editImage),
    });
    setEditingPkgId(null);
    setPkgNotice(`Updated "${pkg.title}" (৳${bdt} BDT).`);
  };

  const handleGroupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedId = Number(editGroupId.trim());
    const cleanUrl = editGroupUrl.trim();
    const parsedRobux = Number(editAvailableRobux.trim());
    const daysNum = Math.max(0, Number(editRestockDays) || 0);
    const hoursNum = Math.max(0, Number(editRestockHours) || 0);
    if (!parsedId || parsedId <= 0 || !cleanUrl) return;
    const nextRobux = isNaN(parsedRobux) ? 25400 : Math.max(0, Math.round(parsedRobux));
    const restockTimestamp = Date.now() + (daysNum * 86400000) + (hoursNum * 3600000);
    await onSaveGroupSettings({
      groupId: parsedId,
      groupUrl: cleanUrl,
      availableRobux: nextRobux,
      restockTimestamp,
    });
    setLiveRobuxInput(String(nextRobux));
    setGroupSavedNotice(true);
  };

  const handleAdjustLiveRobuxInput = (delta: number) => {
    setLiveRobuxError(null);
    setLiveRobuxNotice(null);
    const current = Number(liveRobuxInput.trim());
    const base = isNaN(current) ? (groupSettings.availableRobux ?? 25400) : current;
    const nextVal = Math.max(0, Math.round(base + delta));
    setLiveRobuxInput(String(nextVal));
    setEditAvailableRobux(String(nextVal));
  };

  const handleLiveRobuxSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLiveRobuxError(null);
    setLiveRobuxNotice(null);
    const parsed = Number(liveRobuxInput.trim());
    if (liveRobuxInput.trim() === '' || isNaN(parsed) || parsed < 0) {
      setLiveRobuxError('Please enter a valid Robux amount (0 or more).');
      return;
    }
    const nextRobux = Math.min(1000000000, Math.round(parsed));
    const daysNum = Math.max(0, Number(liveRestockDays) || 0);
    const hoursNum = Math.max(0, Number(liveRestockHours) || 0);
    const restockTimestamp = Date.now() + (daysNum * 86400000) + (hoursNum * 3600000);
    setIsSavingLiveRobux(true);
    try {
      await onSaveGroupSettings({
        ...groupSettings,
        availableRobux: nextRobux,
        restockTimestamp,
      });
      setLiveRobuxInput(String(nextRobux));
      setEditAvailableRobux(String(nextRobux));
      setLiveRobuxNotice(
        `Live storefront stock updated to ${nextRobux.toLocaleString()} Robux Available (${daysNum}d ${hoursNum}h restock timer).`
      );
    } finally {
      setIsSavingLiveRobux(false);
    }
  };

  const handleLogPaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPayError(null);
    setPayNotice(null);
    const amountNum = Number(payAmount);
    if (!payTrxId.trim() || !amountNum || amountNum <= 0) {
      setPayError('Please enter a valid Transaction ID and positive BDT amount.');
      return;
    }
    const result = await onAddVerifiedPayment({
      method: payMethod,
      trxId: payTrxId.trim(),
      amountBdt: amountNum,
      senderPhone: paySender.trim() || undefined,
    });
    if (!result.ok) {
      setPayError(result.error || 'Could not log payment.');
      return;
    }
    setPayTrxId('');
    setPayAmount('');
    setPaySender('');
    setPayNotice(
      result.autoApprovedOrder
        ? `Payment logged & auto-approved Order ${result.autoApprovedOrder}!`
        : 'Payment logged to 01764088123 Inbox! Customers submitting this TrxID will auto-verify immediately.'
    );
  };

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/payments/webhook`
      : '/api/payments/webhook';

  return (
    <section
      id="admin-dashboard"
      className="py-14 border-b border-amber-400/20 bg-[#0D1117]"
      aria-labelledby="admin-heading"
    >
      <div className="max-w-6xl mx-auto px-6 space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/15 text-amber-400 border border-amber-400/30">
              <Shield className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="admin-heading"
                className="font-display text-2xl font-bold text-zinc-100"
              >
                Admin Control Panel
              </h2>
              <p className="text-xs text-zinc-400">
                Add/remove packages, edit pricing, update Roblox Group ID/Link, and manage customer orders.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#131820] border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('packages')}
              className={`order-1 sm:order-none inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'packages'
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
              Manage Packages ({packages.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('orders');
                onRefreshOrders();
              }}
              className={`order-3 sm:order-none inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'orders'
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" aria-hidden="true" />
              Manage Orders ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('payments');
                onRefreshOrders();
              }}
              className={`order-4 sm:order-none inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'payments'
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
              01764088123 Inbox ({verifiedPayments.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('group');
                setGroupSavedNotice(false);
              }}
              className={`order-5 sm:order-none inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'group'
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              Group Settings
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="order-2 sm:order-last ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Cloud Database Persistence Bar (Firestore) */}
        <div
          className={`rounded-xl border px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isCloudConnected
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-amber-400/10 border-amber-400/30'
          }`}
        >
          <div className="flex items-start sm:items-center gap-2.5 text-xs">
            <Cloud
              className={`w-4 h-4 shrink-0 mt-0.5 sm:mt-0 ${
                isCloudConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
              aria-hidden="true"
            />
            <div>
              {isCloudConnected ? (
                <p className="font-semibold text-emerald-300">
                  Cloud Database Connected (Firestore) — Items &amp; Orders save permanently
                </p>
              ) : connectedCloudEmail &&
                connectedCloudEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ? (
                <p className="font-medium text-amber-300">
                  Signed into Google as {connectedCloudEmail}. Please switch to the store owner Google account to enable permanent Cloud Database saving.
                </p>
              ) : (
                <p className="font-medium text-amber-300">
                  Connect Cloud Database once so added Robux items, prices &amp; orders save permanently across days and shared links.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isCloudConnected ? (
              <button
                type="button"
                disabled={isSyncingCloud}
                onClick={onSyncCloudNow}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-3.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {isSyncingCloud ? 'Syncing...' : 'Sync All to Cloud'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onConnectCloud(Boolean(connectedCloudEmail))}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                {connectedCloudEmail ? 'Switch Google Account' : 'Connect Cloud Database'}
              </button>
            )}
          </div>
        </div>

        {/* Always-Visible Live Robux Stock Editor */}
        {(() => {
          const currentLive = groupSettings.availableRobux ?? 25400;
          const isZeroStock = currentLive <= 0;
          return (
            <form
              onSubmit={(e) => void handleLiveRobuxSubmit(e)}
              className={`rounded-xl bg-[#131820] border p-5 space-y-4 transition-all duration-500 ${
                isZeroStock
                  ? 'border-red-500/50 bg-red-500/[0.04] stock-alert-red'
                  : 'border-emerald-500/30'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full animate-pulse ${
                        isZeroStock ? 'bg-red-500' : 'bg-emerald-400'
                      }`}
                    />
                    <h3 className="font-display text-base font-bold text-zinc-100">
                      Live Storefront Robux Stock
                    </h3>
                    <span
                      className={`rounded-md border px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums transition-colors duration-500 ${
                        isZeroStock
                          ? 'bg-red-500/15 border-red-500/40 text-red-300'
                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      Current: {currentLive.toLocaleString()} Robux {isZeroStock ? '· Out of Stock' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Change the live available Robux amount shown in the Storefront Stock Bar for all visitors.
                  </p>
                </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLiveRobuxInput('0');
                  setEditAvailableRobux('0');
                  setLiveRobuxNotice(null);
                  setLiveRobuxError(null);
                }}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                  liveRobuxInput === '0'
                    ? 'bg-red-500/25 border-red-500/60 text-red-300'
                    : 'bg-[#090B0E] border-red-500/30 text-red-400 hover:bg-red-500/15'
                }`}
              >
                0 (Out of Stock)
              </button>
              {([5000, 10000, 25400] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setLiveRobuxInput(String(preset));
                    setEditAvailableRobux(String(preset));
                    setLiveRobuxNotice(null);
                    setLiveRobuxError(null);
                  }}
                  className={`min-h-[36px] rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors ${
                    liveRobuxInput === String(preset)
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                      : 'bg-[#090B0E] border-white/15 text-zinc-300 hover:border-amber-400/60'
                  }`}
                >
                  {preset.toLocaleString()}
                </button>
              ))}
              <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">|</span>
              {([-1000, -500, 500, 1000, 5000] as const).map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => handleAdjustLiveRobuxInput(delta)}
                  className="min-h-[36px] rounded-lg bg-[#090B0E] border border-white/15 px-2.5 py-1.5 font-mono text-xs font-medium text-zinc-200 hover:border-amber-400/60 hover:text-zinc-100 transition-colors"
                >
                  {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="adm-live-robux-quick" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Available Robux Amount
              </label>
              <input
                id="adm-live-robux-quick"
                type="number"
                min={0}
                max={1000000000}
                required
                value={liveRobuxInput}
                onChange={(e) => {
                  setLiveRobuxInput(e.target.value);
                  setEditAvailableRobux(e.target.value);
                  setLiveRobuxNotice(null);
                  setLiveRobuxError(null);
                }}
                placeholder="25400"
                className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/15 px-3.5 py-2 font-mono text-sm font-semibold text-zinc-100 focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="adm-live-restock-days" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Restock Timer (Days)
                </label>
                <input
                  id="adm-live-restock-days"
                  type="number"
                  min={0}
                  value={liveRestockDays}
                  onChange={(e) => {
                    setLiveRestockDays(e.target.value);
                    setLiveRobuxNotice(null);
                  }}
                  placeholder="1"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/15 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label htmlFor="adm-live-restock-hours" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Restock Timer (Hours)
                </label>
                <input
                  id="adm-live-restock-hours"
                  type="number"
                  min={0}
                  max={23}
                  value={liveRestockHours}
                  onChange={(e) => {
                    setLiveRestockHours(e.target.value);
                    setLiveRobuxNotice(null);
                  }}
                  placeholder="18"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/15 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSavingLiveRobux}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                {isSavingLiveRobux ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Updating...
                  </>
                ) : (
                  'Update Stock & Restock Timer'
                )}
              </button>
            </div>
          </div>

          {liveRobuxError && (
            <p role="alert" className="text-xs font-medium text-red-400">
              {liveRobuxError}
            </p>
          )}

          {liveRobuxNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2 text-xs font-medium text-emerald-300"
            >
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                {liveRobuxNotice}
              </span>
              <button
                type="button"
                onClick={() => setLiveRobuxNotice(null)}
                className="text-emerald-200/80 hover:text-white text-[11px]"
              >
                Dismiss
              </button>
            </div>
          )}
        </form>
          );
        })()}

        {/* Tab 1: Add, Edit Price, & Delete Packages */}
        {activeTab === 'packages' && (
          <div className="space-y-4">
            {pkgError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-xs font-medium text-red-300"
              >
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {pkgError}
                </span>
                <button
                  type="button"
                  onClick={() => setPkgError(null)}
                  className="text-red-200/80 hover:text-white text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}

            {pkgNotice && (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-medium text-emerald-300"
              >
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {pkgNotice}
                </span>
                <button
                  type="button"
                  onClick={() => setPkgNotice(null)}
                  className="text-emerald-200/80 hover:text-white text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <form
              onSubmit={(e) => void handleAddSubmit(e)}
              className="lg:col-span-5 rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-4"
            >
              <h3 className="font-display text-base font-semibold text-zinc-100">
                Add New Robux Package
              </h3>

              <div>
                <label htmlFor="adm-robux" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Robux Amount
                </label>
                <input
                  id="adm-robux"
                  type="number"
                  min={1}
                  required
                  value={robuxAmount}
                  onChange={(e) => setRobuxAmount(e.target.value)}
                  placeholder="e.g. 4500"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label htmlFor="adm-bdt" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Price (BDT)
                </label>
                <input
                  id="adm-bdt"
                  type="number"
                  min={1}
                  required
                  value={priceBdt}
                  onChange={(e) => setPriceBdt(e.target.value)}
                  placeholder="e.g. 5900"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label htmlFor="adm-tag" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Bonus / Tag
                </label>
                <input
                  id="adm-tag"
                  type="text"
                  value={bonusTag}
                  onChange={(e) => setBonusTag(e.target.value)}
                  placeholder="Best Value / +200 Bonus"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Product Photo (Optional)
                </label>

                <div className="space-y-2.5 rounded-lg bg-[#090B0E] border border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-lg bg-white/[0.06] border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors">
                      {isUploadingPhoto ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      )}
                      <span>{isUploadingPhoto ? 'Uploading...' : 'Add Product Photo'}</span>
                      <input
                        ref={addPhotoInputRef}
                        type="file"
                        accept="image/*"
                        disabled={isUploadingPhoto}
                        onChange={(e) => void handleAddPhotoFileChange(e)}
                        className="sr-only"
                      />
                    </label>

                    {sanitizeImage(productImage) && (
                      <button
                        type="button"
                        onClick={() => {
                          setProductImage('');
                          setPhotoUploadError(null);
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </div>

                  <input
                    id="adm-image-url"
                    type="text"
                    value={productImage}
                    onChange={(e) => setProductImage(e.target.value)}
                    placeholder="Or paste image URL (optional)"
                    className="w-full min-h-[38px] rounded-md bg-[#131820] border border-white/10 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
                  />

                  {photoUploadError && (
                    <p className="text-xs text-red-400">{photoUploadError}</p>
                  )}

                  {sanitizeImage(productImage) && (
                    <div className="flex items-center gap-3 pt-1">
                      <img
                        src={sanitizeImage(productImage)}
                        alt="Selected product preview"
                        className="h-14 w-14 rounded-lg object-cover border border-white/10 bg-[#131820]"
                      />
                      <span className="text-[11px] text-emerald-300 font-medium">
                        Product photo ready
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isUploadingPhoto}
                className="w-full min-h-[44px] rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60 transition-colors"
              >
                Add Item to Storefront
              </button>
            </form>

            <div className="lg:col-span-7 rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-4">
              <h3 className="font-display text-base font-semibold text-zinc-100">
                Active Storefront Items
              </h3>

              {packages.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No packages active. Add one on the left to publish to the shop.
                </p>
              ) : (
                <div className="space-y-3">
                  {packages.map((pkg) => {
                    const isEditing = editingPkgId === pkg.id;
                    const cleanImg = sanitizeImage(pkg.image);
                    return (
                      <div
                        key={pkg.id}
                        className="rounded-lg bg-[#0D1117] border border-white/[0.08] px-4 py-3 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {cleanImg && (
                              <img
                                src={cleanImg}
                                alt={pkg.title}
                                className="h-10 w-10 rounded-md object-cover border border-white/10 shrink-0"
                              />
                            )}
                            <div>
                              <div className="font-display font-semibold text-zinc-100">
                                {pkg.title}
                              </div>
                              <div className="text-xs text-zinc-400 font-mono tabular-nums mt-0.5">
                                ৳{pkg.priceBdt} BDT · {pkg.deliveryNote}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                isEditing
                                  ? setEditingPkgId(null)
                                  : startEditingPackage(pkg)
                              }
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors whitespace-nowrap"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              {isEditing ? 'Close' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void onDeletePackage(pkg.id);
                                setPkgNotice(`Deleted "${pkg.title}" from storefront.`);
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="space-y-3 pt-2.5 border-t border-white/[0.06]">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <input
                                type="number"
                                min={1}
                                aria-label="Edit price BDT"
                                value={editBdt}
                                onChange={(e) => setEditBdt(e.target.value)}
                                placeholder="BDT Price"
                                className="min-h-[36px] rounded bg-[#090B0E] border border-white/15 px-2.5 py-1 text-xs text-zinc-100"
                              />
                              <input
                                type="text"
                                aria-label="Edit package tag"
                                value={editTag}
                                onChange={(e) => setEditTag(e.target.value)}
                                placeholder="Tag"
                                className="min-h-[36px] rounded bg-[#090B0E] border border-white/15 px-2.5 py-1 text-xs text-zinc-100"
                              />
                              <button
                                type="button"
                                disabled={isUploadingEditPhoto}
                                onClick={() => void saveEditedPackage(pkg)}
                                className="min-h-[36px] rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60 transition-colors"
                              >
                                Save Changes
                              </button>
                            </div>

                            <div className="flex flex-wrap items-center gap-2.5">
                              <label className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded bg-white/[0.06] border border-white/15 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors">
                                {isUploadingEditPhoto ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" aria-hidden="true" />
                                ) : (
                                  <ImagePlus className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                                )}
                                <span>{isUploadingEditPhoto ? 'Uploading...' : 'Change Photo'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  disabled={isUploadingEditPhoto}
                                  onChange={(e) => void handleEditPhotoFileChange(e)}
                                  className="sr-only"
                                />
                              </label>
                              <input
                                type="text"
                                aria-label="Edit product photo URL"
                                value={editImage}
                                onChange={(e) => setEditImage(e.target.value)}
                                placeholder="Product image URL (optional)"
                                className="flex-1 min-w-[180px] min-h-[34px] rounded bg-[#090B0E] border border-white/15 px-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-500"
                              />
                              {sanitizeImage(editImage) && (
                                <>
                                  <img
                                    src={sanitizeImage(editImage)}
                                    alt="Preview"
                                    className="h-8 w-8 rounded object-cover border border-white/15"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditImage('')}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded bg-red-500/10 border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
                                  >
                                    <X className="w-3 h-3" aria-hidden="true" />
                                    Remove Photo
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </div>
          </div>
        )}

        {/* Tab 2: Order Management */}
        {activeTab === 'orders' && (
          <div className="rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-zinc-100">
                  Customer Purchase Requests &amp; Orders
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Review submitted orders, approve payouts, mark completed, or cancel/delete.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onRefreshOrders();
                  setOrderNotice('Orders synced with server.');
                }}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/10 px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors self-start sm:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Refresh Orders
              </button>
            </div>

            {orderNotice && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{orderNotice}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setOrderNotice(null)}
                  className="text-emerald-200/80 hover:text-white text-[11px] shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            {normalizedOrders.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['All', 'Waiting', 'Pending', 'Approved', 'Completed', 'Cancelled'] as const).map(
                    (st) => {
                      const count =
                        st === 'All'
                          ? normalizedOrders.length
                          : normalizedOrders.filter((o) => o.status === st).length;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setOrderFilter(st)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            orderFilter === st
                              ? 'bg-amber-400 text-zinc-950 font-semibold'
                              : 'bg-[#0D1117] border border-white/10 text-zinc-300 hover:text-white'
                          }`}
                        >
                          {st} ({count})
                        </button>
                      );
                    }
                  )}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search
                    className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search order #, phone, Roblox, email..."
                    aria-label="Search customer orders"
                    className="w-full min-h-[38px] rounded-lg bg-[#090B0E] border border-white/10 pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            )}

            {normalizedOrders.length === 0 ? (
              <div className="rounded-lg bg-[#0D1117] border border-white/[0.06] p-6 text-sm text-zinc-400 space-y-1">
                <p className="font-medium text-zinc-300">No waiting customers or orders yet.</p>
                <p className="text-xs text-zinc-500">
                  As soon as any signed-in customer verifies their Roblox membership and starts the 15-day timer (or submits payment), all of their details appear here automatically.
                </p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No orders match the current filter or search.
              </p>
            ) : (
              <>
                {/* Mobile Card Layout */}
                <div className="md:hidden space-y-3">
                  {filteredOrders.map((order) => {
                    const waitText = formatWaitRemaining(order);
                    const isTimerReady =
                      typeof order.unlockAtMs === 'number' &&
                      order.unlockAtMs > 0 &&
                      order.unlockAtMs <= nowMs;
                    const createdLabel = new Date(order.createdAt).toLocaleString();
                    const customerAvatar =
                      userAvatarByEmail.get(order.userEmail.toLowerCase()) || '';
                    return (
                      <div
                        key={order.id}
                        className="rounded-lg bg-[#0D1117] border border-white/[0.08] p-4 space-y-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono font-semibold text-amber-300">
                              {order.orderNumber}
                            </div>
                            <div className="font-medium text-zinc-100 mt-0.5">
                              {order.packageTitle} · ৳{order.priceBdt} BDT
                            </div>
                            <div className="text-zinc-400 mt-0.5">
                              {order.paymentMethod}
                            </div>
                            {order.transactionId && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-[11px] text-zinc-200 bg-white/[0.06] px-2 py-0.5 rounded">
                                  TrxID: {order.transactionId}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                    order.paymentVerified
                                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                                  }`}
                                >
                                  {order.paymentVerified ? 'Verified 01764088123' : 'Check 01764088123 App'}
                                </span>
                              </div>
                            )}
                          </div>
                          <span
                            className={`font-semibold px-2.5 py-1 rounded bg-white/[0.04] border border-white/10 shrink-0 ${
                              order.status === 'Completed' || order.status === 'Approved'
                                ? 'text-emerald-400'
                                : order.status === 'Cancelled'
                                ? 'text-red-400'
                                : order.status === 'Waiting'
                                ? 'text-sky-300'
                                : 'text-amber-300'
                            }`}
                          >
                            {order.status === 'Waiting' ? 'Waiting (15-Day Hold)' : order.status}
                          </span>
                        </div>

                        {waitText && (() => {
                          const hold = getSecurityHoldProgress(
                            order.verifiedAtMs,
                            order.unlockAtMs,
                            nowMs,
                            order.status === 'Approved' || order.status === 'Completed'
                          );
                          return (
                            <div
                              className={`rounded-lg border p-3 space-y-2 font-mono tabular-nums ${
                                isTimerReady
                                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
                                  : 'bg-[#131820] border-amber-400/30 text-amber-300'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-sans font-medium">
                                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  {isTimerReady ? 'Hold Completed' : `15-Day Timer (${hold.percent}%)`}
                                </span>
                                <span className="font-semibold text-[11px]">
                                  {isTimerReady ? 'Ready to Pay' : waitText}
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-[#090B0E] border border-white/10 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isTimerReady
                                      ? 'bg-emerald-400'
                                      : 'bg-gradient-to-r from-amber-500 to-sky-400'
                                  }`}
                                  style={{
                                    width: `${isTimerReady ? 100 : Math.max(3, hold.percent)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })()}

                        <div className="pt-2 border-t border-white/[0.06] space-y-1.5 text-zinc-300">
                          <div className="flex items-center gap-2.5 pb-1">
                            {customerAvatar && !brokenAvatarUrls.has(customerAvatar) ? (
                              <img
                                src={customerAvatar}
                                alt={order.userName}
                                onError={() => markAvatarBroken(customerAvatar)}
                                className="h-9 w-9 rounded-full object-cover border border-amber-400/50 shrink-0"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/25 shrink-0">
                                <User className="w-4 h-4" aria-hidden="true" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate">
                                Customer: <span className="text-zinc-100 font-medium">{order.userName}</span>
                              </div>
                            </div>
                          </div>
                          <div>
                            Gmail: <span className="text-zinc-100 break-all">{order.userEmail}</span>
                          </div>
                          <div>
                            Phone: <span className="font-mono text-zinc-100">{order.userPhone || 'Not provided'}</span>
                          </div>
                          <div>
                            Roblox Username: <span className="font-mono text-zinc-100">{order.robloxUsername || 'Verified Member'}</span>
                            {typeof order.robloxUserId === 'number' && (
                              <span className="text-zinc-500"> (ID: {order.robloxUserId})</span>
                            )}
                          </div>
                          <div>
                            Submitted / Verified: <span className="text-zinc-400">{createdLabel}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {order.status === 'Waiting' &&
                            typeof order.unlockAtMs === 'number' &&
                            order.unlockAtMs > nowMs && (
                              <button
                                type="button"
                                onClick={() => {
                                  onUnlockOrderTimer(order.id);
                                  setOrderNotice(
                                    `Timer completed for ${order.robloxUsername || order.userName} (${order.orderNumber}) — payment unlocked.`
                                  );
                                }}
                                className="col-span-2 min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded bg-amber-400/15 border border-amber-400/40 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/25"
                              >
                                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                                Unlock Timer Now (Allow Payment)
                              </button>
                            )}
                          <button
                            type="button"
                            onClick={() => void handleOrderStatusClick(order, 'Approved')}
                            className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded bg-sky-500/15 border border-sky-500/30 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOrderStatusClick(order, 'Completed')}
                            className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
                          >
                            <Check className="w-3 h-3" aria-hidden="true" />
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOrderStatusClick(order, 'Cancelled')}
                            className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
                          >
                            <XCircle className="w-3 h-3" aria-hidden="true" />
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteOrder(order.id);
                              setOrderNotice(`Order ${order.orderNumber} deleted.`);
                            }}
                            className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded bg-red-500/15 border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table Layout */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] text-zinc-400">
                        <th className="py-3 pr-4 font-medium">Order / Time</th>
                        <th className="py-3 pr-4 font-medium">Customer Details</th>
                        <th className="py-3 pr-4 font-medium">Roblox &amp; Hold Timer</th>
                        <th className="py-3 pr-4 font-medium">Package &amp; Payment</th>
                        <th className="py-3 pr-4 font-medium">Amount</th>
                        <th className="py-3 pr-4 font-medium">Status</th>
                        <th className="py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] text-zinc-200">
                      {filteredOrders.map((order) => {
                        const waitText = formatWaitRemaining(order);
                        const customerAvatar =
                          userAvatarByEmail.get(order.userEmail.toLowerCase()) || '';
                        return (
                          <tr key={order.id}>
                            <td className="py-3.5 pr-4 align-top">
                              <div className="font-mono tabular-nums text-amber-300 font-semibold">
                                {order.orderNumber}
                              </div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">
                                {new Date(order.createdAt).toLocaleString()}
                              </div>
                            </td>
                            <td className="py-3.5 pr-4 align-top">
                              <div className="flex items-start gap-2.5">
                                {customerAvatar && !brokenAvatarUrls.has(customerAvatar) ? (
                                  <img
                                    src={customerAvatar}
                                    alt={order.userName}
                                    onError={() => markAvatarBroken(customerAvatar)}
                                    className="h-9 w-9 rounded-full object-cover border border-amber-400/50 shrink-0 mt-0.5"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/25 shrink-0 mt-0.5">
                                    <User className="w-4 h-4" aria-hidden="true" />
                                  </div>
                                )}
                                <div>
                                  <div className="font-medium text-zinc-100">{order.userName}</div>
                                  <div className="text-zinc-400">{order.userEmail}</div>
                                  <div className="font-mono text-[11px] text-zinc-400 mt-0.5">
                                    {order.userPhone || 'No phone'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-4 align-top">
                              <div className="font-mono text-zinc-100">
                                {order.robloxUsername || 'Verified Member'}
                              </div>
                              {typeof order.robloxUserId === 'number' && (
                                <div className="text-[11px] text-zinc-500">
                                  ID: {order.robloxUserId}
                                </div>
                              )}
                              {waitText && (() => {
                                const hold = getSecurityHoldProgress(
                                  order.verifiedAtMs,
                                  order.unlockAtMs,
                                  nowMs,
                                  order.status === 'Approved' || order.status === 'Completed'
                                );
                                return (
                                  <div className="mt-1.5 space-y-1 max-w-[190px]">
                                    <div
                                      className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums ${
                                        hold.isComplete ? 'text-emerald-300' : 'text-amber-300'
                                      }`}
                                    >
                                      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                                      <span>{waitText}</span>
                                    </div>
                                    <div className="h-1.5 w-full rounded-full bg-[#090B0E] border border-white/10 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all duration-500 ${
                                          hold.isComplete
                                            ? 'bg-emerald-400'
                                            : 'bg-gradient-to-r from-amber-500 to-sky-400'
                                        }`}
                                        style={{
                                          width: `${hold.isComplete ? 100 : Math.max(3, hold.percent)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-3.5 pr-4 align-top">
                              <div className="font-medium">{order.packageTitle}</div>
                              <div className="text-zinc-400">{order.paymentMethod}</div>
                              {order.transactionId && (
                                <div className="mt-1 space-y-1">
                                  <div className="font-mono text-[11px] text-zinc-200">
                                    TrxID: {order.transactionId}
                                  </div>
                                  <span
                                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${
                                      order.paymentVerified
                                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                                    }`}
                                  >
                                    {order.paymentVerified ? (
                                      <>
                                        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                                        Verified 01764088123
                                      </>
                                    ) : (
                                      'Check 01764088123 App'
                                    )}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 pr-4 align-top font-mono tabular-nums">
                              ৳{order.priceBdt} BDT
                            </td>
                            <td className="py-3.5 pr-4 align-top">
                              <span
                                className={`font-semibold ${
                                  order.status === 'Completed' || order.status === 'Approved'
                                    ? 'text-emerald-400'
                                    : order.status === 'Cancelled'
                                    ? 'text-red-400'
                                    : order.status === 'Waiting'
                                    ? 'text-sky-300'
                                    : 'text-amber-300'
                                }`}
                              >
                                {order.status === 'Waiting' ? 'Waiting (15-Day Hold)' : order.status}
                              </span>
                            </td>
                            <td className="py-3.5 align-top">
                              <div className="flex flex-wrap items-center gap-2">
                                {order.status === 'Waiting' &&
                                  typeof order.unlockAtMs === 'number' &&
                                  order.unlockAtMs > nowMs && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onUnlockOrderTimer(order.id);
                                        setOrderNotice(
                                          `Timer completed for ${order.robloxUsername || order.userName} (${order.orderNumber}) — payment unlocked.`
                                        );
                                      }}
                                      className="inline-flex items-center gap-1 rounded bg-amber-400/15 border border-amber-400/40 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/25 transition-colors"
                                    >
                                      <Zap className="w-3 h-3" aria-hidden="true" />
                                      Unlock Timer
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  onClick={() => void handleOrderStatusClick(order, 'Approved')}
                                  className="inline-flex items-center gap-1 rounded bg-sky-500/15 border border-sky-500/30 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleOrderStatusClick(order, 'Completed')}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                                >
                                  <Check className="w-3 h-3" aria-hidden="true" />
                                  Complete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleOrderStatusClick(order, 'Cancelled')}
                                  className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
                                >
                                  <XCircle className="w-3 h-3" aria-hidden="true" />
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteOrder(order.id);
                                    setOrderNotice(`Order ${order.orderNumber} deleted.`);
                                  }}
                                  className="inline-flex items-center gap-1 rounded bg-red-500/15 border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Payment Inbox (01764088123 Nagad & Rocket Verification) */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="rounded-xl bg-[#131820] border border-amber-400/25 p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    Auto-Check Nagad &amp; Rocket Payments on 01764088123
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    Personal Nagad and Rocket apps on your phone do not have a public read API. To auto-verify real payments the second money arrives on <span className="font-mono text-zinc-200">01764088123</span>, install an Android SMS Forwarder app (e.g. SMS Forwarder / MacroDroid) on your phone and point Nagad &amp; Rocket SMS notifications to this webhook URL, or log incoming SMS TrxIDs below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl).catch(() => {});
                    setCopiedWebhook(true);
                    setTimeout(() => setCopiedWebhook(false), 2500);
                  }}
                  className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  {copiedWebhook ? 'Copied Webhook!' : 'Copy SMS Webhook URL'}
                </button>
              </div>
              <div className="rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-xs text-amber-300 break-all">
                POST {webhookUrl} — JSON body: {`{"sender":"Nagad","message":"You have received Tk 1180.00 ... TrxID 72A94K81M2"}`}
              </div>
            </div>

            {payError && (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-xs font-medium text-red-300">
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {payError}
                </span>
                <button type="button" onClick={() => setPayError(null)} className="text-red-200/80 hover:text-white text-[11px]">
                  Dismiss
                </button>
              </div>
            )}

            {payNotice && (
              <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-medium text-emerald-300">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {payNotice}
                </span>
                <button type="button" onClick={() => setPayNotice(null)} className="text-emerald-200/80 hover:text-white text-[11px]">
                  Dismiss
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <form
                onSubmit={(e) => void handleLogPaymentSubmit(e)}
                className="lg:col-span-5 rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-4"
              >
                <h3 className="font-display text-base font-semibold text-zinc-100">
                  Log Payment Received on 01764088123
                </h3>

                <div>
                  <label htmlFor="pay-method" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Wallet App
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'Nagad' | 'Rocket' | 'bKash')}
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="Nagad">Nagad (01764088123)</option>
                    <option value="Rocket">Rocket (01764088123)</option>
                    <option value="bKash">bKash</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="pay-trxid" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Transaction ID (TrxID)
                  </label>
                  <input
                    id="pay-trxid"
                    type="text"
                    required
                    value={payTrxId}
                    onChange={(e) => setPayTrxId(e.target.value)}
                    placeholder="e.g. 72A94K81M2"
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label htmlFor="pay-amount" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Amount Received (BDT)
                  </label>
                  <input
                    id="pay-amount"
                    type="number"
                    min={1}
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="e.g. 590"
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label htmlFor="pay-sender" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Sender Number (Optional)
                  </label>
                  <input
                    id="pay-sender"
                    type="text"
                    value={paySender}
                    onChange={(e) => setPaySender(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-300 transition-colors"
                >
                  Save &amp; Match Pending Orders
                </button>
              </form>

              <div className="lg:col-span-7 rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-4">
                <h3 className="font-display text-base font-semibold text-zinc-100">
                  Verified 01764088123 Payment Ledger
                </h3>

                {verifiedPayments.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    No incoming Nagad/Rocket SMS or logged payments yet. Add one on the left or connect your phone SMS Forwarder webhook above.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {verifiedPayments.map((pay) => (
                      <div
                        key={pay.id}
                        className="rounded-lg bg-[#0D1117] border border-white/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-amber-300">{pay.method}</span>
                            <span className="font-mono text-zinc-100 bg-white/[0.06] px-2 py-0.5 rounded">
                              {pay.trxId}
                            </span>
                            <span className="font-mono font-semibold text-emerald-400">
                              ৳{pay.amountBdt} BDT
                            </span>
                            {pay.usedByOrderId && (
                              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-300">
                                Matched {pay.usedByOrderId}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {pay.source === 'sms_webhook' ? 'SMS Webhook' : 'Admin Logged'} ·{' '}
                            {pay.senderPhone ? `From ${pay.senderPhone} · ` : ''}
                            {new Date(pay.receivedAt).toLocaleString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteVerifiedPayment(pay.id)}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Live Roblox Group ID & Group Link Settings */}
        {activeTab === 'group' && (
          <form
            onSubmit={(e) => void handleGroupSubmit(e)}
            className="max-w-2xl rounded-xl bg-[#131820] border border-white/[0.08] p-6 space-y-5"
          >
            <div>
              <h3 className="font-display text-base font-semibold text-zinc-100">
                Roblox Community API Settings
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                Update the target Roblox Group ID used for live membership checks and the community URL opened by Join Community.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label htmlFor="adm-group-id" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Roblox Group ID
                </label>
                <input
                  id="adm-group-id"
                  type="number"
                  min={1}
                  required
                  value={editGroupId}
                  onChange={(e) => {
                    setEditGroupId(e.target.value);
                    setGroupSavedNotice(false);
                  }}
                  placeholder="401717676"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="adm-group-url" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Group Link
                </label>
                <input
                  id="adm-group-url"
                  type="url"
                  required
                  value={editGroupUrl}
                  onChange={(e) => {
                    setEditGroupUrl(e.target.value);
                    setGroupSavedNotice(false);
                  }}
                  placeholder="https://www.roblox.com/communities/..."
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="adm-available-robux" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Available Robux Stock (Shown in Storefront Bar)
                </label>
                <input
                  id="adm-available-robux"
                  type="number"
                  min={0}
                  required
                  value={editAvailableRobux}
                  onChange={(e) => {
                    setEditAvailableRobux(e.target.value);
                    setGroupSavedNotice(false);
                  }}
                  placeholder="25400"
                  className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="sm:col-span-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="adm-restock-days" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Restock Timer (Days)
                  </label>
                  <input
                    id="adm-restock-days"
                    type="number"
                    min={0}
                    value={editRestockDays}
                    onChange={(e) => {
                      setEditRestockDays(e.target.value);
                      setGroupSavedNotice(false);
                    }}
                    placeholder="1"
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label htmlFor="adm-restock-hours" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Restock Timer (Hours)
                  </label>
                  <input
                    id="adm-restock-hours"
                    type="number"
                    min={0}
                    max={23}
                    value={editRestockHours}
                    onChange={(e) => {
                      setEditRestockHours(e.target.value);
                      setGroupSavedNotice(false);
                    }}
                    placeholder="18"
                    className="w-full min-h-[42px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            </div>

            {groupSavedNotice && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Group settings saved! Real-time verification now checks Group ID {editGroupId}.
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                className="min-h-[42px] rounded-lg bg-amber-400 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300 transition-colors"
              >
                Save Group Settings
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
