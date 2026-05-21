type SkeletonCardProps = {
  className?: string;
  lines?: number;
};

/**
 * Deep-charcoal shimmer placeholder for Bento cells (Warm Minimalism).
 */
export function SkeletonCard({ className = "", lines = 3 }: SkeletonCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-bento border border-brushed-chrome/15 bg-gray-200 p-5 ${className}`}
      aria-hidden
    >
      <div className="pointer-events-none absolute inset-0 animate-shimmer-bar bg-gradient-to-r from-transparent via-champagne-gold/12 to-transparent" />
      <div className="h-4 w-2/5 rounded bg-brushed-chrome/15" />
      <div className="mt-3 h-3 w-3/5 rounded bg-brushed-chrome/10" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="mt-2 h-8 w-full rounded bg-gray-100/60" />
      ))}
    </div>
  );
}
