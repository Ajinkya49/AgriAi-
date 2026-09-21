"use client";

import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A card with a violet glow that follows the pointer.
 *
 * The reference's bento cards light up under the cursor. Implemented with two
 * CSS custom properties written on pointer move, so the browser only has to
 * repaint a gradient — no React re-render, no layout work.
 *
 * On touch devices there is no hover, so the effect simply never appears and the
 * card renders as a plain panel.
 */
export function SpotlightCard({
  children,
  className,
  /** Radius of the glow, in pixels. */
  radius = 320,
  /** Glow colour. Defaults to the violet accent. */
  color = "rgba(46,125,50,0.10)",
}: {
  children: ReactNode;
  className?: string;
  radius?: number;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      className={cn("group/spot relative overflow-hidden", className)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
        style={{
          background: `radial-gradient(${radius}px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${color}, transparent 72%)`,
        }}
      />
      {/* Content sits above the glow. */}
      <div className="relative">{children}</div>
    </div>
  );
}
