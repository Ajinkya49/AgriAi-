import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Infinite horizontal marquee, as used for the logo strip in the reference.
 *
 * The track holds the children twice and is translated by -50%, so the second
 * copy lands exactly where the first began and the loop is seamless. Duplicated
 * content is `aria-hidden` so it is announced only once.
 *
 * Pauses on hover so a visitor can actually read an item they are interested in.
 */
export function Marquee({
  children,
  className,
  reverse = false,
  speed = 38,
}: {
  children: ReactNode;
  className?: string;
  reverse?: boolean;
  /** Seconds for one full pass. Higher is slower. */
  speed?: number;
}) {
  return (
    <div className={cn("marquee-mask group overflow-hidden", className)}>
      <div
        className="marquee-track group-hover:[animation-play-state:paused]"
        style={{
          animationDuration: `${speed}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
