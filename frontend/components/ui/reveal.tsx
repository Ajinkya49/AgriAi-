"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Fade-and-rise reveal, driven by IntersectionObserver.
 *
 * Every marketing section in the reference recording animates in as it enters
 * the viewport. This is the shared wrapper for that behaviour.
 *
 * Two deliberate safeguards:
 *  1. The observer disconnects after the first reveal, so scrolling back up does
 *     not re-trigger the animation — re-animating on every scroll is nauseating.
 *  2. `prefers-reduced-motion` forces visibility via globals.css, so the content
 *     is never trapped at opacity 0 for users who opted out of motion.
 *
 * No "IntersectionObserver is missing" fallback is needed: `observe()` fires
 * immediately for an element that is already on screen, and the API is present
 * in every browser this app supports (Safari 12.1+). A guard here would only add
 * an unreachable branch — and a synchronous setState inside the effect body,
 * which React's lint rules correctly reject.
 */
export function Reveal({
  children,
  className,
  /** Anchor target, so a section can be linked to directly. */
  id,
  /** Stagger, in milliseconds. */
  delay = 0,
  /** Start further away for a more pronounced entrance. */
  distance = 28,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  delay?: number;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            return;
          }
        }
      },
      // Fire a little before the element is fully on screen so the motion has
      // finished by the time it is comfortably in view.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      data-visible={visible ? "true" : "false"}
      className={cn("reveal", className)}
      style={{
        transitionDelay: `${delay}ms`,
        // Read by the .reveal rule in globals.css.
        ["--reveal-y" as string]: `${distance}px`,
      }}
    >
      {children}
    </div>
  );
}
