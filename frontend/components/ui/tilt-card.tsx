"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A panel that rotates out of a 3D perspective plane and settles flat as it
 * scrolls into view.
 *
 * This is the dashboard-screenshot effect in the reference recording: the
 * screenshot starts tilted back and at a slight angle, then straightens and
 * scales up as it rises through the viewport.
 *
 * Implementation notes:
 *  - The transform is written directly to `style` inside a rAF callback rather
 *    than held in React state. A scroll handler that calls setState re-renders
 *    on every frame and stutters on the mid-range Android devices this app
 *    targets.
 *  - Listeners are passive and removed on unmount.
 *  - Under `prefers-reduced-motion` the element is left flat and untransformed.
 */
export function TiltCard({
  children,
  className,
  /** Maximum backward rotation, in degrees, before the card settles. */
  maxTilt = 14,
  /** Slight yaw, so the card looks photographed rather than drawn. */
  yaw = -6,
  /** Scale when fully settled. */
  scaleTo = 1,
  /** Scale when first entering the viewport. */
  scaleFrom = 0.9,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  yaw?: number;
  scaleTo?: number;
  scaleFrom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      el.style.transform = "none";
      return;
    }

    let frame = 0;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const viewport = window.innerHeight || 1;

      // 0 while the card is still low on screen, 1 once it has risen past the
      // upper third — the window in which the reference finishes its motion.
      const raw = 1 - (rect.top - viewport * 0.12) / (viewport * 0.62);
      const progress = Math.min(1, Math.max(0, raw));

      const tilt = maxTilt * (1 - progress);
      const yawNow = yaw * (1 - progress);
      const scale = scaleFrom + (scaleTo - scaleFrom) * progress;

      el.style.transform =
        `perspective(1500px) rotateX(${tilt.toFixed(2)}deg) ` +
        `rotateY(${yawNow.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [maxTilt, yaw, scaleFrom, scaleTo]);

  return (
    <div className={cn("[perspective:1500px]", className)}>
      <div ref={ref} className="origin-center will-change-transform">
        {children}
      </div>
    </div>
  );
}
