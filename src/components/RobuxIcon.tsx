import { useEffect, useState } from 'react';

export function BrandShardLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M15.5 3L6 14.5H13.2L11.5 25L22 13.5H14.8L15.5 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RobuxMark({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 2L20.66 7V17L12 22L3.34 17V7L12 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect
        x="8.75"
        y="8.75"
        width="6.5"
        height="6.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

interface PackageImageProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
}

export function ResilientImage({
  src,
  alt,
  title,
  className = '',
}: PackageImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (hasError) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-[#12161E] to-zinc-950 text-amber-400/80 p-6 ${className}`}
        role="img"
        aria-label={alt}
      >
        <RobuxMark className="w-10 h-10 mb-2" />
        <span className="text-xs font-medium tracking-wide text-zinc-400">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
