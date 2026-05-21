/**
 * Oliver Roos Frisuren hallmark:
 * Dense ultra-thin vertical lines intersected by one delicate downward curve.
 */
type BrandMotifProps = {
  className?: string;
};

export function BrandMotif({ className = "h-16 w-[6rem] text-deep-charcoal/58" }: BrandMotifProps) {
  const lines = Array.from({ length: 28 }, (_, i) => 4 + i * 3.4);

  return (
    <svg
      className={className}
      viewBox="0 0 100 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable={false}
    >
      {lines.map((x, i) => (
        <line
          key={x}
          x1={x}
          y1="2"
          x2={x}
          y2="148"
          stroke="currentColor"
          strokeWidth={0.22}
          opacity={i % 4 === 0 ? 0.62 : 0.36}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d="M 8 74 C 30 118, 56 148, 92 142"
        stroke="currentColor"
        strokeWidth={0.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.92}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
