import { useState } from 'react';
import {
  Award,
  Check,
  ChevronRight,
  Crown,
  Gem,
  Info,
  Lock,
  LogIn,
  Medal,
  Sparkles,
  Trophy,
  User,
  Zap,
} from 'lucide-react';
import {
  LOYALTY_TIERS,
  LoyaltyTier,
  LoyaltyTierId,
  calculateTierProgressPercent,
  getNextLoyaltyTier,
  getUserLoyaltyTier,
} from '../data/packages';

interface LoyaltyTierBarProps {
  isSignedIn: boolean;
  userEmail?: string | null;
  userName?: string | null;
  totalSpendBdt: number;
  onRequireSignIn?: () => void;
}

export function LoyaltyTierBar({
  isSignedIn,
  userEmail,
  userName,
  totalSpendBdt,
  onRequireSignIn,
}: LoyaltyTierBarProps) {
  const currentTier = getUserLoyaltyTier(totalSpendBdt);
  const nextTier = getNextLoyaltyTier(currentTier);
  const progressPercent = calculateTierProgressPercent(totalSpendBdt);
  const [selectedTierId, setSelectedTierId] = useState<LoyaltyTierId | null>(null);

  const activeInspectTier = selectedTierId
    ? LOYALTY_TIERS.find((t) => t.id === selectedTierId) || currentTier
    : currentTier;

  const getTierIcon = (id: LoyaltyTierId, className = 'w-4 h-4') => {
    switch (id) {
      case 'bronze':
        return <Medal className={className} aria-hidden="true" />;
      case 'gold':
        return <Crown className={className} aria-hidden="true" />;
      case 'diamond':
        return <Gem className={className} aria-hidden="true" />;
      case 'platinum':
        return <Trophy className={className} aria-hidden="true" />;
      default:
        return <User className={className} aria-hidden="true" />;
    }
  };

  const getMilestonePositionPercent = (id: LoyaltyTierId) => {
    switch (id) {
      case 'bronze':
        return 25;
      case 'gold':
        return 50;
      case 'diamond':
        return 75;
      case 'platinum':
        return 100;
      default:
        return 0;
    }
  };

  const remainingForNext = nextTier
    ? Math.max(0, nextTier.minSpendBdt - totalSpendBdt)
    : 0;

  return (
    <section
      id="loyalty-tier-section"
      className="py-10 border-t border-white/[0.08]"
      aria-labelledby="loyalty-heading"
    >
      <div className="max-w-6xl mx-auto px-6 space-y-6">
        {/* Tier Bar Card */}
        <div className="rounded-xl bg-[#131820] border border-white/[0.08] p-6 sm:p-7 shadow-xl space-y-6 relative overflow-hidden">
          {/* Subtle gradient aura backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl opacity-20 bg-gradient-to-br from-amber-400 via-sky-400 to-purple-600"
          />

          {/* Top Row: Title, Spend Summary & Current Tier */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold tracking-wide uppercase text-amber-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  VIP Loyalty Rewards Program
                </span>
                <span className="text-zinc-600" aria-hidden="true">·</span>
                <span className="text-xs text-zinc-400">Lifetime Spending Progress</span>
              </div>
              <h2
                id="loyalty-heading"
                className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100 flex flex-wrap items-center gap-2.5"
              >
                <span>Spend &amp; Level Up:</span>
                <span className="inline-flex items-center gap-1 text-amber-500 font-extrabold">
                  Bronze
                </span>
                <span className="text-zinc-500">·</span>
                <span className="inline-flex items-center gap-1 text-amber-400 font-extrabold">
                  Gold
                </span>
                <span className="text-zinc-500">·</span>
                <span className="inline-flex items-center gap-1 text-sky-400 font-extrabold">
                  Diamond
                </span>
                <span className="text-zinc-500">·</span>
                <span className="inline-flex items-center gap-1 text-purple-400 font-extrabold">
                  Platinum
                </span>
              </h2>
            </div>

            {/* Current Tier Badge & Status */}
            <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
              {isSignedIn ? (
                <div className="rounded-lg bg-[#090B0E] border border-white/10 px-4 py-2.5 flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${currentTier.borderClass} ${currentTier.bgClass} ${currentTier.textClass}`}
                  >
                    {getTierIcon(currentTier.id, 'w-5 h-5')}
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-400">Your VIP Rank</div>
                    <div className="font-display text-sm font-bold text-zinc-100 flex items-center gap-1.5">
                      <span className={currentTier.textClass}>{currentTier.badgeLabel}</span>
                      <span className="font-mono text-xs text-zinc-400 tabular-nums">
                        (৳{totalSpendBdt.toLocaleString()} BDT)
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onRequireSignIn}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition-colors whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  <span>Sign In to Track VIP</span>
                </button>
              )}
            </div>
          </div>

          {/* Subtitle / Next Tier Goal */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400 pt-1 relative z-10">
            <div>
              {isSignedIn ? (
                nextTier ? (
                  <p>
                    Spend{' '}
                    <span className="font-mono font-semibold text-amber-300 tabular-nums">
                      ৳{remainingForNext.toLocaleString()} BDT
                    </span>{' '}
                    more on our page to unlock{' '}
                    <strong className={`${nextTier.textClass} font-semibold`}>
                      {nextTier.name} (৳{nextTier.minSpendBdt.toLocaleString()} BDT)
                    </strong>
                    .
                  </p>
                ) : (
                  <p className="text-purple-300 font-semibold flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-purple-400" aria-hidden="true" />
                    Maximum VIP Rank Achieved! You are at Platinum Prestige (৳20,570+ BDT).
                  </p>
                )
              ) : (
                <p>
                  Every purchase made with your account automatically accumulates toward Bronze, Gold, Diamond, and Platinum VIP rewards!
                </p>
              )}
            </div>

            <div className="font-mono text-xs text-zinc-400 tabular-nums shrink-0">
              Total Spent:{' '}
              <span className="font-bold text-zinc-100">
                ৳{totalSpendBdt.toLocaleString()} BDT
              </span>
            </div>
          </div>

          {/* THE PROGRESS BAR WITH 4 MILESTONES */}
          <div className="pt-6 pb-4 relative z-10">
            {/* Background Track */}
            <div className="relative h-3 w-full rounded-full bg-[#090B0E] border border-white/10 overflow-hidden">
              {/* Active Fill Track */}
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-400 via-sky-400 to-purple-500 transition-all duration-700 ease-out relative"
                style={{ width: `${Math.max(1.5, Math.min(100, progressPercent))}%` }}
              >
                {/* Glowing leading indicator head */}
                <div className="absolute right-0 top-0 bottom-0 w-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
              </div>
            </div>

            {/* 4 Milestones Nodes on the Bar */}
            <div className="relative mt-3 grid grid-cols-4 gap-2 sm:gap-4">
              {LOYALTY_TIERS.slice(1).map((tier) => {
                const isReached = totalSpendBdt >= tier.minSpendBdt;
                const isCurrent = currentTier.id === tier.id;
                const isSelected = selectedTierId === tier.id;

                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() =>
                      setSelectedTierId((prev) => (prev === tier.id ? null : tier.id))
                    }
                    className={`group text-left rounded-xl p-3 sm:p-3.5 border transition-all duration-200 cursor-pointer ${
                      isCurrent
                        ? `${tier.borderClass} ${tier.bgClass} shadow-lg ring-1 ring-amber-400/40`
                        : isReached
                        ? `${tier.borderClass} bg-[#090B0E]/80 hover:bg-[#090B0E]`
                        : 'border-white/10 bg-[#090B0E]/50 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-2">
                      <div
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                          isReached
                            ? `${tier.borderClass} ${tier.bgClass} ${tier.textClass}`
                            : 'border-white/10 bg-white/[0.04] text-zinc-500'
                        }`}
                      >
                        {getTierIcon(tier.id, 'w-4 h-4 sm:w-4.5 sm:h-4.5')}
                      </div>

                      {isReached ? (
                        <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                          <Check className="w-3 h-3" aria-hidden="true" />
                          <span className="hidden sm:inline">Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 bg-white/[0.03] border border-white/10 px-1.5 py-0.5 rounded">
                          <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                          <span className="hidden sm:inline">Locked</span>
                        </span>
                      )}
                    </div>

                    <div className="font-display font-bold text-sm sm:text-base text-zinc-100 flex items-center gap-1.5">
                      <span className={tier.textClass}>{tier.name}</span>
                    </div>

                    <div className="font-mono text-xs font-semibold text-amber-300 mt-0.5 tabular-nums">
                      ৳{tier.minSpendBdt.toLocaleString()}{' '}
                      <span className="text-[10px] text-zinc-400">BDT</span>
                    </div>

                    <div className="text-[11px] text-zinc-400 mt-1 line-clamp-1">
                      {isReached
                        ? 'Unlocked'
                        : `৳${Math.max(0, tier.minSpendBdt - totalSpendBdt).toLocaleString()} needed`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expandable / Selected Tier Details Card */}
          <div className="rounded-lg bg-[#090B0E] border border-white/10 p-4 space-y-3 relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center border ${activeInspectTier.borderClass} ${activeInspectTier.bgClass} ${activeInspectTier.textClass}`}
                >
                  {getTierIcon(activeInspectTier.id, 'w-4 h-4')}
                </div>
                <div>
                  <h4 className="font-display text-sm font-bold text-zinc-100">
                    <span className={activeInspectTier.textClass}>
                      {activeInspectTier.badgeLabel}
                    </span>{' '}
                    — Spending Requirement:{' '}
                    <span className="font-mono text-amber-400 tabular-nums">
                      ৳{activeInspectTier.minSpendBdt.toLocaleString()} BDT
                    </span>
                  </h4>
                </div>
              </div>

              <div className="text-xs text-zinc-400">
                Click any tier box above to preview perks
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
              {activeInspectTier.perks.map((perk, i) => (
                <div
                  key={i}
                  className="rounded bg-[#131820] border border-white/[0.06] p-2.5 flex items-start gap-2 text-xs text-zinc-300"
                >
                  <Award className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${activeInspectTier.textClass}`} />
                  <span>{perk}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
