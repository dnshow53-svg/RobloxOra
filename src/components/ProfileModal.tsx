import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Award,
  Camera,
  CheckCircle2,
  Crown,
  Gem,
  Loader2,
  LogOut,
  Medal,
  Sparkles,
  Trash2,
  Trophy,
  User,
  X,
} from 'lucide-react';
import {
  ADMIN_EMAIL,
  OrderRecord,
  RegisteredUser,
  calculateTierProgressPercent,
  calculateUserTotalSpend,
  getNextLoyaltyTier,
  getSecurityHoldProgress,
  getUserLoyaltyTier,
} from '../data/packages';

interface ProfileModalProps {
  isOpen: boolean;
  user: RegisteredUser | null;
  existingUsers: RegisteredUser[];
  orders: OrderRecord[];
  onClose: () => void;
  onSaveProfile: (updated: RegisteredUser) => void;
  onSignOut: () => void;
}

async function compressAvatarFile(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file.'));
      el.src = objectUrl;
    });

    const sourceW = img.naturalWidth || img.width;
    const sourceH = img.naturalHeight || img.height;
    if (!sourceW || !sourceH) {
      throw new Error('Invalid image dimensions.');
    }

    const renderScaled = (maxDim: number, mime: string, quality: number): string => {
      const scale = Math.min(1, maxDim / Math.max(sourceW, sourceH));
      const targetW = Math.max(1, Math.round(sourceW * scale));
      const targetH = Math.max(1, Math.round(sourceH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#110F1B';
        ctx.fillRect(0, 0, targetW, targetH);
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvas.toDataURL(mime, quality);
    };

    // Prefer WebP for transparent/sharp small avatars when supported, else JPEG
    const webpAttempt = renderScaled(256, 'image/webp', 0.84);
    if (webpAttempt.startsWith('data:image/webp') && webpAttempt.length <= 90_000) {
      return webpAttempt;
    }

    const attempts: Array<[number, number]> = [
      [256, 0.82],
      [256, 0.68],
      [192, 0.72],
      [160, 0.62],
    ];
    for (const [dim, quality] of attempts) {
      const jpegUrl = renderScaled(dim, 'image/jpeg', quality);
      if (jpegUrl.startsWith('data:image/jpeg') && jpegUrl.length <= 95_000) {
        return jpegUrl;
      }
    }

    return renderScaled(128, 'image/jpeg', 0.6);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ProfileModal({
  isOpen,
  user,
  existingUsers,
  orders,
  onClose,
  onSaveProfile,
  onSignOut,
}: ProfileModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const hasPendingHold = orders.some(
      (o) =>
        o.status !== 'Cancelled' &&
        typeof o.unlockAtMs === 'number' &&
        o.unlockAtMs > Date.now()
    );
    if (!hasPendingHold) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isOpen, orders]);

  const userTotalSpend = useMemo(() => {
    return calculateUserTotalSpend(orders, user?.email);
  }, [orders, user?.email]);

  const userTier = useMemo(() => {
    return getUserLoyaltyTier(userTotalSpend);
  }, [userTotalSpend]);

  const nextTier = useMemo(() => {
    return getNextLoyaltyTier(userTier);
  }, [userTier]);

  const tierProgress = useMemo(() => {
    return calculateTierProgressPercent(userTotalSpend);
  }, [userTotalSpend]);

  useEffect(() => {
    if (isOpen && user) {
      setName(user.name);
      setEmail(user.email);
      setPhone(user.phone);
      setPassword(user.password);
      setAvatar(user.avatar || '');
      setAvatarLoadFailed(false);
      setAvatarError(null);
      setSavedNotice(null);
      setFormError(null);
    }
  }, [isOpen, user?.id]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatar]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleAvatarFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select a valid PNG, JPG, or WebP image file.');
      return;
    }

    setAvatarError(null);
    setSavedNotice(null);
    setIsUploadingAvatar(true);

    try {
      // Save as a compact self-contained Data URL so it never breaks on ephemeral /uploads resets
      const finalUrl = await compressAvatarFile(file);

      setAvatarLoadFailed(false);
      setAvatar(finalUrl);
      onSaveProfile({
        ...user,
        avatar: finalUrl,
      });
      setSavedNotice('Profile picture updated!');
    } catch {
      setAvatarError('Unable to process that image. Please try another photo.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = () => {
    if (!user) return;
    setAvatar('');
    setAvatarError(null);
    onSaveProfile({
      ...user,
      avatar: '',
    });
    setSavedNotice('Profile picture removed.');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    if (!cleanName || !cleanEmail || !cleanPhone || password.length < 4) {
      setFormError('Please fill all fields (minimum 4-character password).');
      return;
    }

    if (cleanEmail === ADMIN_EMAIL.toLowerCase()) {
      setFormError('This Gmail address is reserved.');
      return;
    }

    const emailInUse = existingUsers.some(
      (u) => u.id !== user.id && u.email.toLowerCase() === cleanEmail
    );
    if (emailInUse) {
      setFormError('Another account already uses this Gmail address.');
      return;
    }

    setFormError(null);
    onSaveProfile({
      ...user,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      password,
      avatar,
    });
    setSavedNotice('Profile changes saved to your account.');
  };

  return (
    <AnimatePresence>
      {isOpen && user && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#110F1B] border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                {avatar && !avatarLoadFailed ? (
                  <img
                    src={avatar}
                    alt={name || user.name}
                    onError={() => setAvatarLoadFailed(true)}
                    className="h-10 w-10 rounded-full object-cover border border-amber-400/40 shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <h2 id="profile-modal-title" className="font-display text-lg font-semibold text-zinc-100">
                    My Profile &amp; Orders
                  </h2>
                  <p className="text-xs text-zinc-400">View and edit your saved account details</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close profile modal"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Profile Picture Uploader */}
                <div className="rounded-lg bg-[#161422] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    {avatar && !avatarLoadFailed ? (
                      <img
                        src={avatar}
                        alt={name || user.name}
                        onError={() => setAvatarLoadFailed(true)}
                        className="h-14 w-14 rounded-full object-cover border-2 border-amber-400/50 shrink-0"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/25 shrink-0">
                        <User className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-zinc-100">
                        Profile Picture
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        PNG, JPG, or WebP photo shown on your profile
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarFileChange}
                      className="hidden"
                      aria-label="Upload profile picture"
                    />
                    <button
                      type="button"
                      disabled={isUploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-[#764AF1]/40 bg-[#764AF1]/15 px-3.5 py-1.5 text-xs font-semibold text-violet-200 hover:bg-[#764AF1]/25 transition-colors disabled:opacity-60"
                    >
                      {isUploadingAvatar ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Change Profile Picture</span>
                        </>
                      )}
                    </button>
                    {avatar && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        aria-label="Remove profile picture"
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-white/[0.06] hover:text-red-300 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Compact VIP Loyalty Tier Card */}
                <div className="rounded-lg bg-[#161422] border border-white/[0.08] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${userTier.borderClass} ${userTier.bgClass} ${userTier.textClass}`}>
                        {userTier.id === 'bronze' ? (
                          <Medal className="w-4 h-4" />
                        ) : userTier.id === 'gold' ? (
                          <Crown className="w-4 h-4" />
                        ) : userTier.id === 'diamond' ? (
                          <Gem className="w-4 h-4" />
                        ) : userTier.id === 'platinum' ? (
                          <Trophy className="w-4 h-4" />
                        ) : (
                          <Award className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-zinc-400">VIP Status:</span>
                          <span className={`text-xs font-bold ${userTier.textClass}`}>{userTier.badgeLabel}</span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400">
                          Total Spent: <span className="font-semibold text-zinc-100">৳{userTotalSpend.toLocaleString()} BDT</span>
                        </div>
                      </div>
                    </div>

                    {nextTier ? (
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-400">Next: {nextTier.name} (৳{nextTier.minSpendBdt.toLocaleString()})</div>
                        <div className="text-[11px] font-mono font-semibold text-amber-300">
                          ৳{Math.max(0, nextTier.minSpendBdt - userTotalSpend).toLocaleString()} more
                        </div>
                      </div>
                    ) : (
                      <div className="text-right text-xs font-semibold text-purple-300">
                        Max Platinum Rank 👑
                      </div>
                    )}
                  </div>

                  {/* Compact Progress Bar */}
                  <div className="space-y-1">
                    <div className="relative h-2 w-full rounded-full bg-[#110F1B] border border-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-400 via-sky-400 to-purple-500 transition-all duration-500"
                        style={{ width: `${Math.max(2, Math.min(100, tierProgress))}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                      <span>Bronze (500)</span>
                      <span>Gold (2k)</span>
                      <span>Diamond (10k)</span>
                      <span>Platinum (20.5k+)</span>
                    </div>
                  </div>
                </div>

                {avatarError && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs font-medium text-red-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{avatarError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="prof-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Full Name
                    </label>
                    <input
                      id="prof-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setSavedNotice(null);
                      }}
                      className="w-full min-h-[42px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#764AF1]"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Gmail
                    </label>
                    <input
                      id="prof-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setSavedNotice(null);
                      }}
                      className="w-full min-h-[42px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#764AF1]"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-phone" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Phone Number
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setSavedNotice(null);
                      }}
                      className="w-full min-h-[42px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#764AF1]"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-pass" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Password
                    </label>
                    <input
                      id="prof-pass"
                      type="text"
                      required
                      minLength={4}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setSavedNotice(null);
                      }}
                      className="w-full min-h-[42px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-[#764AF1]"
                    />
                  </div>
                </div>

                {formError && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs font-medium text-red-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{formError}</span>
                  </div>
                )}

                {savedNotice && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{savedNotice}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-full bg-[#764AF1] px-6 py-2 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors"
                  >
                    Save Profile Changes
                  </button>
                </div>
              </form>

              {/* Personal Order History & Sign Out */}
              <div className="pt-5 border-t border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-semibold text-zinc-200">
                    Order History ({orders.length})
                  </h3>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sign Out</span>
                  </button>
                </div>
                {orders.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No Robux orders placed under this account yet.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {orders.map((order) => {
                      const isConfirmed =
                        order.status === 'Approved' || order.status === 'Completed';
                      const isCancelled = order.status === 'Cancelled';
                      const holdProgress = getSecurityHoldProgress(
                        order.verifiedAtMs,
                        order.unlockAtMs,
                        nowMs,
                        isConfirmed
                      );
                      const statusLabel =
                        order.status === 'Completed'
                          ? 'Confirmed & Delivered'
                          : order.status === 'Approved'
                          ? 'Confirmed by Admin'
                          : order.status === 'Waiting' && holdProgress.isComplete
                          ? 'Hold Complete · Ready'
                          : order.status === 'Waiting'
                          ? 'Waiting (15-Day Hold)'
                          : order.status === 'Cancelled'
                          ? 'Cancelled'
                          : 'Awaiting Confirmation';
                      return (
                        <div
                          key={order.id}
                          className={`rounded-lg bg-[#161422] border p-3.5 space-y-2.5 text-xs ${
                            isConfirmed ? 'border-emerald-500/35' : 'border-white/[0.08]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-semibold text-zinc-100">
                                {order.packageTitle} · <span className="font-mono text-amber-300">{order.orderNumber}</span>
                              </div>
                              <div className="text-zinc-400 mt-0.5">
                                {order.paymentMethod} · Account: {order.robloxUsername || 'Guest Payout'}
                              </div>
                              {isConfirmed && (
                                <div className="text-[11px] text-emerald-300/90 mt-1">
                                  Confirmed by Admin
                                  {order.confirmedAt
                                    ? ` · ${new Date(order.confirmedAt).toLocaleString()}`
                                    : ''}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-mono tabular-nums text-zinc-200">
                                ৳{order.priceBdt} BDT
                              </div>
                              <div
                                className={`mt-0.5 font-semibold ${
                                  isConfirmed || (order.status === 'Waiting' && holdProgress.isComplete)
                                    ? 'text-emerald-400'
                                    : isCancelled
                                    ? 'text-red-400'
                                    : order.status === 'Waiting'
                                    ? 'text-sky-300'
                                    : 'text-amber-300'
                                }`}
                              >
                                {statusLabel}
                              </div>
                            </div>
                          </div>

                          {!isCancelled && holdProgress.hasHold && (
                            <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-zinc-400">
                                  15-Day Hold ({holdProgress.dayLabel})
                                </span>
                                <span
                                  className={`font-mono font-semibold tabular-nums ${
                                    holdProgress.isComplete ? 'text-emerald-300' : 'text-amber-300'
                                  }`}
                                >
                                  {holdProgress.percent}% · {holdProgress.countdownText}
                                </span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label="15-day security hold progress"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(holdProgress.percent)}
                                className="h-1.5 w-full rounded-full bg-[#110F1B] border border-white/10 overflow-hidden"
                              >
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    holdProgress.isComplete
                                      ? 'bg-emerald-400'
                                      : 'bg-gradient-to-r from-amber-500 to-sky-400'
                                  }`}
                                  style={{
                                    width: `${
                                      holdProgress.isComplete
                                        ? 100
                                        : Math.max(3, holdProgress.percent)
                                    }%`,
                                  }}
                                />
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
