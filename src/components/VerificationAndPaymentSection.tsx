import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  Unlock,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import {
  GroupSettings,
  OrderRecord,
  PAYMENT_LOCKED_MESSAGE,
  PAYMENT_OPTIONS,
  RobuxPackage,
  VerificationTimerState,
  formatCountdown,
  normalizeOrderStatus,
} from '../data/packages';
import { RestockCountdownCard } from './RestockCountdownCard';

interface VerificationAndPaymentSectionProps {
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
  liveReceiptOrder?: OrderRecord | null;
  onRequireSignIn: () => void;
  onGroupLinkClick: () => void;
  onVerifyMembership: () => void;
  onSwitchRobloxUsername: () => void;
  onSelectSavedUsername: (saved: VerificationTimerState) => void;
  onAdminUnlockTimer: () => void;
  onStartAnotherOrder: () => void;
  onClearPaymentError?: () => void;
  onSelectPayment: (id: string) => void;
  onShowOutOfStock?: () => void;
  onCompleteOrder: (transactionId: string, senderPhone?: string) => void | Promise<void>;
}

export function VerificationAndPaymentSection({
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
  liveReceiptOrder = null,
  onRequireSignIn,
  onGroupLinkClick,
  onVerifyMembership,
  onSwitchRobloxUsername,
  onSelectSavedUsername,
  onAdminUnlockTimer,
  onStartAnotherOrder,
  onClearPaymentError,
  onSelectPayment,
  onShowOutOfStock,
  onCompleteOrder,
}: VerificationAndPaymentSectionProps) {
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

  const handleCopyPhone = () => {
    navigator.clipboard.writeText('01764088123').catch(() => {});
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2500);
  };

  const time = formatCountdown(remainingSeconds);
  const isPaymentUnlocked = (isSignedIn && isGroupVerified && remainingSeconds === 0) || isAdmin;

  if (!selectedPackage) return null;
  const isOutOfStock = availableRobux <= 0 || availableRobux < selectedPackage.robux;

  return (
    <section
      id="verification"
      className="py-20 border-t border-white/[0.06]"
      aria-labelledby="verification-heading"
    >
      <div className="max-w-6xl mx-auto px-6 space-y-12">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-wide text-violet-300 mb-2">
            Real-Time Roblox API Gate
          </p>
          <h2
            id="verification-heading"
            className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-100 text-balance"
          >
            Official Group Verification &amp; 15-Day Timer
          </h2>
          <p className="mt-3 text-base text-zinc-400 leading-relaxed">
            Join Group ID <span className="font-mono text-zinc-200">{groupSettings.groupId}</span>, enter your Roblox username, and click Verify Membership to start your 15-day timer.
          </p>
        </div>

        {/* Verification & Timer Panel */}
        <div className="rounded-2xl bg-[#110F1B] border border-white/[0.08] p-6 sm:p-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
            <div>
              <span className="text-xs text-zinc-400">Active Package Selection</span>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-display text-2xl font-bold text-zinc-100">
                  {selectedPackage.title}
                </span>
                <span className="font-mono text-lg font-semibold text-violet-300 tabular-nums">
                  ৳{selectedPackage.priceBdt} BDT
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span>Roblox Account:</span>
              <span className="font-mono text-zinc-200">
                {robloxUsername.trim() ? robloxUsername.trim() : 'Not Verified'}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  isPaymentUnlocked
                    ? 'text-emerald-400'
                    : isGroupVerified
                    ? 'text-violet-300'
                    : 'text-zinc-300'
                }`}
              >
                {isPaymentUnlocked ? (
                  <>
                    <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                    Payment Unlocked
                  </>
                ) : isGroupVerified ? (
                  <>
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    15-Day Wait Active
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                    Verification Required
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left: Group Verification Controls */}
            <div className="lg:col-span-6 space-y-5">
              <div>
                <h3 className="font-display text-lg font-semibold text-zinc-100">
                  01. Official Roblox Community Join
                </h3>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                  Click Join Community, join on Roblox, then enter your username to verify automatically.
                </p>
              </div>

              {!isSignedIn && (
                <div className="rounded-xl bg-[#764AF1]/10 border border-[#764AF1]/30 p-4 space-y-3">
                  <div className="flex items-start gap-2.5 text-xs font-medium text-violet-200 leading-relaxed">
                    <Lock className="w-4 h-4 shrink-0 text-violet-300 mt-0.5" aria-hidden="true" />
                    <span>
                      Sign in required: You must sign in or create an account before you can verify your Roblox membership or buy any Robux.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onRequireSignIn}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-[#764AF1] px-4 py-2 text-xs font-semibold text-white hover:bg-[#855DF7] transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sign In / Create Account</span>
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                {isSignedIn ? (
                  <a
                    href={groupSettings.groupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onGroupLinkClick}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[#764AF1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
                  >
                    <span>Join Community</span>
                    <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={onRequireSignIn}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[#1C1928] border border-white/10 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:border-[#764AF1]/60 hover:text-violet-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Sign In to Join Community</span>
                  </button>
                )}

                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    isSignedIn && hasClickedGroupLink ? 'text-emerald-400' : 'text-zinc-400'
                  }`}
                >
                  {isSignedIn && hasClickedGroupLink ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Group link clicked
                    </>
                  ) : isSignedIn ? (
                    'Group link not clicked yet'
                  ) : (
                    'Sign in required first'
                  )}
                </span>
              </div>

              {isSignedIn && !isGroupVerified && savedVerifiedTimers.length > 0 && (
                <div className="rounded-xl bg-[#0A090F] border border-white/10 p-3 space-y-2">
                  <div className="text-[11px] font-medium text-zinc-400">
                    Previously Verified Roblox Accounts (no timer for completed accounts):
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
                  htmlFor="inline-roblox-username"
                  className="block text-xs font-medium text-zinc-300 mb-2"
                >
                  Enter your Roblox Username <span className="text-violet-300">*</span>
                </label>
                <input
                  id="inline-roblox-username"
                  type="text"
                  required
                  disabled={!isSignedIn || isGroupVerified}
                  value={isSignedIn ? robloxUsername : ''}
                  onChange={(e) => onUsernameChange(e.target.value)}
                  placeholder={
                    isSignedIn
                      ? 'Enter exact Roblox username'
                      : 'Sign in first to enter your Roblox username'
                  }
                  className="w-full min-h-[44px] rounded-lg bg-[#0A090F] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1] focus:ring-1 focus:ring-[#764AF1] disabled:opacity-60 transition-colors"
                />
              </div>

              {errorMessage && isSignedIn && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-red-300"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                  <p className="text-sm font-medium leading-snug">
                    {errorMessage}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!isSignedIn ? (
                  <button
                    type="button"
                    onClick={onRequireSignIn}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 transition-colors whitespace-nowrap"
                  >
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                    <span>Sign In to Verify &amp; Buy</span>
                  </button>
                ) : !isGroupVerified ? (
                  <button
                    type="button"
                    disabled={isVerifyingApi}
                    onClick={onVerifyMembership}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-60 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1]"
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
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                      Verified Member
                    </span>
                    <button
                      type="button"
                      onClick={onSwitchRobloxUsername}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[#0A090F] border border-white/15 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-[#764AF1]/60 hover:text-violet-200 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      Use New Username
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Right: 15-Day Security Countdown Timer */}
            <div className="lg:col-span-6 rounded-xl bg-[#161422] border border-white/[0.08] p-6 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-zinc-100">
                    02. 15-Day Security Countdown
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {isPaymentUnlocked
                      ? '15-day security period completed.'
                      : isGroupVerified
                      ? 'Counting down remaining Roblox group hold duration.'
                      : 'Timer activates once membership is verified.'}
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

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Days', value: time.days },
                  { label: 'Hours', value: time.hours },
                  { label: 'Minutes', value: time.minutes },
                  { label: 'Seconds', value: time.seconds },
                ].map((unit) => (
                  <div
                    key={unit.label}
                    className="rounded-xl bg-[#110F1B] border border-white/[0.08] py-4 px-2 text-center"
                  >
                    <div
                      className={`font-mono text-2xl sm:text-3xl font-semibold tabular-nums ${
                        isPaymentUnlocked
                          ? 'text-emerald-400'
                          : isGroupVerified
                          ? 'text-violet-300'
                          : 'text-zinc-500'
                      }`}
                    >
                      {unit.value}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">{unit.label}</div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-white/[0.08] space-y-3">
                <span className="block text-xs text-zinc-400">
                  {isPaymentUnlocked
                    ? 'Security wait verified. Payment buttons are active below.'
                    : isGroupVerified
                    ? 'Leaving the Roblox group automatically cancels and resets this timer.'
                    : 'Awaiting membership verification.'}
                </span>

                {isAdmin && !isPaymentUnlocked && (
                  <button
                    type="button"
                    onClick={onAdminUnlockTimer}
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-full bg-[#764AF1]/20 border border-[#764AF1]/40 px-4 py-2 text-xs font-semibold text-violet-200 hover:bg-[#764AF1]/30 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                    Admin: Complete Timer &amp; Unlock Payment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* PAYMENT SECTION */}
        <div
          id="payment"
          className={`rounded-2xl bg-[#110F1B] border p-6 sm:p-8 space-y-6 transition-all duration-500 ${
            isOutOfStock
              ? 'border-red-500/50 bg-red-500/[0.04] stock-alert-red'
              : 'border-white/[0.08]'
          }`}
          aria-labelledby="payment-heading"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
            <div>
              <h3
                id="payment-heading"
                className="font-display text-2xl font-bold text-zinc-100"
              >
                Payment Options
              </h3>
              <p
                className={`mt-1.5 text-sm font-medium flex items-center gap-2 transition-colors duration-300 ${
                  isOutOfStock
                    ? 'text-red-400'
                    : isPaymentUnlocked
                    ? 'text-emerald-400'
                    : 'text-zinc-400'
                }`}
              >
                {isOutOfStock ? (
                  <>
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 animate-pulse" aria-hidden="true" />
                    <span>
                      {availableRobux <= 0
                        ? 'Robux is currently out of stock (0 available). Orders are paused until restock.'
                        : `Only ${availableRobux.toLocaleString()} Robux available in stock — waiting for restock.`}
                    </span>
                  </>
                ) : isPaymentUnlocked ? (
                  <>
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      Group verification and 15-day wait completed. Select a payment method below.
                    </span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 shrink-0 text-violet-300" aria-hidden="true" />
                    <span>{PAYMENT_LOCKED_MESSAGE}</span>
                  </>
                )}
              </p>
            </div>

            <div className="text-left sm:text-right">
              <div className="text-xs text-zinc-400">Checkout Status</div>
              <div
                className={`mt-0.5 text-sm font-semibold transition-colors duration-300 ${
                  isOutOfStock
                    ? 'text-red-400 animate-pulse'
                    : isPaymentUnlocked
                    ? 'text-emerald-400'
                    : 'text-zinc-300'
                }`}
              >
                {isOutOfStock
                  ? `Out of Stock · ${availableRobux.toLocaleString()} Robux`
                  : isPaymentUnlocked
                  ? 'Unlocked · Ready'
                  : 'Unavailable - 15 days pending'}
              </div>
            </div>
          </div>

          {isOutOfStock && (
            <RestockCountdownCard
              availableRobux={availableRobux}
              restockTimestamp={groupSettings.restockTimestamp}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  className={`flex flex-col justify-between text-left rounded-xl p-5 border transition-all min-h-[120px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1] ${
                    isComingSoon
                      ? 'bg-[#161422] border-white/[0.12] text-zinc-200 hover:border-[#764AF1]/60 cursor-pointer'
                      : isDisabled
                      ? 'bg-[#161422]/70 border-white/[0.06] text-zinc-500 cursor-not-allowed opacity-75'
                      : isOutOfStock
                      ? 'bg-[#161422] border-red-500/40 text-zinc-200 hover:border-red-400 cursor-pointer'
                      : isSelected
                      ? 'bg-[#161422] border-[#764AF1] text-zinc-100 shadow-lg shadow-[#764AF1]/15'
                      : 'bg-[#161422] border-white/[0.1] text-zinc-200 hover:border-white/25 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2.5">
                      <CreditCard
                        className={`w-5 h-5 shrink-0 ${
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
                      <span className="font-display font-semibold text-base">
                        {option.name}
                      </span>
                    </div>
                    {isComingSoon && (
                      <span className="rounded-full bg-[#764AF1]/15 border border-[#764AF1]/30 px-2.5 py-0.5 text-[10px] font-semibold text-violet-200">
                        Coming Soon
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-zinc-400">
                    {isComingSoon ? 'Click to see status · Coming soon' : option.detail}
                  </p>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 w-full text-xs font-medium">
                    {isComingSoon ? (
                      <span className="inline-flex items-center gap-1.5 text-violet-300">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        bKash is coming soon
                      </span>
                    ) : !isPaymentUnlocked ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-400">
                        <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
                        Unavailable - 15 days pending
                      </span>
                    ) : isOutOfStock ? (
                      <span className="inline-flex items-center gap-1.5 text-red-400 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Out of Stock
                      </span>
                    ) : (
                      <span
                        className={
                          isSelected ? 'text-violet-300' : 'text-emerald-400'
                        }
                      >
                        {isSelected ? 'Selected' : 'Available · Click to Select'}
                      </span>
                    )}
                    <span className="font-mono tabular-nums text-zinc-400 shrink-0">
                      ৳{selectedPackage.priceBdt} BDT
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {isPaymentUnlocked && !orderReceipt && (
            <div className="space-y-4 pt-4 border-t border-white/[0.08]">
              <div
                className={`rounded-xl bg-[#0A090F] border p-4 space-y-3 transition-colors duration-500 ${
                  isOutOfStock ? 'border-red-500/45' : 'border-[#764AF1]/35'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-violet-300 font-semibold tracking-wide">
                      Official Send Money Number ({selectedPaymentId ? selectedPaymentId.toUpperCase() : 'Nagad / Rocket'})
                    </span>
                    <div className="font-mono text-xl font-bold text-zinc-100 mt-0.5">
                      01764088123
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                      Copy this number, go to your Nagad or Rocket app, send <span className="text-violet-300 font-semibold">৳{selectedPackage.priceBdt} BDT</span>, and paste your Transaction ID below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-[#764AF1] px-4 py-2 text-xs font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    {copiedPhone ? 'Copied Number!' : 'Copy Number'}
                  </button>
                </div>

                <div>
                  <label htmlFor="trx-id-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Enter Transaction ID (TrxID) <span className="text-violet-300">*</span>
                  </label>
                  <input
                    id="trx-id-input"
                    type="text"
                    required
                    value={transactionIdInput}
                    onChange={(e) => {
                      setTransactionIdInput(e.target.value);
                      setTrxError(null);
                      onClearPaymentError?.();
                    }}
                    placeholder="e.g. 72A94K81M2 (exact TrxID from Nagad/Rocket SMS)"
                    className="w-full min-h-[44px] rounded-lg bg-[#110F1B] border border-white/15 px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1]"
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-400">
                    Your TrxID is checked server-side against payments received on <span className="font-mono text-zinc-200">01764088123</span>. Duplicate, fake, or mismatched transactions are rejected/flagged automatically.
                  </p>
                </div>

                <div>
                  <label htmlFor="sender-phone-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Sender Mobile Number <span className="text-zinc-500">(Optional · 01XXXXXXXXX)</span>
                  </label>
                  <input
                    id="sender-phone-input"
                    type="tel"
                    value={senderPhoneInput}
                    onChange={(e) => {
                      setSenderPhoneInput(e.target.value);
                      setTrxError(null);
                      onClearPaymentError?.();
                    }}
                    placeholder="01XXXXXXXXX (number you sent money from)"
                    className="w-full min-h-[44px] rounded-lg bg-[#110F1B] border border-white/15 px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#764AF1]"
                  />
                </div>
              </div>

              {(trxError || paymentError) && (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-red-500/10 border border-red-500/30 p-3.5 text-xs font-medium text-red-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                  <span>{trxError || paymentError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-sm text-zinc-300">
                  Total due for{' '}
                  <span className="font-semibold text-zinc-100">
                    {selectedPackage.title}
                  </span>
                  :{' '}
                  <span className="font-mono font-semibold text-violet-300 tabular-nums">
                    ৳{selectedPackage.priceBdt} BDT
                  </span>
                </div>
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
                    void onCompleteOrder(cleanTrx, cleanSender || undefined);
                  }}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#764AF1] ${
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

          {orderReceipt && (() => {
            const liveStatus = liveReceiptOrder
              ? normalizeOrderStatus(liveReceiptOrder.status)
              : null;
            const isConfirmedByAdmin =
              Boolean(orderReceipt.verified) ||
              liveStatus === 'Approved' ||
              liveStatus === 'Completed';
            const isFlagged = Boolean(orderReceipt.flagged || liveReceiptOrder?.paymentFlag) && !isConfirmedByAdmin;
            const isDelivered = liveStatus === 'Completed';
            const isCancelled = liveStatus === 'Cancelled';
            return (
              <div
                role="status"
                className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isCancelled
                    ? 'bg-red-500/10 border-red-500/30'
                    : isFlagged
                    ? 'bg-amber-500/10 border-amber-500/35'
                    : isConfirmedByAdmin
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-[#764AF1]/10 border-[#764AF1]/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  {isFlagged ? (
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                  ) : (
                    <CheckCircle2
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        isCancelled
                          ? 'text-red-400'
                          : isConfirmedByAdmin
                          ? 'text-emerald-400'
                          : 'text-violet-300'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <p
                      className={`font-display text-base font-semibold ${
                        isCancelled
                          ? 'text-red-300'
                          : isFlagged
                          ? 'text-amber-300'
                          : isConfirmedByAdmin
                          ? 'text-emerald-300'
                          : 'text-violet-200'
                      }`}
                    >
                      {isCancelled
                        ? `Order #${orderReceipt.orderId} Cancelled`
                        : isDelivered
                        ? `Order #${orderReceipt.orderId} Confirmed & Delivered!`
                        : isConfirmedByAdmin
                        ? `Order #${orderReceipt.orderId} Confirmed by Admin!`
                        : isFlagged
                        ? `Order #${orderReceipt.orderId} Pending Review (Flagged)`
                        : `Order #${orderReceipt.orderId} Submitted (Pending Admin Confirmation)`}
                    </p>
                    {orderReceipt.transactionId && (
                      <p className="mt-1 text-xs font-mono text-zinc-300">
                        Method: {orderReceipt.method} · TrxID: {orderReceipt.transactionId}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-zinc-200 leading-relaxed font-medium">
                      {isCancelled
                        ? 'This order was marked Cancelled by Admin.'
                        : isDelivered
                        ? 'Admin confirmed and completed your Robux delivery! Check your Roblox account balance.'
                        : isConfirmedByAdmin
                        ? 'Your order has been confirmed by Admin! Your Robux payout is approved for delivery.'
                        : isFlagged
                        ? liveReceiptOrder?.paymentFlagReason || orderReceipt.flagMessage || 'Payment amount or sender details differed from the invoice and was flagged for Admin review.'
                        : 'Order submitted! Once Admin confirms your order (or matches your payment SMS on 01764088123), your confirmation status will update automatically below.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <a
                    href="#my-orders"
                    className="min-h-[40px] inline-flex items-center justify-center rounded-full bg-[#764AF1] px-4 py-2 text-xs font-semibold text-white hover:bg-[#855DF7] transition-colors whitespace-nowrap"
                  >
                    Track Live Status
                  </a>
                  <button
                    type="button"
                    onClick={onStartAnotherOrder}
                    className="min-h-[40px] rounded-full bg-[#1C1928] border border-white/10 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.08] transition-colors whitespace-nowrap"
                  >
                    Start Another Order
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {showBkashPopup && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bkash-coming-soon-title"
          onClick={() => setShowBkashPopup(false)}
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
                    id="bkash-coming-soon-title"
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
    </section>
  );
}
