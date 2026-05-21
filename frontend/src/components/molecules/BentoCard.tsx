import type { ComponentPropsWithoutRef, ReactNode } from "react";

type BentoCardProps = {
  children: ReactNode;
  className?: string;
  /** e.g. md:col-span-2 */
  spanClass?: string;
} & Pick<ComponentPropsWithoutRef<"section">, "aria-labelledby" | "id">;

export function BentoCard({ children, className = "", spanClass = "", ...rest }: BentoCardProps) {
  return (
    <section
      {...rest}
      className={`rounded-bento border border-brushed-chrome/25 bg-gray-200/90 p-5 shadow-luxury backdrop-blur-sm ${spanClass} ${className}`}
    >
      {children}
    </section>
  );
}
