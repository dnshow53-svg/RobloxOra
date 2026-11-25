import { useEffect, useState } from 'react';
import { formatCountdown } from '../data/packages';

interface RestockCountdownCardProps {
  availableRobux: number;
  restockTimestamp?: number;
  compact?: boolean;
}

export function RestockCountdownCard({
  availableRobux,
  restockTimestamp,
  compact = false,
}: RestockCountdownCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [restockTimestamp]);

  const remainingSeconds =
    typeof restockTimestamp === 'number' && restockTimestamp > 0
      ? Math.max(0, Math.ceil((restockTimestamp - nowMs) / 1000))
      : 0;
  const c = formatCountdown(remainingSeconds);

  return (
    <div
      className={`rounded-xl bg-[#090B0E] border border-red-500/35 ${
        compact ? 'p-4 space-y-3' : 'p-5 space-y-4'
      } shadow-lg shadow-red-500/5`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Out of stock
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-mono font-bold text-zinc-100 tabular-nums ${
              compact ? 'text-lg' : 'text-2xl'
            }`}
          >
            {Math.max(0, availableRobux).toLocaleString()}
          </span>
          <span className="text-xs sm:text-sm text-zinc-400 font-medium">
            Robux available
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
          Back in stock in
        </div>
        <div className={`grid grid-cols-4 ${compact ? 'gap-1.5' : 'gap-2.5'} text-center`}>
          {[
            { value: c.days, label: 'DAYS' },
            { value: c.hours, label: 'HRS' },
            { value: c.minutes, label: 'MIN' },
            { value: c.seconds, label: 'SEC' },
          ].map((item) => (
            <div
              key={item.label}
              className={`rounded-lg bg-[#131820] border border-white/10 ${
                compact ? 'p-2' : 'p-3'
              }`}
            >
              <div
                className={`font-mono font-bold text-amber-400 tabular-nums ${
                  compact ? 'text-base' : 'text-xl sm:text-2xl'
                }`}
              >
                {item.value}
              </div>
              <div className="text-[10px] uppercase font-medium text-zinc-400 mt-0.5 tracking-wide">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
