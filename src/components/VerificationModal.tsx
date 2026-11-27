import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import {
  GroupSettings,
  PAYMENT_LOCKED_MESSAGE,
  PAYMENT_OPTIONS,
  RobuxPackage,
  VerificationTimerState,
  formatCountdown,
} from '../data/packages';
import { RestockCountdownCard } from './RestockCountdownCard';
import { RobuxMark } from './RobuxIcon';

interface VerificationModalProps {
  isOpen: boolean;
  isSignedIn: boolean;
  isAdmin: boolean;
  selectedPackage: RobuxPackage | null;
  groupSettings: GroupSettings;
  availableRobux?: number;
  robloxUsername: string;
  onUsernameChange: (value: string) => void;
  hasClickedGroupLink: boolean;
  isGroupVerified: boolean;
  isVerifyingApi: boolean;
  isSubmittingOrder?: boolean;
  remainingSeconds: number;
  savedVerifiedTimers?: VerificationTimerState[];
  errorMessage: string | null;
  paymentError?: string | null;
  selectedPaymentId: string | null;
  orderReceipt: {
    orderId: string;
    method: string;
    transactionId?: string;
    verified?: boolean;
    flagged?: boolean;
    flagMessage?: string;
  } | null;
  onClose: () => void;
  onRequireSignIn: () => void;
  onGroupLinkClick: () => void;
  onVerifyMembership: () => void;
  onSwitchRobloxUsername: () => void;
  onSelectSavedUsername: (saved: VerificationTimerState) => void;
  onAdminUnlockTimer: () => void;
  onClearPaymentError?: () => void;
  onSelectPayment: (id: string) => void;
  onShowOutOfStock?: () => void;
  onSubmitOrder: (transactionId: string, senderPhone?: string) => void | Promise<void>;
}

