"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Cycles a headline through a list of phrases, as the reference hero does
 * ("Win jobs faster." → "Or by photo.").
 *
 * The outgoing phrase is replaced rather than cross-faded: re-keying the node
 * restarts the CSS animation, which keeps the DOM to a single element and
 * avoids measuring or absolutely positioning anything.
 *
 * Accessibility: the full list is announced once via a visually hidden element
 * so a screen reader user is not read a sentence that keeps changing, and the
 * visible node is `aria-hidden`.
 */
export function RotatingText({
  phrases,
  interval = 2800,
  className,
}: {
  phrases: readonly string[];
  interval?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [motionAllowed, setMotionAllowed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionAllowed(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // Respect the user's motion preference — a headline that keeps swapping
    // while they read is exactly what that setting exists to prevent.
    if (!motionAllowed || phrases.length < 2) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % phrases.length),
      interval,
    );
    return () => window.clearInterval(timer);
  }, [motionAllowed, interval, phrases.length]);

  const active = phrases[index] ?? phrases[0];

  return (
    <>
      {/* One stable, readable copy for assistive technology. */}
      <span className="sr-only">{phrases.join(" ")}</span>

      <span aria-hidden="true" className={cn("inline-block", className)}>
        <span key={active} className="animate-fade-up inline-block">
          {active}
        </span>
      </span>
    </>
  );
}
