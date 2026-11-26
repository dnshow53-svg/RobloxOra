export interface RobuxPackage {
  id: string;
  robux: number;
  title: string;
  tierLabel: string;
  priceBdt: number;
  deliveryNote: string;
  image: string;
}

export interface PaymentOption {
  id: string;
  name: string;
  detail: string;
  comingSoon?: boolean;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  avatar?: string;
  updatedAtMs?: number;
  createdAt: string;
}

export type SessionState =
  | { role: 'user'; email: string }
  | { role: 'admin'; email: string }
  | null;

export type OrderStatus =
  | 'Waiting'
  | 'Pending'
  | 'Approved'
  | 'Completed'
  | 'Cancelled';

export function normalizeOrderStatus(raw: unknown): OrderStatus {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'waiting') return 'Waiting';
  if (clean === 'approved') return 'Approved';
  if (clean === 'completed') return 'Completed';
  if (clean === 'cancelled' || clean === 'canceled') return 'Cancelled';
  if (clean === 'pending' || clean === 'queued') return 'Pending';
  return 'Pending';
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
  robloxUsername: string;
  robloxUserId?: number | null;
  packageId: string;
  packageTitle: string;
  robuxAmount: number;
  priceBdt: number;
  paymentMethod: string;
  transactionId?: string;
  paymentVerified?: boolean;
  status: OrderStatus;
  verifiedAtMs?: number;
  unlockAtMs?: number;
  createdAt: string;
  confirmedAt?: string;
}

export interface VerifiedPaymentRecord {
  id: string;
  method: 'Nagad' | 'Rocket' | 'bKash';
  trxId: string;
  amountBdt: number;
  senderPhone?: string;
  receiverPhone: string;
  source: 'sms_webhook' | 'admin_manual';
  usedByOrderId?: string;
  receivedAt: string;
}

export interface VerificationTimerState {
  hasClickedGroupLink: boolean;
  isGroupVerified: boolean;
  unlockAtMs: number;
  verifiedAtMs: number;
  robloxUsername: string;
  robloxUserId: number | null;
}

export interface GroupSettings {
  groupId: number;
  groupUrl: string;
  availableRobux: number;
  restockTimestamp?: number;
  updatedAtMs?: number;
}

// Default Roblox Group ID & Community Link (editable live in Admin Panel)
export const TARGET_GROUP_ID = 401717676;
export const ROBLOX_GROUP_URL =
  'https://www.roblox.com/communities/401717676/Velvet-Visions-Studio#!/about';

export const ADMIN_EMAIL = 'dnshow53@gmail.com';
export const ADMIN_PASSWORD = 'abdullah1029@#£';

// 15 days in seconds (15 * 24 * 60 * 60 = 1,296,000)
export const FIFTEEN_DAYS_SECONDS = 15 * 24 * 60 * 60;

export const CLICK_REQUIRED_ERROR =
  'You are not clicked! Please click Join Community first.';

export const NOT_JOINED_ERROR =
  'Verification Failed! You have not joined the Roblox community yet. Please join the group on Roblox and try again.';

export const UNJOINED_WARNING =
  'You left the Roblox community! You must rejoin and wait 15 days again to unlock payment.';

export const PAYMENT_LOCKED_MESSAGE =
  'Complete group join and wait 15 days to unlock payment.';

export const DEFAULT_ROBUX_PACKAGES: RobuxPackage[] = [
  {
    id: 'pkg-400',
    robux: 400,
    title: '400 Robux',
    tierLabel: 'Starter Vault',
    priceBdt: 590,
    deliveryNote: 'Group Payout',
    image: '',
  },
  {
    id: 'pkg-800',
    robux: 800,
    title: '800 Robux',
    tierLabel: 'Standard Stack',
    priceBdt: 1180,
    deliveryNote: 'Most Selected',
    image: '',
  },
  {
    id: 'pkg-1700',
    robux: 1700,
    title: '1,700 Robux',
    tierLabel: 'Titanium Vault',
    priceBdt: 2350,
    deliveryNote: 'Best Value',
    image: '',
  },
];

export const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: 'nagad',
    name: 'Nagad',
    detail: 'Send Money: 01764088123',
  },
  {
    id: 'rocket',
    name: 'Rocket',
    detail: 'Send Money: 01764088123',
  },
  {
    id: 'bkash',
    name: 'bKash',
    detail: 'Coming Soon',
    comingSoon: true,
  },
];