export function VerificationModal({
  isOpen,
  isSignedIn,
  isAdmin,
  selectedPackage,
  groupSettings,
  availableRobux = 25400,
  robloxUsername,
  onUsernameChange,
  hasClickedGroupLink,
  isGroupVerified,
  isVerifyingApi,
  isSubmittingOrder = false,
  remainingSeconds,
  savedVerifiedTimers = [],
  errorMessage,
  paymentError = null,
  selectedPaymentId,
  orderReceipt,
  onClose,
  onRequireSignIn,
  onGroupLinkClick,
  onVerifyMembership,
  onSwitchRobloxUsername,
  onSelectSavedUsername,
  onAdminUnlockTimer,
  onClearPaymentError,
  onSelectPayment,
  onShowOutOfStock,
  onSubmitOrder,
}: VerificationModalProps) {
  const [transactionIdInput, setTransactionIdInput] = useState('');
  const [senderPhoneInput, setSenderPhoneInput] = useState('');
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [trxError, setTrxError] = useState<string | null>(null);
  const [showBkashPopup, setShowBkashPopup] = useState(false);

  useEffect(() => {
    if (orderReceipt) {
      setTransactionIdInput('');
      setSenderPhoneInput('');
      setTrxError(null);
    }
  }, [orderReceipt]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText('01764088123').catch(() => {});
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2500);
  };

  const time = formatCountdown(remainingSeconds);
  const isPaymentUnlocked = (isSignedIn && isGroupVerified && remainingSeconds === 0) || isAdmin;
  const isOutOfStock = Boolean(
    selectedPackage && (availableRobux <= 0 || availableRobux < selectedPackage.robux)
  );

  return (
    <AnimatePresence>
      {isOpen && selectedPackage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="verification-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#110F1B] border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#110F1B] flex items-center justify-between gap-4 px-6 py-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#764AF1]/15 text-violet-300 border border-[#764AF1]/30">
                  <RobuxMark className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="verification-modal-title"
                    className="font-display text-lg font-semibold text-zinc-100"
                  >
                    Checkout &amp; Group Verification
                  </h2>
                  <p className="text-xs text-zinc-400 font-mono tabular-nums">
                    {selectedPackage.title} · ৳{selectedPackage.priceBdt} BDT
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close checkout modal"
                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6">
              {isPaymentUnlocked && isGroupVerified ? (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-sm font-semibold text-emerald-300">
                        Verified Member · 15-Day Timer Completed
                      </div>
                      <p className="text-xs text-emerald-200/85 mt-0.5 leading-relaxed">
                        Roblox Account:{' '}
                        <span className="font-mono font-semibold text-white">
                          {robloxUsername.trim() || 'Verified Member'}
                        </span>
                        . You can buy anytime without a timer with this username. Entering a new username will start a 15-day timer.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-[11px] font-semibold text-emerald-200">
                      No Timer Needed
                    </span>
                    <button
                      type="button"
                      onClick={onSwitchRobloxUsername}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#0A090F] border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-[#764AF1]/60 hover:text-violet-200 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Use New Username
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-[#161422] border border-white/[0.08] p-4">
                    <p className="text-sm font-medium text-zinc-100 leading-relaxed">
                      You must join our official Roblox community group before purchasing.
                    </p>
                    <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                      Membership is verified against Group ID{' '}
                      <span className="font-mono text-zinc-300">{groupSettings.groupId}</span>. Leaving the group automatically resets your 15-day timer.
                    </p>
                  </div>

                  {/* Step 1: Join Community */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-zinc-300">
                        Step 1. Join our official Roblox community group
                      </span>
                      <span
                        className={`text-xs font-medium flex items-center gap-1.5 ${
                          hasClickedGroupLink ? 'text-emerald-400' : 'text-zinc-500'
                        }`}
                      >
                        {hasClickedGroupLink ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Link Clicked
                          </>
                        ) : (
                          'Not Clicked Yet'
                        )}
                      </span>
                    </div>

                    <a
                      href={groupSettings.groupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onGroupLinkClick}
                      className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full bg-[#764AF1] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
                    >
                      <span>Join Community</span>
                      <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                    </a>

                    {isSignedIn && !isGroupVerified && savedVerifiedTimers.length > 0 && (
                      <div className="rounded-xl bg-[#0A090F] border border-white/10 p-3 space-y-2">
                        <div className="text-[11px] font-medium text-zinc-400">
                          Previously Verified Roblox Accounts (no new timer for completed accounts):
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {savedVerifiedTimers.map((saved) => {
                            const isReady = saved.unlockAtMs <= Date.now();
                            const secsLeft = Math.max(0, Math.ceil((saved.unlockAtMs - Date.now()) / 1000));
                            const daysLeft = Math.ceil(secsLeft / 86400);
                            return (
                              <button
                                key={saved.robloxUsername.toLowerCase()}
                                type="button"
                                onClick={() => onSelectSavedUsername(saved)}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                  isReady
                                    ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'bg-[#764AF1]/15 border-[#764AF1]/35 text-violet-200 hover:bg-[#764AF1]/25'
                                }`}
                              >
                                <span className="font-mono">{saved.robloxUsername}</span>
                                <span className="text-[10px] opacity-85">
                                  {isReady ? '✓ No Timer' : `${daysLeft}d left`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor="modal-roblox-username"
                        className="block text-xs font-medium text-zinc-300 mb-2"
                      >
                        Enter your Roblox Username <span className="text-violet-300">*</span>
                      </label>
                      <input
                        id="modal-roblox-username"
                        type="text"
                        required
                        disabled={isGroupVerified}
                        value={robloxUsername}
                        onChange={(e) => onUsernameChange(e.target.value)}
                        placeholder="Enter exact Roblox username"
                        className="w-full min-h-[44px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1] focus:ring-1 focus:ring-[#764AF1] disabled:opacity-60 transition-colors"
                      />
                    </div>

                    {errorMessage && (
                      <div
                        role="alert"
                        className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3.5 text-red-300"
                      >
                        <AlertTriangle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                        <p className="text-sm font-medium leading-snug">
                          {errorMessage}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      {!isSignedIn ? (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onRequireSignIn();
                          }}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[#764AF1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors"
                        >
                          <Lock className="w-4 h-4" aria-hidden="true" />
                          <span>Sign In to Verify &amp; Buy</span>
                        </button>
                      ) : !isGroupVerified ? (
                        <button
                          type="button"
                          disabled={isVerifyingApi}
                          onClick={onVerifyMembership}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-60 transition-colors"
                        >
                          {isVerifyingApi ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              <span>Verifying Membership...</span>
                            </>
                          ) : (
                            <span>Verify Membership</span>
                          )}
                        </button>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                            Verified Member
                          </span>
                          <button
                            type="button"
                            onClick={onSwitchRobloxUsername}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#0A090F] border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#764AF1]/60 hover:text-violet-200 transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                            Use New Username
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Step 2: 15-Day Live Countdown Timer */}
                  <div className="rounded-xl bg-[#161422] border border-white/[0.08] p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-sm font-semibold text-zinc-100">
                          15-Day Security Countdown Timer
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {isPaymentUnlocked
                            ? '15-day waiting period complete. Payment is now unlocked.'
                            : isGroupVerified
                            ? 'Verified Member! Timer active until 15-day hold completes.'
                            : 'Join the group and click Verify Membership to start the 15-day timer.'}
                        </p>
                      </div>
                      <Clock
                        className={`w-5 h-5 shrink-0 ${
                          isPaymentUnlocked
                            ? 'text-emerald-400'
                            : isGroupVerified
                            ? 'text-violet-300'
                            : 'text-zinc-600'
                        }`}
                        aria-hidden="true"
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-3 text-center">
                      {[
                        { label: 'Days', value: time.days },
                        { label: 'Hours', value: time.hours },
                        { label: 'Minutes', value: time.minutes },
                        { label: 'Seconds', value: time.seconds },
                      ].map((unit) => (
                        <div
                          key={unit.label}
                          className="rounded-xl bg-[#110F1B] border border-white/[0.08] py-3 px-2"
                        >
                          <div
                            className={`font-mono text-xl sm:text-2xl font-semibold tabular-nums ${
                              isPaymentUnlocked
                                ? 'text-emerald-400'
                                : isGroupVerified
                                ? 'text-violet-300'
                                : 'text-zinc-500'
                            }`}
                          >
                            {unit.value}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">{unit.label}</div>
                        </div>
                      ))}
                    </div>

                    {isAdmin && !isPaymentUnlocked && (
                      <button
                        type="button"
                        onClick={onAdminUnlockTimer}
                        className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-full bg-[#764AF1]/20 border border-[#764AF1]/40 px-4 py-2 text-xs font-semibold text-violet-200 hover:bg-[#764AF1]/30 transition-colors"
                      >
                        <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                        Admin: Complete Timer &amp; Unlock Payment
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Step 3: Payment Section inside Checkout Modal */}
              <div
                className={`rounded-xl bg-[#161422] border p-5 space-y-4 transition-all duration-500 ${
                  isOutOfStock
                    ? 'border-red-500/50 bg-red-500/[0.04] stock-alert-red'
                    : 'border-white/[0.08]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
                  <div>
                    <h3 className="font-display text-base font-semibold text-zinc-100">
                      Payment Section
                    </h3>
                    <p
                      className={`mt-1 text-xs font-medium flex items-center gap-1.5 transition-colors duration-300 ${
                        isOutOfStock
                          ? 'text-red-400'
                          : isPaymentUnlocked
                          ? 'text-emerald-400'
                          : 'text-zinc-400'
                      }`}
                    >
                      {isOutOfStock ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 animate-pulse" aria-hidden="true" />
                          <span>
                            {availableRobux <= 0
                              ? 'Out of stock (0 Robux available) — waiting for restock.'
                              : `Only ${availableRobux.toLocaleString()} Robux available in stock.`}
                          </span>
                        </>
                      ) : isPaymentUnlocked ? (
                        <>
                          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>Payment unlocked. Choose a payment method and submit your order.</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 shrink-0 text-violet-300" aria-hidden="true" />
                          <span>{PAYMENT_LOCKED_MESSAGE}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold transition-colors duration-300 ${
                      isOutOfStock
                        ? 'text-red-400 animate-pulse'
                        : isPaymentUnlocked
                        ? 'text-emerald-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {isOutOfStock
                      ? `Out of Stock (${availableRobux.toLocaleString()} Robux)`
                      : isPaymentUnlocked
                      ? 'Unlocked'
                      : 'Unavailable - 15 days pending'}
                  </span>
                </div>

                {isOutOfStock && (
                  <RestockCountdownCard
                    compact
                    availableRobux={availableRobux}
                    restockTimestamp={groupSettings.restockTimestamp}
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PAYMENT_OPTIONS.map((option) => {
                    const isComingSoon = Boolean(option.comingSoon);
                    const isSelected = !isComingSoon && selectedPaymentId === option.id;
                    const isDisabled = !isComingSoon && !isPaymentUnlocked;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          if (isComingSoon) {
                            setShowBkashPopup(true);
                            return;
                          }
                          onSelectPayment(option.id);
                        }}
                        className={`flex flex-col justify-between text-left rounded-xl p-3.5 border transition-colors ${
                          isComingSoon
                            ? 'bg-[#110F1B] border-white/15 text-zinc-200 hover:border-[#764AF1]/60 cursor-pointer'
                            : isDisabled
                            ? 'bg-[#110F1B]/50 border-white/[0.06] text-zinc-500 cursor-not-allowed opacity-75'
                            : isOutOfStock
                            ? 'bg-[#110F1B] border-red-500/40 text-zinc-200 hover:border-red-400 cursor-pointer'
                            : isSelected
                            ? 'bg-[#110F1B] border-[#764AF1] text-zinc-100'
                            : 'bg-[#110F1B] border-white/10 text-zinc-200 hover:border-white/25 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 w-full">
                          <div className="flex items-center gap-2">
                            <CreditCard
                              className={`w-4 h-4 shrink-0 ${
                                isComingSoon
                                  ? 'text-violet-300'
                                  : isOutOfStock && isPaymentUnlocked
                                  ? 'text-red-400'
                                  : isPaymentUnlocked
                                  ? 'text-violet-300'
                                  : 'text-zinc-600'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="font-display text-xs font-semibold">
                              {option.name}
                            </span>
                          </div>
                          {isComingSoon && (
                            <span className="rounded-full bg-[#764AF1]/15 border border-[#764AF1]/30 px-2 py-0.5 text-[9px] font-semibold text-violet-200">
                              Soon
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] font-mono text-zinc-400">
                          {isComingSoon ? 'Coming Soon' : option.detail}
                        </p>
                        <div className="mt-3 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[11px]">
                          {isComingSoon ? (
                            <span className="inline-flex items-center gap-1 text-violet-300 font-medium">
                              <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
                              Coming Soon
                            </span>
                          ) : !isPaymentUnlocked ? (
                            <span className="inline-flex items-center gap-1 text-zinc-400">
                              <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                              Unavailable - 15 days pending
                            </span>
                          ) : isOutOfStock ? (
                            <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                              Out of Stock
                            </span>
                          ) : (
                            <span className={isSelected ? 'text-violet-300 font-semibold' : 'text-emerald-400'}>
                              {isSelected ? 'Selected' : 'Available'}
                            </span>
                          )}
                          <span className="font-mono tabular-nums text-zinc-400 shrink-0">
                            ৳{selectedPackage.priceBdt}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {isPaymentUnlocked && !orderReceipt && (
                  <div className="space-y-3 pt-2 border-t border-white/[0.08]">
                    <div
                      className={`rounded-xl bg-[#0A090F] border p-3.5 space-y-2.5 transition-colors duration-500 ${
                        isOutOfStock ? 'border-red-500/45' : 'border-[#764AF1]/35'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div>
                          <span className="text-[11px] text-violet-300 font-semibold">
                            Official Send Money Number ({selectedPaymentId ? selectedPaymentId.toUpperCase() : 'Nagad / Rocket'})
                          </span>
                          <div className="font-mono text-lg font-bold text-zinc-100">
                            01764088123
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            Send <span className="text-violet-300 font-semibold">৳{selectedPackage.priceBdt} BDT</span> to this number, then paste your TrxID below.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyPhone}
                          className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full bg-[#764AF1] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          {copiedPhone ? 'Copied!' : 'Copy Number'}
                        </button>
                      </div>

                      <div>
                        <label htmlFor="modal-trx-id-input" className="block text-xs font-medium text-zinc-300 mb-1">
                          Enter Transaction ID (TrxID) <span className="text-violet-300">*</span>
                        </label>
                        <input
                          id="modal-trx-id-input"
                          type="text"
                          required
                          value={transactionIdInput}
                          onChange={(e) => {
                            setTransactionIdInput(e.target.value);
                            setTrxError(null);
                            onClearPaymentError?.();
                          }}
                          placeholder="e.g. 72A94K81M2 (from Nagad/Rocket SMS)"
                          className="w-full min-h-[40px] rounded-lg bg-[#110F1B] border border-white/15 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1]"
                        />
                      </div>

                      <div>
                        <label htmlFor="modal-sender-phone-input" className="block text-xs font-medium text-zinc-300 mb-1">
                          Sender Mobile Number <span className="text-zinc-500">(Optional · 01XXXXXXXXX)</span>
                        </label>
                        <input
                          id="modal-sender-phone-input"
                          type="tel"
                          value={senderPhoneInput}
                          onChange={(e) => {
                            setSenderPhoneInput(e.target.value);
                            setTrxError(null);
                            onClearPaymentError?.();
                          }}
                          placeholder="01XXXXXXXXX (number you sent money from)"
                          className="w-full min-h-[40px] rounded-lg bg-[#110F1B] border border-white/15 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1]"
                        />
                      </div>
                    </div>

                    {(trxError || paymentError) && (
                      <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs font-medium text-red-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                        <span>{trxError || paymentError}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-zinc-300 font-mono tabular-nums">
                        Total: ৳{selectedPackage.priceBdt} BDT
                      </span>
                      <button
                        type="button"
                        disabled={
                          !isOutOfStock &&
                          (!selectedPaymentId || !transactionIdInput.trim() || isVerifyingApi || isSubmittingOrder)
                        }
                        onClick={() => {
                          if (isOutOfStock) {
                            onShowOutOfStock?.();
                            return;
                          }
                          const cleanTrx = transactionIdInput.trim();
                          if (cleanTrx.length < 8) {
                            setTrxError('Please enter a valid Nagad/Rocket Transaction ID (at least 8 characters with numbers).');
                            return;
                          }
                          const cleanSender = senderPhoneInput.replace(/[\s\-]/g, '').trim();
                          if (cleanSender && !/^(\+?88)?01[3-9]\d{8}$/.test(cleanSender)) {
                            setTrxError('Invalid Sender Number. Use an 11-digit BD number (e.g. 01XXXXXXXXX).');
                            return;
                          }
                          setTrxError(null);
                          onClearPaymentError?.();
                          void onSubmitOrder(cleanTrx, cleanSender || undefined);
                        }}
                        className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                          isOutOfStock
                            ? 'bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30'
                            : selectedPaymentId && transactionIdInput.trim() && !isVerifyingApi && !isSubmittingOrder
                            ? 'bg-[#764AF1] text-white hover:bg-[#855DF7]'
                            : 'bg-[#1C1928] text-zinc-500 cursor-not-allowed'
                        }`}
                      >
                        {isOutOfStock ? (
                          <>
                            <AlertTriangle className="w-4 h-4 animate-pulse" aria-hidden="true" />
                            <span>Out of Stock — Order Paused</span>
                          </>
                        ) : isVerifyingApi ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            <span>Re-verifying Membership...</span>
                          </>
                        ) : isSubmittingOrder ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            <span>Checking 01764088123 Payment...</span>
                          </>
                        ) : selectedPaymentId ? (
                          `Submit Payment & Order — ৳${selectedPackage.priceBdt} BDT`
                        ) : (
                          'Select a Payment Method'
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {orderReceipt && (
                  <div
                    role="status"
                    className={`rounded-xl border p-4 space-y-1.5 ${
                      orderReceipt.flagged
                        ? 'bg-amber-500/10 border-amber-500/35'
                        : orderReceipt.verified
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-[#764AF1]/10 border-[#764AF1]/30'
                    }`}
                  >
                    <div
                      className={`flex items-center gap-2 text-sm font-semibold ${
                        orderReceipt.flagged
                          ? 'text-amber-300'
                          : orderReceipt.verified
                          ? 'text-emerald-300'
                          : 'text-violet-200'
                      }`}
                    >
                      {orderReceipt.flagged ? (
                        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>
                        {orderReceipt.flagged
                          ? `Order #${orderReceipt.orderId} Pending Review (Flagged)`
                          : orderReceipt.verified
                          ? `Payment Verified & Order #${orderReceipt.orderId} Approved!`
                          : `Order #${orderReceipt.orderId} Submitted (Pending Verification)`}
                      </span>
                    </div>
                    {orderReceipt.transactionId && (
                      <p className="text-xs font-mono text-zinc-300">
                        {orderReceipt.method} · TrxID: {orderReceipt.transactionId}
                      </p>
                    )}
                    <p className="text-xs text-zinc-200 leading-relaxed">
                      {orderReceipt.flagged
                        ? orderReceipt.flagMessage || 'Payment amount or sender details differed from the invoice and was flagged for Admin verification.'
                        : orderReceipt.verified
                        ? 'Your payment to 01764088123 has been verified! Please wait for 15 hours. After that time your Robux will be successfully transferred to your account.'
                        : 'Order submitted as Pending! Payment cannot be approved until our server receives SMS confirmation or Admin verifies it on 01764088123.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {showBkashPopup && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-bkash-coming-soon-title"
              onClick={(e) => {
                e.stopPropagation();
                setShowBkashPopup(false);
              }}
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl bg-[#110F1B] border border-[#764AF1]/40 p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#764AF1]/15 text-violet-300 border border-[#764AF1]/30">
                      <Sparkles className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h4
                        id="modal-bkash-coming-soon-title"
                        className="font-display text-lg font-bold text-zinc-100"
                      >
                        bKash is Coming Soon
                      </h4>
                      <p className="text-xs text-violet-300 font-medium">
                        Payment Method Notice
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close message"
                    onClick={() => setShowBkashPopup(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed">
                  bKash payment is coming soon! Please select <span className="font-semibold text-violet-300">Nagad</span> or <span className="font-semibold text-violet-300">Rocket</span> (<span className="font-mono text-zinc-100">01764088123</span>) to complete your order right now.
                </p>

                <button
                  type="button"
                  onClick={() => setShowBkashPopup(false)}
                  className="w-full min-h-[42px] rounded-full bg-[#764AF1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors"
                >
                  Okay, Got It
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
