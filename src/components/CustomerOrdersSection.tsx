import {
  CheckCircle2,
  Clock,
  Mail,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { OrderRecord, normalizeOrderStatus } from '../data/packages';

interface CustomerOrdersSectionProps {
  userEmail: string;
  orders: OrderRecord[];
  onRefresh: () => void;
}

export function CustomerOrdersSection({
  userEmail,
  orders,
  onRefresh,
}: CustomerOrdersSectionProps) {
  const normalizedOrders = orders.map((o) => ({
    ...o,
    status: normalizeOrderStatus(o.status),
  }));

  const confirmedOrders = normalizedOrders.filter(
    (o) => o.status === 'Approved' || o.status === 'Completed'
  );

  return (
    <section
      id="my-orders"
      className="py-20 border-t border-white/[0.08]"
      aria-labelledby="my-orders-heading"
    >
      <div className="max-w-6xl mx-auto px-6 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-amber-400 mb-2">
              Live Order Tracker
            </p>
            <h2
              id="my-orders-heading"
              className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-100"
            >
              My Orders &amp; Admin Confirmation
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Signed in as <span className="font-mono text-zinc-200">{userEmail}</span> · Updates automatically when Admin confirms your order.
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-[#131820] border border-white/10 px-4 py-2 text-xs font-medium text-zinc-200 hover:border-amber-400/50 hover:text-white transition-colors self-start sm:self-auto shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            <span>Refresh Status</span>
          </button>
        </div>

        {confirmedOrders.length > 0 && (
          <div
            role="status"
            className="rounded-xl bg-emerald-500/10 border border-emerald-500/35 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/35 text-emerald-300 shrink-0">
                <PackageCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-emerald-300">
                  {confirmedOrders[0].status === 'Completed'
                    ? `Order #${confirmedOrders[0].orderNumber} Confirmed & Robux Delivered!`
                    : `Order #${confirmedOrders[0].orderNumber} Confirmed by Admin!`}
                </h3>
                <p className="mt-1 text-xs text-zinc-200 leading-relaxed">
                  {confirmedOrders[0].status === 'Completed'
                    ? `${confirmedOrders[0].packageTitle} has been marked Completed for Roblox account "${confirmedOrders[0].robloxUsername}".`
                    : `Admin confirmed your ${confirmedOrders[0].packageTitle} order for "${confirmedOrders[0].robloxUsername}". Your Robux payout is approved for delivery.`}
                </p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-emerald-200/90">
                  <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {confirmedOrders[0].emailStatus === 'sent'
                      ? `Confirmation email sent to ${confirmedOrders[0].userEmail}`
                      : `Confirmation registered for ${confirmedOrders[0].userEmail}`}
                  </span>
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-2 text-xs font-semibold text-emerald-300 whitespace-nowrap self-start sm:self-center">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              {confirmedOrders.length} Confirmed {confirmedOrders.length === 1 ? 'Order' : 'Orders'}
            </span>
          </div>
        )}

        {normalizedOrders.length === 0 ? (
          <div className="rounded-xl bg-[#131820] border border-white/[0.08] p-8 text-center space-y-2">
            <p className="text-sm font-medium text-zinc-200">
              No orders placed under your account yet.
            </p>
            <p className="text-xs text-zinc-400">
              Verify your Roblox group membership above to start your 15-day timer and place an order — its live Admin confirmation status will appear right here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {normalizedOrders.map((order) => {
              const isConfirmed =
                order.status === 'Approved' || order.status === 'Completed';
              const isCompleted = order.status === 'Completed';
              const isCancelled = order.status === 'Cancelled';
              const hasPaid =
                order.status !== 'Waiting' &&
                !isCancelled &&
                Boolean(order.transactionId || order.status !== 'Pending');

              const statusBadge =
                order.status === 'Completed'
                  ? 'Confirmed & Delivered'
                  : order.status === 'Approved'
                  ? 'Confirmed by Admin'
                  : order.status === 'Cancelled'
                  ? 'Cancelled'
                  : order.status === 'Waiting'
                  ? '15-Day Hold Active'
                  : 'Pending Admin Confirmation';

              const statusDescription =
                order.status === 'Completed'
                  ? 'Admin confirmed and completed your Robux delivery.'
                  : order.status === 'Approved'
                  ? 'Admin confirmed your payment and approved your order for Robux payout.'
                  : order.status === 'Cancelled'
                  ? 'This order was cancelled. Contact support if you need help.'
                  : order.status === 'Waiting'
                  ? 'Waiting for your 15-day Roblox group hold timer to finish before submitting payment.'
                  : 'Your payment is submitted and awaiting Admin confirmation in the Admin Panel.';

              const steps = [
                { label: '15-Day Hold', done: order.status !== 'Waiting' && !isCancelled },
                { label: 'Order Placed', done: hasPaid },
                { label: 'Admin Confirmed', done: isConfirmed },
                { label: 'Robux Delivered', done: isCompleted },
              ];

              return (
                <article
                  key={order.id}
                  className={`rounded-xl bg-[#131820] border p-5 space-y-4 ${
                    isConfirmed
                      ? 'border-emerald-500/40'
                      : isCancelled
                      ? 'border-red-500/30'
                      : 'border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-amber-300">
                          {order.orderNumber}
                        </span>
                        <span className="text-xs text-zinc-500">·</span>
                        <span className="text-xs text-zinc-400">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-bold text-zinc-100 mt-1">
                        {order.packageTitle}
                      </h3>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold shrink-0 ${
                        isConfirmed
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                          : isCancelled
                          ? 'bg-red-500/15 border-red-500/30 text-red-300'
                          : order.status === 'Waiting'
                          ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                          : 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                      }`}
                    >
                      {isConfirmed ? (
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : isCancelled ? (
                        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{statusBadge}</span>
                    </span>
                  </div>

                  {!isCancelled && (
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      {steps.map((step, idx) => (
                        <div key={step.label} className="space-y-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-colors ${
                              step.done
                                ? 'bg-emerald-400'
                                : idx === 2 && order.status === 'Pending'
                                ? 'bg-amber-400/60'
                                : 'bg-white/10'
                            }`}
                          />
                          <div
                            className={`text-[10px] font-medium truncate ${
                              step.done ? 'text-emerald-300' : 'text-zinc-500'
                            }`}
                          >
                            {step.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {statusDescription}
                  </p>

                  <div className="rounded-lg bg-[#0D1117] border border-white/[0.06] p-3.5 grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                    <div>
                      <span className="text-zinc-500 block text-[11px]">Roblox Account</span>
                      <span className="font-mono text-zinc-100">
                        {order.robloxUsername || 'Verified Member'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[11px]">Amount</span>
                      <span className="font-mono font-semibold text-zinc-100">
                        ৳{order.priceBdt} BDT
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[11px]">Payment Method</span>
                      <span className="text-zinc-200">{order.paymentMethod}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[11px]">
                        {order.transactionId ? 'Transaction ID' : 'Updated'}
                      </span>
                      <span className="font-mono text-zinc-200">
                        {order.transactionId ||
                          new Date(order.confirmedAt || order.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {isConfirmed && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-300/90 pt-1 border-t border-white/[0.06]">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {order.emailStatus === 'sent'
                            ? `Email sent to ${order.userEmail}`
                            : `Account email: ${order.userEmail}`}
                        </span>
                      </span>
                      {order.confirmedAt && (
                        <span className="text-zinc-400">
                          Confirmed {new Date(order.confirmedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