export function formatCountdown(totalSeconds: number): {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
} {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(clamped / 86400);
  const hours = Math.floor((clamped % 86400) / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  return {
    days: String(days).padStart(2, '0'),
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  };
}

export type LoyaltyTierId = 'starter' | 'bronze' | 'gold' | 'diamond' | 'platinum';

export interface LoyaltyTier {
  id: LoyaltyTierId;
  name: string;
  minSpendBdt: number;
  badgeLabel: string;
  colorName: string;
  gradient: string;
  borderClass: string;
  textClass: string;
  bgClass: string;
  perks: string[];
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    minSpendBdt: 0,
    badgeLabel: 'Starter Member',
    colorName: 'zinc',
    gradient: 'from-zinc-500 to-zinc-400',
    borderClass: 'border-zinc-700/60',
    textClass: 'text-zinc-400',
    bgClass: 'bg-zinc-800/40',
    perks: ['Community Discord Access', 'Standard 15-Hour Delivery Window', 'Full Order History Tracking'],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    minSpendBdt: 500,
    badgeLabel: 'Bronze VIP',
    colorName: 'bronze',
    gradient: 'from-[#D97706] to-[#CD7F32]',
    borderClass: 'border-amber-700/70',
    textClass: 'text-amber-500',
    bgClass: 'bg-amber-950/40',
    perks: ['Bronze Profile Badge', 'Priority Payout Queue', 'Dedicated SMS Payment Matching'],
  },
  {
    id: 'gold',
    name: 'Gold',
    minSpendBdt: 2000,
    badgeLabel: 'Gold VIP',
    colorName: 'gold',
    gradient: 'from-amber-400 to-amber-500',
    borderClass: 'border-amber-400/80',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-500/15',
    perks: ['Gold Crown VIP Badge', 'Instant Payment Verification', 'Priority Admin Assistance', 'VIP Restock Alerts'],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    minSpendBdt: 10000,
    badgeLabel: 'Diamond Elite',
    colorName: 'diamond',
    gradient: 'from-cyan-400 to-sky-500',
    borderClass: 'border-sky-400/80',
    textClass: 'text-sky-300',
    bgClass: 'bg-sky-500/15',
    perks: ['Diamond Elite Crown', 'Express Payout Priority', 'Personal Account Manager', 'Zero Fee Guarantee'],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minSpendBdt: 20570,
    badgeLabel: 'Platinum Prestige',
    colorName: 'platinum',
    gradient: 'from-purple-400 via-fuchsia-300 to-indigo-400',
    borderClass: 'border-purple-400/80',
    textClass: 'text-purple-300',
    bgClass: 'bg-purple-500/20',
    perks: ['Platinum Prestige Status', 'Maximum Storefront VIP Priority', 'Top-Tier Group Transfer Slots', 'Lifetime VIP Care'],
  },
];

export function calculateUserTotalSpend(orders: OrderRecord[], userEmail?: string | null): number {
  if (!userEmail) return 0;
  const cleanEmail = userEmail.toLowerCase().trim();
  return orders
    .filter((o) => {
      if (o.userEmail.toLowerCase().trim() !== cleanEmail) return false;
      // Count valid customer orders that are completed, approved, or pending submission
      return o.status === 'Completed' || o.status === 'Approved' || (o.status === 'Pending' && Boolean(o.transactionId));
    })
    .reduce((sum, o) => sum + (Number(o.priceBdt) || 0), 0);
}

export function getUserLoyaltyTier(totalSpendBdt: number): LoyaltyTier {
  if (totalSpendBdt >= 20570) return LOYALTY_TIERS[4]; // Platinum
  if (totalSpendBdt >= 10000) return LOYALTY_TIERS[3]; // Diamond
  if (totalSpendBdt >= 2000) return LOYALTY_TIERS[2];  // Gold
  if (totalSpendBdt >= 500) return LOYALTY_TIERS[1];   // Bronze
  return LOYALTY_TIERS[0]; // Starter
}

export function getNextLoyaltyTier(currentTier: LoyaltyTier): LoyaltyTier | null {
  const idx = LOYALTY_TIERS.findIndex((t) => t.id === currentTier.id);
  if (idx < 0 || idx >= LOYALTY_TIERS.length - 1) return null;
  return LOYALTY_TIERS[idx + 1];
}

/**
 * Calculates 0-100% progress across the 4 milestones:
 * 0 to 500 => 0% - 25% (Bronze)
 * 500 to 2000 => 25% - 50% (Gold)
 * 2000 to 10000 => 50% - 75% (Diamond)
 * 10000 to 20570 => 75% - 100% (Platinum)
 */
export function calculateTierProgressPercent(totalSpendBdt: number): number {
  const spend = Math.max(0, totalSpendBdt);
  if (spend <= 0) return 0;
  if (spend < 500) {
    return (spend / 500) * 25;
  }
  if (spend < 2000) {
    return 25 + ((spend - 500) / (2000 - 500)) * 25;
  }
  if (spend < 10000) {
    return 50 + ((spend - 2000) / (10000 - 2000)) * 25;
  }
  if (spend < 20570) {
    return 75 + ((spend - 10000) / (20570 - 10000)) * 25;
  }
  return 100;
}
