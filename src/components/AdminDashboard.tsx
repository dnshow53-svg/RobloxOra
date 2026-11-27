import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cloud,
  Copy,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  LogOut,
  Package,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  User,
  Wallet,
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
import { RobuxMark } from './RobuxIcon';

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

type AdminTab = 'overview' | 'packages' | 'orders' | 'payments' | 'group';
type ChartRange = '1D' | '1W' | '1M' | '6M' | '1Y';
type RevenueWindow = 'All' | '6M' | '30D' | '7D';

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

function buildSmoothSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
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
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [watchlistFilter, setWatchlistFilter] = useState<'All' | 'Waiting' | 'Pending' | 'Approved'>('All');
  const [revenueWindow, setRevenueWindow] = useState<RevenueWindow>('All');
  const [chartRange, setChartRange] = useState<ChartRange>('1Y');
  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);

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

  const watchlistOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return normalizedOrders
      .filter((ord) => {
        if (watchlistFilter !== 'All' && ord.status !== watchlistFilter) return false;
        if (!q) return true;
        return (
          ord.orderNumber.toLowerCase().includes(q) ||
          ord.userName.toLowerCase().includes(q) ||
          ord.robloxUsername.toLowerCase().includes(q) ||
          ord.userEmail.toLowerCase().includes(q)
        );
      })
      .slice(0, 4);
  }, [normalizedOrders, watchlistFilter, orderSearch]);

  const revenueStats = useMemo(() => {
    const windowMs =
      revenueWindow === '7D'
        ? 7 * 86400000
        : revenueWindow === '30D'
        ? 30 * 86400000
        : revenueWindow === '6M'
        ? 180 * 86400000
        : Infinity;
    const cutoff = windowMs === Infinity ? 0 : nowMs - windowMs;
    const activeOrders = normalizedOrders.filter((o) => {
      if (o.status === 'Cancelled') return false;
      const t = new Date(o.createdAt).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    });
    const confirmedBdt = activeOrders
      .filter((o) => o.status === 'Approved' || o.status === 'Completed')
      .reduce((sum, o) => sum + (Number(o.priceBdt) || 0), 0);
    const pipelineBdt = activeOrders.reduce((sum, o) => sum + (Number(o.priceBdt) || 0), 0);
    return {
      confirmedBdt,
      pipelineBdt,
      displayBdt: confirmedBdt > 0 ? confirmedBdt : pipelineBdt,
      orderCount: activeOrders.length,
    };
  }, [normalizedOrders, revenueWindow, nowMs]);

  const chartBuckets = useMemo(() => {
    const now = new Date(nowMs);
    const activeOrders = normalizedOrders.filter((o) => o.status !== 'Cancelled');

    if (chartRange === '1D') {
      const labels = ['00h', '04h', '08h', '12h', '16h', '20h', 'Now'];
      return labels.map((label, idx) => {
        const start = nowMs - (6 - idx) * 4 * 3600000;
        const end = start + 4 * 3600000;
        const matched = activeOrders.filter((o) => {
          const t = new Date(o.createdAt).getTime();
          return t >= start && t < end;
        });
        return {
          label,
          fullLabel: `Today · ${label}`,
          value: matched.reduce((s, o) => s + (Number(o.priceBdt) || 0), 0),
          count: matched.length,
        };
      });
    }

    if (chartRange === '1W') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(nowMs - (6 - i) * 86400000);
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
        const matched = activeOrders.filter((o) => {
          const od = new Date(o.createdAt);
          return (
            od.getFullYear() === d.getFullYear() &&
            od.getMonth() === d.getMonth() &&
            od.getDate() === d.getDate()
          );
        });
        return {
          label: dayStr,
          fullLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          value: matched.reduce((s, o) => s + (Number(o.priceBdt) || 0), 0),
          count: matched.length,
        };
      });
    }

    if (chartRange === '1M') {
      return Array.from({ length: 8 }, (_, i) => {
        const endMs = nowMs - (7 - i) * 4 * 86400000;
        const startMs = endMs - 4 * 86400000;
        const d = new Date(endMs);
        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const matched = activeOrders.filter((o) => {
          const t = new Date(o.createdAt).getTime();
          return t >= startMs && t <= endMs;
        });
        return {
          label,
          fullLabel: label,
          value: matched.reduce((s, o) => s + (Number(o.priceBdt) || 0), 0),
          count: matched.length,
        };
      });
    }

    const monthsCount = chartRange === '6M' ? 6 : 12;
    return Array.from({ length: monthsCount }, (_, i) => {
      const target = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1 - i), 1);
      const label = target.toLocaleDateString('en-US', { month: 'short' });
      const fullLabel = target.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const matched = activeOrders.filter((o) => {
        const od = new Date(o.createdAt);
        return od.getFullYear() === target.getFullYear() && od.getMonth() === target.getMonth();
      });
      return {
        label,
        fullLabel,
        value: matched.reduce((s, o) => s + (Number(o.priceBdt) || 0), 0),
        count: matched.length,
      };
    });
  }, [normalizedOrders, chartRange, nowMs]);

  const chartGeometry = useMemo(() => {
    const width = 760;
    const height = 190;
    const padX = 24;
    const padTop = 22;
    const padBottom = 18;
    const usableW = width - padX * 2;
    const usableH = height - padTop - padBottom;
    const maxRaw = Math.max(0, ...chartBuckets.map((b) => b.value));
    const maxY = maxRaw > 0 ? Math.ceil(maxRaw * 1.2) : 1000;

    const points = chartBuckets.map((b, i) => {
      const x =
        chartBuckets.length <= 1
          ? padX + usableW / 2
          : padX + (i / (chartBuckets.length - 1)) * usableW;
      const ratio = maxY > 0 ? b.value / maxY : 0;
      const y = padTop + usableH - ratio * usableH;
      return { x, y };
    });

    const linePath = buildSmoothSvgPath(points);
    const first = points[0];
    const last = points[points.length - 1];
    const areaPath =
      first && last
        ? `${linePath} L ${last.x.toFixed(2)} ${(height - padBottom).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padBottom).toFixed(2)} Z`
        : '';

    const defaultIdx = (() => {
      let best = chartBuckets.length - 1;
      for (let i = 0; i < chartBuckets.length; i++) {
        if (chartBuckets[i].value >= chartBuckets[best].value) {
          best = i;
        }
      }
      return best;
    })();

    return {
      width,
      height,
      padBottom,
      maxY,
      points,
      linePath,
      areaPath,
      defaultIdx,
    };
  }, [chartBuckets]);

  const focusedChartIdx =
    activeChartIndex !== null && activeChartIndex < chartBuckets.length
      ? activeChartIndex
      : chartGeometry.defaultIdx;

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
        : `"${newPkg.title}" added to Storefront. Connect Cloud Database to keep it saved permanently across days & shared links.`
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
    const restockTimestamp = Date.now() + daysNum * 86400000 + hoursNum * 3600000;
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
    const base = isNaN(current) ? groupSettings.availableRobux ?? 25400 : current;
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
    const restockTimestamp = Date.now() + daysNum * 86400000 + hoursNum * 3600000;
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

  const currentLiveStock = groupSettings.availableRobux ?? 25400;
  const isZeroStock = currentLiveStock <= 0;

  const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'packages', label: 'Packages', icon: Package, count: packages.length },
    { id: 'orders', label: 'Orders', icon: ShoppingBag, count: orders.length },
    { id: 'payments', label: 'Payment Inbox', icon: Wallet, count: verifiedPayments.length },
    { id: 'group', label: 'Stock & Group', icon: SlidersHorizontal },
  ];

  const cycleRevenueWindow = () => {
    const order: RevenueWindow[] = ['All', '6M', '30D', '7D'];
    const next = order[(order.indexOf(revenueWindow) + 1) % order.length];
    setRevenueWindow(next);
  };

  const handleSwitchTab = (tab: AdminTab) => {
    setActiveTab(tab);
    if (tab === 'orders' || tab === 'payments') {
      onRefreshOrders();
    }
    if (tab === 'group') {
      setGroupSavedNotice(false);
    }
  };

  const focusedBucket = chartBuckets[focusedChartIdx] || {
    label: 'Now',
    fullLabel: 'Current',
    value: 0,
    count: 0,
  };
  const focusedPoint = chartGeometry.points[focusedChartIdx] || { x: 380, y: 120 };

  return (
    <section
      id="admin-dashboard"
      className="admin-obsidian-shell py-8 sm:py-10 bg-[#08060A] border-b border-white/[0.08]"
      aria-labelledby="admin-heading"
    >
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6">
        {/* Outer Polished Glass/Obsidian Shell matching Reference UI */}
        <div
          className="rounded-[24px] bg-[#0B090D] border border-white/[0.12] shadow-[0_30px_90px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col lg:flex-row min-h-[760px]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 88% 12%, rgba(168,125,156,0.10), transparent 36%), radial-gradient(circle at 18% 92%, rgba(168,125,156,0.06), transparent 40%)',
          }}
        >
          {/* Left Navigation Sidebar */}
          <aside className="lg:w-[238px] shrink-0 bg-[#09070B]/95 border-b lg:border-b-0 lg:border-r border-white/[0.08] p-5 flex flex-col justify-between gap-6">
            <div className="space-y-7">
              {/* Brand Mark */}
              <div className="flex items-center justify-between gap-2 px-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#231B24] border border-[#C9A7BF]/30 text-[#E6D4E0]">
                    <RobuxMark className="w-4 h-4" />
                  </div>
                  <span className="font-display text-base font-semibold tracking-tight text-zinc-100 whitespace-nowrap">
                    RobuxOra
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="lg:hidden inline-flex items-center gap-1 rounded-full border border-red-500/35 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-300"
                >
                  <LogOut className="w-3 h-3" aria-hidden="true" />
                  Sign Out
                </button>
              </div>

              {/* Primary Sidebar Nav */}
              <nav aria-label="Admin sections" className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSwitchTab(item.id)}
                      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'text-white border border-[#C9A7BF]/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                          : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                      }`}
                      style={
                        isActive
                          ? {
                              background:
                                'linear-gradient(90deg, rgba(168,125,156,0.34) 0%, rgba(168,125,156,0.08) 72%, rgba(20,16,24,0.2) 100%)',
                            }
                          : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-3">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-[#E6C7DC]' : 'text-zinc-400'
                          }`}
                          aria-hidden="true"
                        />
                        <span>{item.label}</span>
                      </span>
                      {typeof item.count === 'number' && (
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            isActive ? 'text-[#E6C7DC]' : 'text-zinc-500'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Sidebar Actions (Settings + Sign Out) */}
            <div className="hidden lg:flex flex-col gap-1.5 pt-4 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => handleSwitchTab('group')}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === 'group'
                    ? 'text-white bg-white/[0.06]'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
                }`}
              >
                <Settings className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                <span>Settings</span>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-medium text-red-300/90 hover:text-red-200 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>

          {/* Main Dashboard Canvas */}
          <div className="flex-1 min-w-0 p-5 sm:p-7 space-y-6">
            {/* Top Welcome Header Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2
                  id="admin-heading"
                  className="font-display text-2xl sm:text-[26px] font-semibold tracking-tight text-zinc-100"
                >
                  Welcome, <span className="text-[#C9A7BF]">Admin</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Here&apos;s your RobuxOra storefront, order hold &amp; payout overview
                </p>
              </div>

              {/* Right Quick Actions & Admin Profile */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onRefreshOrders();
                    setOrderNotice('Orders synced with server.');
                  }}
                  title="Sync Orders & Store"
                  aria-label="Sync orders and store"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#131017] border border-white/[0.09] text-zinc-300 hover:text-white hover:border-[#C9A7BF]/40 transition-colors"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isSyncingCloud ? 'animate-spin text-[#C9A7BF]' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTab('group')}
                  title="Group & Stock Settings"
                  aria-label="Open group and stock settings"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#131017] border border-white/[0.09] text-zinc-300 hover:text-white hover:border-[#C9A7BF]/40 transition-colors"
                >
                  <Settings className="w-4 h-4" aria-hidden="true" />
                </button>

                <div className="flex items-center gap-2.5 pl-1">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#B88FA8]/40 to-[#2B212D] border border-[#C9A7BF]/40 text-zinc-100 shrink-0">
                    <Shield className="w-4 h-4 text-[#E6C7DC]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="text-xs font-semibold text-zinc-100 truncate">
                      Store Admin
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {connectedCloudEmail || ADMIN_EMAIL}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-Nav Segmented Pills + Live Search Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-[#09070B] border border-white/[0.09] p-1 self-start">
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'packages', label: `Packages (${packages.length})` },
                    { id: 'orders', label: `Orders (${orders.length})` },
                    { id: 'payments', label: `Inbox (${verifiedPayments.length})` },
                    { id: 'group', label: 'Settings' },
                  ] as const
                ).map((pill) => {
                  const isActive = activeTab === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => handleSwitchTab(pill.id)}
                      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                        isActive
                          ? 'bg-[#2C212C] text-white border border-[#C9A7BF]/35 shadow-[0_0_20px_rgba(184,143,168,0.22)]'
                          : 'text-zinc-400 hover:text-zinc-100 border border-transparent'
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSwitchTab('orders');
                }}
                className="relative w-full md:w-72"
              >
                <Search
                  className="w-3.5 h-3.5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search orders, TrxID, Roblox..."
                  aria-label="Search customer orders across dashboard"
                  className="w-full min-h-[38px] rounded-full bg-[#131017] border border-white/[0.09] pl-9 pr-4 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#C9A7BF]"
                />
              </form>
            </div>

            {/* Cloud Sync Status Strip (Compact & Obsidian-Styled) */}
            <div
              className={`rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isCloudConnected
                  ? 'bg-[#121614] border-emerald-500/25'
                  : 'bg-[#151018] border-[#C9A7BF]/25'
              }`}
            >
              <div className="flex items-start sm:items-center gap-2.5 text-xs">
                <Cloud
                  className={`w-4 h-4 shrink-0 mt-0.5 sm:mt-0 ${
                    isCloudConnected ? 'text-emerald-400' : 'text-[#C9A7BF]'
                  }`}
                  aria-hidden="true"
                />
                <div>
                  {isCloudConnected ? (
                    <p className="font-medium text-emerald-300">
                      Cloud Database Connected (Firestore) — Items &amp; Orders save permanently
                    </p>
                  ) : connectedCloudEmail &&
                    connectedCloudEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase() ? (
                    <p className="font-medium text-amber-300">
                      Signed into Google as {connectedCloudEmail}. Switch to the store owner Google account to enable permanent Cloud saving.
                    </p>
                  ) : (
                    <p className="font-medium text-zinc-300">
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
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 px-3.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60 transition-colors whitespace-nowrap"
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
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-[#A67D9A] px-3.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-[#B88FA8] transition-colors whitespace-nowrap"
                  >
                    <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                    {connectedCloudEmail ? 'Switch Google Account' : 'Connect Cloud Database'}
                  </button>
                )}
              </div>
            </div>

            {/* TAB: OVERVIEW (Same-to-Same Reference Bento + Performance Chart) */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                  {/* Left Column (Total Revenue + Mauve Spotlight Vault Card) */}
                  <div className="lg:col-span-4 flex flex-col gap-4">
                    {/* Top Left Card: Total Revenue / Holding */}
                    <div
                      className="rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 flex flex-col justify-between min-h-[146px] relative overflow-hidden"
                      style={{
                        backgroundImage:
                          'radial-gradient(circle at 92% 90%, rgba(168,125,156,0.22), transparent 55%)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-200">Total Revenue</span>
                        <button
                          type="button"
                          onClick={cycleRevenueWindow}
                          className="inline-flex items-center gap-2 rounded-full bg-[#09070B]/80 border border-white/15 px-3 py-1 text-xs font-medium text-zinc-200 hover:border-[#C9A7BF]/50 transition-colors"
                        >
                          <span>{revenueWindow}</span>
                          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="font-display text-3xl sm:text-[34px] font-semibold tracking-tight text-zinc-100 font-mono tabular-nums">
                          ৳ {revenueStats.displayBdt.toLocaleString()}
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1">
                          {revenueStats.orderCount} active {revenueStats.orderCount === 1 ? 'order' : 'orders'} ·{' '}
                          {revenueStats.confirmedBdt > 0
                            ? 'Approved & completed payouts'
                            : 'Includes waiting & pending pipeline'}
                        </p>
                      </div>
                    </div>

                    {/* Bottom Left Card: Mauve Glow Vault / Action Spotlight */}
                    <div
                      className="rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 flex-1 flex flex-col items-center justify-between text-center relative overflow-hidden"
                      style={{
                        backgroundImage:
                          'radial-gradient(circle at 50% 115%, rgba(184,143,168,0.44), rgba(120,88,116,0.12) 48%, transparent 72%)',
                      }}
                    >
                      <div className="space-y-1.5 max-w-[260px]">
                        <h3 className="font-display text-base font-semibold text-zinc-100">
                          {isZeroStock
                            ? 'Storefront Out of Stock'
                            : `${currentLiveStock.toLocaleString()} Robux Ready`}
                        </h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Update live storefront Robux stock, restock countdown, and group payout availability anytime.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSwitchTab('group')}
                        className="mt-4 inline-flex min-h-[38px] items-center justify-center rounded-full bg-[#A67D9A] hover:bg-[#B88FA8] px-6 py-2 text-xs font-semibold text-zinc-950 shadow-[0_6px_24px_rgba(166,125,154,0.42)] transition-colors"
                      >
                        Manage Vault &amp; Stock
                      </button>
                    </div>
                  </div>

                  {/* Middle Column: Order Watchlist (Matching Reference Watchlist Card) */}
                  <div className="lg:col-span-4 rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 flex flex-col gap-4">
                    <div className="space-y-3">
                      <h3 className="font-display text-base font-semibold text-zinc-100">
                        Order Watchlist
                      </h3>

                      <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-[#09070B] border border-white/[0.08] p-1">
                        {(['All', 'Waiting', 'Pending', 'Approved'] as const).map((tab) => {
                          const active = watchlistFilter === tab;
                          return (
                            <button
                              key={tab}
                              type="button"
                              onClick={() => setWatchlistFilter(tab)}
                              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                                active
                                  ? 'bg-[#2E232E] text-white border border-[#C9A7BF]/35'
                                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                              }`}
                            >
                              {tab}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {watchlistOrders.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-6 space-y-2">
                        <p className="text-xs text-zinc-400">
                          No matching orders in {watchlistFilter}.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleSwitchTab('orders')}
                          className="text-xs font-medium text-[#C9A7BF] hover:underline"
                        >
                          Open Order Queue
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/[0.06] flex-1">
                        {watchlistOrders.map((ord) => {
                          const hold = getSecurityHoldProgress(
                            ord.verifiedAtMs,
                            ord.unlockAtMs,
                            nowMs,
                            ord.status === 'Approved' || ord.status === 'Completed'
                          );
                          const statusTone =
                            ord.status === 'Approved' || ord.status === 'Completed'
                              ? 'text-emerald-400'
                              : ord.status === 'Waiting'
                              ? hold.isComplete
                                ? 'text-emerald-300'
                                : 'text-[#C9A7BF]'
                              : 'text-amber-300';
                          return (
                            <button
                              key={ord.id}
                              type="button"
                              onClick={() => handleSwitchTab('orders')}
                              className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] px-1.5 rounded-lg transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1C1622] border border-white/10 text-xs font-semibold text-[#E6C7DC] shrink-0">
                                  {(ord.robloxUsername || ord.userName || 'R')[0]?.toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-zinc-100 truncate">
                                    {ord.robloxUsername || ord.userName}
                                  </div>
                                  <div className="text-[11px] text-zinc-500 font-mono truncate">
                                    {ord.orderNumber} · {ord.packageTitle}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 font-mono tabular-nums">
                                <div className="text-xs font-semibold text-zinc-100">
                                  ৳{ord.priceBdt.toLocaleString()}
                                </div>
                                <div className={`text-[10px] font-medium ${statusTone}`}>
                                  {ord.status === 'Waiting'
                                    ? hold.isComplete
                                      ? 'Hold 100%'
                                      : `${hold.percent}% Hold`
                                    : ord.status}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Store Packages 2x2 Mini-Grid (Matching My Portfolio Card) */}
                  <div className="lg:col-span-4 rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-base font-semibold text-zinc-100">
                        Store Packages
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSwitchTab('packages')}
                          className="rounded-full border border-white/15 bg-[#09070B]/70 px-3 py-1 text-xs font-medium text-zinc-200 hover:border-[#C9A7BF]/50 transition-colors"
                        >
                          See all
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchTab('packages')}
                          aria-label="Manage all packages"
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#09070B]/70 text-zinc-200 hover:border-[#C9A7BF]/50 transition-colors"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 flex-1">
                      {packages.slice(0, 4).map((pkg) => {
                        const cleanImg = sanitizeImage(pkg.image);
                        return (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => {
                              handleSwitchTab('packages');
                              startEditingPackage(pkg);
                            }}
                            className="rounded-xl bg-[#17131D] border border-white/[0.08] hover:border-[#C9A7BF]/40 p-3.5 flex flex-col justify-between text-left transition-colors"
                          >
                            <div>
                              <div className="font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                                ৳ {pkg.priceBdt.toLocaleString()}
                              </div>
                              <div className="text-[11px] font-medium text-emerald-400 truncate mt-0.5">
                                {pkg.deliveryNote}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-4">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-300 truncate">
                                {cleanImg ? (
                                  <img
                                    src={cleanImg}
                                    alt={pkg.title}
                                    className="h-4 w-4 rounded object-cover shrink-0"
                                  />
                                ) : (
                                  <RobuxMark className="w-3.5 h-3.5 text-[#C9A7BF] shrink-0" />
                                )}
                                <span className="truncate">{pkg.robux} R$</span>
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                                Tier
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      {packages.length === 0 && (
                        <button
                          type="button"
                          onClick={() => handleSwitchTab('packages')}
                          className="col-span-2 rounded-xl border border-dashed border-white/15 p-4 text-xs text-zinc-400 hover:text-zinc-200"
                        >
                          No packages yet. Click to add your first Robux package.
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Full-Width Bottom Row: Store Performance Interactive Area Chart */}
                <div className="rounded-2xl bg-[#110E15] border border-white/[0.09] p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base font-semibold text-zinc-100">
                        Store Performance
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Real order volume &amp; revenue trend across {chartRange}
                      </p>
                    </div>

                    <div className="inline-flex items-center gap-1 rounded-full bg-[#09070B] border border-white/[0.08] p-1 self-start sm:self-auto">
                      {(['1D', '1W', '1M', '6M', '1Y'] as const).map((range) => {
                        const active = chartRange === range;
                        return (
                          <button
                            key={range}
                            type="button"
                            onClick={() => {
                              setChartRange(range);
                              setActiveChartIndex(null);
                            }}
                            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                              active
                                ? 'bg-[#A67D9A]/35 text-white border border-[#C9A7BF]/45'
                                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                            }`}
                          >
                            {range}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive Smooth Area Chart SVG */}
                  <div className="relative w-full">
                    <div className="w-full overflow-x-auto">
                      <div className="min-w-[540px] relative">
                        <svg
                          viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                          className="w-full h-48 overflow-visible select-none"
                          role="img"
                          aria-label="Store revenue performance area chart"
                        >
                          <defs>
                            <linearGradient id="mauveAreaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#C9A7BF" stopOpacity="0.34" />
                              <stop offset="85%" stopColor="#A67D9A" stopOpacity="0.03" />
                              <stop offset="100%" stopColor="#0B090D" stopOpacity="0" />
                            </linearGradient>
                          </defs>

                          {/* Subtle horizontal baseline grid */}
                          {[0.25, 0.5, 0.75, 1].map((step) => {
                            const y =
                              22 + (chartGeometry.height - 40) * (1 - step);
                            const tickVal = Math.round(chartGeometry.maxY * step);
                            return (
                              <g key={step}>
                                <line
                                  x1={24}
                                  y1={y}
                                  x2={chartGeometry.width - 24}
                                  y2={y}
                                  stroke="rgba(255,255,255,0.05)"
                                  strokeWidth="1"
                                />
                                <text
                                  x={6}
                                  y={y + 3}
                                  fill="#71717a"
                                  fontSize="10"
                                  fontFamily="JetBrains Mono, monospace"
                                >
                                  {tickVal >= 1000 ? `${Math.round(tickVal / 1000)}k` : tickVal}
                                </text>
                              </g>
                            );
                          })}

                          {chartGeometry.areaPath && (
                            <path d={chartGeometry.areaPath} fill="url(#mauveAreaFill)" />
                          )}
                          {chartGeometry.linePath && (
                            <path
                              d={chartGeometry.linePath}
                              fill="none"
                              stroke="#D8B9CE"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                            />
                          )}

                          {/* Vertical dashed drop indicator on active point */}
                          <line
                            x1={focusedPoint.x}
                            y1={focusedPoint.y}
                            x2={focusedPoint.x}
                            y2={chartGeometry.height - chartGeometry.padBottom}
                            stroke="rgba(230,199,220,0.45)"
                            strokeDasharray="4 4"
                            strokeWidth="1.2"
                          />

                          {/* Glowing Pink-Mauve Point Dot */}
                          <circle
                            cx={focusedPoint.x}
                            cy={focusedPoint.y}
                            r={9}
                            fill="rgba(230,199,220,0.24)"
                          />
                          <circle
                            cx={focusedPoint.x}
                            cy={focusedPoint.y}
                            r={4.5}
                            fill="#F3CEE6"
                            stroke="#110E15"
                            strokeWidth="2"
                          />

                          {/* Interactive hover/click targets + X-axis labels */}
                          {chartGeometry.points.map((pt, idx) => (
                            <g
                              key={chartBuckets[idx].label + idx}
                              className="cursor-pointer"
                              onMouseEnter={() => setActiveChartIndex(idx)}
                              onClick={() => setActiveChartIndex(idx)}
                            >
                              <rect
                                x={pt.x - 26}
                                y={0}
                                width={52}
                                height={chartGeometry.height}
                                fill="transparent"
                              />
                              <text
                                x={pt.x}
                                y={chartGeometry.height - 2}
                                textAnchor="middle"
                                fill={idx === focusedChartIdx ? '#E6C7DC' : '#71717a'}
                                fontSize="10"
                                fontWeight={idx === focusedChartIdx ? '600' : '400'}
                              >
                                {chartBuckets[idx].label}
                              </text>
                            </g>
                          ))}
                        </svg>

                        {/* Floating Tooltip matching Screenshot Callout */}
                        <div
                          className="pointer-events-none absolute top-2 rounded-xl bg-[#1A1520]/95 border border-white/15 px-3.5 py-2 shadow-xl backdrop-blur-sm"
                          style={{
                            left: `clamp(12px, ${(focusedPoint.x / chartGeometry.width) * 100}%, calc(100% - 175px))`,
                            transform: 'translateX(-45%)',
                          }}
                        >
                          <div className="text-[11px] text-zinc-400">
                            {focusedBucket.fullLabel}
                          </div>
                          <div className="mt-1 flex items-center gap-2 font-mono tabular-nums">
                            <span className="text-xs font-semibold text-zinc-100">
                              ৳ {focusedBucket.value.toLocaleString()}
                            </span>
                            <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              {focusedBucket.count} {focusedBucket.count === 1 ? 'order' : 'orders'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: PACKAGES (Add, Edit, Photo Upload, Delete) */}
            {activeTab === 'packages' && (
              <div className="space-y-4">
                {pkgError && (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-xs font-medium text-red-300"
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
                    className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-medium text-emerald-300"
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

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <form
                    onSubmit={(e) => void handleAddSubmit(e)}
                    className="lg:col-span-5 rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-4"
                  >
                    <h3 className="font-display text-base font-semibold text-zinc-100 flex items-center gap-2">
                      <PackagePlus className="w-4 h-4 text-[#C9A7BF]" aria-hidden="true" />
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Product Photo (Optional)
                      </label>

                      <div className="space-y-2.5 rounded-xl bg-[#09070B] border border-white/10 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-lg bg-white/[0.06] border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors">
                            {isUploadingPhoto ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A7BF]" aria-hidden="true" />
                            ) : (
                              <ImagePlus className="w-3.5 h-3.5 text-[#C9A7BF]" aria-hidden="true" />
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
                          className="w-full min-h-[38px] rounded-lg bg-[#141019] border border-white/10 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-[#C9A7BF]"
                        />

                        {photoUploadError && (
                          <p className="text-xs text-red-400">{photoUploadError}</p>
                        )}

                        {sanitizeImage(productImage) && (
                          <div className="flex items-center gap-3 pt-1">
                            <img
                              src={sanitizeImage(productImage)}
                              alt="Selected product preview"
                              className="h-14 w-14 rounded-lg object-cover border border-white/10 bg-[#141019]"
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
                      className="w-full min-h-[44px] rounded-full bg-[#A67D9A] px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-[#B88FA8] disabled:opacity-60 transition-colors"
                    >
                      Add Item to Storefront
                    </button>
                  </form>

                  <div className="lg:col-span-7 rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-4">
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
                              className="rounded-xl bg-[#17131D] border border-white/[0.08] px-4 py-3 space-y-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                  {cleanImg && (
                                    <img
                                      src={cleanImg}
                                      alt={pkg.title}
                                      className="h-10 w-10 rounded-lg object-cover border border-white/10 shrink-0"
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
                                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors whitespace-nowrap"
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
                                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/30 px-3.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap"
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
                                      className="min-h-[36px] rounded-lg bg-[#09070B] border border-white/15 px-2.5 py-1 text-xs text-zinc-100"
                                    />
                                    <input
                                      type="text"
                                      aria-label="Edit package tag"
                                      value={editTag}
                                      onChange={(e) => setEditTag(e.target.value)}
                                      placeholder="Tag"
                                      className="min-h-[36px] rounded-lg bg-[#09070B] border border-white/15 px-2.5 py-1 text-xs text-zinc-100"
                                    />
                                    <button
                                      type="button"
                                      disabled={isUploadingEditPhoto}
                                      onClick={() => void saveEditedPackage(pkg)}
                                      className="min-h-[36px] rounded-full bg-[#A67D9A] px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-[#B88FA8] disabled:opacity-60 transition-colors"
                                    >
                                      Save Changes
                                    </button>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2.5">
                                    <label className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/15 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors">
                                      {isUploadingEditPhoto ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A7BF]" aria-hidden="true" />
                                      ) : (
                                        <ImagePlus className="w-3.5 h-3.5 text-[#C9A7BF]" aria-hidden="true" />
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
                                      className="flex-1 min-w-[180px] min-h-[34px] rounded-lg bg-[#09070B] border border-white/15 px-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-500"
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
                                          className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
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

            {/* TAB: ORDERS (Full Order Queue, Search, 15-Day Hold Bars, Actions) */}
            {activeTab === 'orders' && (
              <div className="rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-5">
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
                    className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-4 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors self-start sm:self-auto"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Refresh Orders
                  </button>
                </div>

                {orderNotice && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
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
                  <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-[#09070B] border border-white/[0.08] p-1 w-fit">
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
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                              orderFilter === st
                                ? 'bg-[#2C212C] text-white border border-[#C9A7BF]/35'
                                : 'text-zinc-400 hover:text-white border border-transparent'
                            }`}
                          >
                            {st} ({count})
                          </button>
                        );
                      }
                    )}
                  </div>
                )}

                {normalizedOrders.length === 0 ? (
                  <div className="rounded-xl bg-[#17131D] border border-white/[0.07] p-6 text-sm text-zinc-400 space-y-1">
                    <p className="font-medium text-zinc-200">No waiting customers or orders yet.</p>
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
                            className="rounded-xl bg-[#17131D] border border-white/[0.08] p-4 space-y-3 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-mono font-semibold text-[#E6C7DC]">
                                  {order.orderNumber}
                                </div>
                                <div className="font-medium text-zinc-100 mt-0.5">
                                  {order.packageTitle} · ৳{order.priceBdt} BDT
                                </div>
                                <div className="text-zinc-400 mt-0.5">{order.paymentMethod}</div>
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
                                className={`font-semibold px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 shrink-0 ${
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
                                  className={`rounded-xl border p-3 space-y-2 font-mono tabular-nums ${
                                    isTimerReady
                                      ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
                                      : 'bg-[#100D14] border-[#C9A7BF]/30 text-[#E6C7DC]'
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
                                  <div className="h-1.5 w-full rounded-full bg-[#09070B] border border-white/10 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        isTimerReady
                                          ? 'bg-emerald-400'
                                          : 'bg-gradient-to-r from-[#A67D9A] to-sky-400'
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
                                    className="h-9 w-9 rounded-full object-cover border border-[#C9A7BF]/50 shrink-0"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#241B26] text-[#E6C7DC] border border-[#C9A7BF]/30 shrink-0">
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
                                    className="col-span-2 min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-full bg-[#A67D9A]/20 border border-[#C9A7BF]/45 px-2.5 py-1.5 text-xs font-semibold text-[#E6C7DC] hover:bg-[#A67D9A]/30"
                                  >
                                    <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                                    Unlock Timer Now (Allow Payment)
                                  </button>
                                )}
                              <button
                                type="button"
                                onClick={() => void handleOrderStatusClick(order, 'Approved')}
                                className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded-full bg-sky-500/15 border border-sky-500/30 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleOrderStatusClick(order, 'Completed')}
                                className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
                              >
                                <Check className="w-3 h-3" aria-hidden="true" />
                                Complete
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleOrderStatusClick(order, 'Cancelled')}
                                className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
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
                                className="min-h-[36px] inline-flex items-center justify-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
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
                              <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                                <td className="py-3.5 pr-4 align-top">
                                  <div className="font-mono tabular-nums text-[#E6C7DC] font-semibold">
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
                                        className="h-9 w-9 rounded-full object-cover border border-[#C9A7BF]/50 shrink-0 mt-0.5"
                                      />
                                    ) : (
                                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#241B26] text-[#E6C7DC] border border-[#C9A7BF]/30 shrink-0 mt-0.5">
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
                                            hold.isComplete ? 'text-emerald-300' : 'text-[#E6C7DC]'
                                          }`}
                                        >
                                          <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                                          <span>{waitText}</span>
                                        </div>
                                        <div className="h-1.5 w-full rounded-full bg-[#09070B] border border-white/10 overflow-hidden">
                                          <div
                                            className={`h-full rounded-full transition-all duration-500 ${
                                              hold.isComplete
                                                ? 'bg-emerald-400'
                                                : 'bg-gradient-to-r from-[#A67D9A] to-sky-400'
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
                                          className="inline-flex items-center gap-1 rounded-full bg-[#A67D9A]/20 border border-[#C9A7BF]/45 px-2.5 py-1 text-xs font-semibold text-[#E6C7DC] hover:bg-[#A67D9A]/30 transition-colors"
                                        >
                                          <Zap className="w-3 h-3" aria-hidden="true" />
                                          Unlock Timer
                                        </button>
                                      )}
                                    <button
                                      type="button"
                                      onClick={() => void handleOrderStatusClick(order, 'Approved')}
                                      className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 border border-sky-500/30 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition-colors"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleOrderStatusClick(order, 'Completed')}
                                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                                    >
                                      <Check className="w-3 h-3" aria-hidden="true" />
                                      Complete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleOrderStatusClick(order, 'Cancelled')}
                                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
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
                                      className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25 transition-colors"
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

            {/* TAB: PAYMENT INBOX (01764088123 Nagad & Rocket Verification) */}
            {activeTab === 'payments' && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-[#110E15] border border-[#C9A7BF]/25 p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base font-semibold text-zinc-100 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-[#C9A7BF]" aria-hidden="true" />
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
                      className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full bg-[#A67D9A] px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-[#B88FA8] transition-colors whitespace-nowrap shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      {copiedWebhook ? 'Copied Webhook!' : 'Copy SMS Webhook URL'}
                    </button>
                  </div>
                  <div className="rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-xs text-[#E6C7DC] break-all">
                    POST {webhookUrl} — JSON body: {`{"sender":"Nagad","message":"You have received Tk 1180.00 ... TrxID 72A94K81M2"}`}
                  </div>
                </div>

                {payError && (
                  <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-xs font-medium text-red-300">
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
                  <div role="status" className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-medium text-emerald-300">
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {payNotice}
                    </span>
                    <button type="button" onClick={() => setPayNotice(null)} className="text-emerald-200/80 hover:text-white text-[11px]">
                      Dismiss
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <form
                    onSubmit={(e) => void handleLogPaymentSubmit(e)}
                    className="lg:col-span-5 rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-4"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full min-h-[44px] rounded-full bg-[#A67D9A] px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-[#B88FA8] transition-colors"
                    >
                      Save &amp; Match Pending Orders
                    </button>
                  </form>

                  <div className="lg:col-span-7 rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-4">
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
                            className="rounded-xl bg-[#17131D] border border-white/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-[#E6C7DC]">{pay.method}</span>
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
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/25"
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

            {/* TAB: STOCK & GROUP SETTINGS */}
            {activeTab === 'group' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Live Storefront Robux Stock & Restock Timer Editor */}
                <form
                  onSubmit={(e) => void handleLiveRobuxSubmit(e)}
                  className={`lg:col-span-6 rounded-2xl bg-[#110E15] border p-6 space-y-4 transition-all duration-500 ${
                    isZeroStock
                      ? 'border-red-500/50 bg-red-500/[0.04]'
                      : 'border-white/[0.09]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-display text-base font-semibold text-zinc-100">
                        Live Storefront Robux Stock
                      </h3>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                          isZeroStock
                            ? 'bg-red-500/15 border-red-500/40 text-red-300'
                            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        }`}
                      >
                        {currentLiveStock.toLocaleString()} Robux {isZeroStock ? '· Out of Stock' : ''}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Adjust live available Robux shown in the Storefront Stock Bar for all visitors.
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
                      className={`min-h-[34px] rounded-full border px-3 py-1 font-mono text-xs font-semibold transition-colors ${
                        liveRobuxInput === '0'
                          ? 'bg-red-500/25 border-red-500/60 text-red-300'
                          : 'bg-[#09070B] border-red-500/30 text-red-400 hover:bg-red-500/15'
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
                        className={`min-h-[34px] rounded-full border px-3 py-1 font-mono text-xs font-semibold transition-colors ${
                          liveRobuxInput === String(preset)
                            ? 'bg-[#A67D9A]/25 border-[#C9A7BF] text-[#E6C7DC]'
                            : 'bg-[#09070B] border-white/15 text-zinc-300 hover:border-[#C9A7BF]/60'
                        }`}
                      >
                        {preset.toLocaleString()}
                      </button>
                    ))}
                    {([-1000, -500, 500, 1000, 5000] as const).map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => handleAdjustLiveRobuxInput(delta)}
                        className="min-h-[34px] rounded-full bg-[#09070B] border border-white/15 px-2.5 py-1 font-mono text-xs font-medium text-zinc-200 hover:border-[#C9A7BF]/60 transition-colors"
                      >
                        {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
                      </button>
                    ))}
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/15 px-3.5 py-2 font-mono text-sm font-semibold text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                          className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/15 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                          className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/15 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
                        />
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
                        className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2 text-xs font-medium text-emerald-300"
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

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={isSavingLiveRobux}
                        className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full bg-[#A67D9A] px-5 py-2 text-xs font-semibold text-zinc-950 hover:bg-[#B88FA8] disabled:opacity-60 transition-colors whitespace-nowrap"
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
                </form>

                {/* Live Roblox Community API Settings */}
                <form
                  onSubmit={(e) => void handleGroupSubmit(e)}
                  className="lg:col-span-6 rounded-2xl bg-[#110E15] border border-white/[0.09] p-6 space-y-5"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                        className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                          className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
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
                          className="w-full min-h-[42px] rounded-xl bg-[#09070B] border border-white/10 px-3.5 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-[#C9A7BF]"
                        />
                      </div>
                    </div>
                  </div>

                  {groupSavedNotice && (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>
                        Group settings saved! Real-time verification now checks Group ID {editGroupId}.
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="min-h-[42px] rounded-full bg-[#A67D9A] px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-[#B88FA8] transition-colors"
                    >
                      Save Group Settings
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
