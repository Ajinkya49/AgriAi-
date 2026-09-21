import { cn } from "@/lib/utils";

/**
 * Soft colour washes behind hero and section headings.
 *
 * These were bright violet blooms on a near-black canvas. On off-white the same
 * opacity would wash out the background and drag every piece of text on it below
 * AA, so they are re-derived rather than recoloured: **much** fainter, larger and
 * lower-contrast, reading as warm sunlight on paper rather than as a light
 * source.
 *
 * Purely decorative: hidden from assistive technology.
 */
export function GlowOrbs({
  className,
  variant = "hero",
}: {
  className?: string;
  variant?: "hero" | "section" | "soft";
}) {
  if (variant === "soft") {
    return (
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      >
        <div className="absolute top-1/2 left-1/2 size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(46,125,50,0.07),transparent_68%)] blur-3xl" />
      </div>
    );
  }

  const hero = variant === "hero";

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/* Green wash, upper left. */}
      <div
        className={cn(
          "absolute rounded-full blur-[90px]",
          hero
            ? "animate-float-slow -top-64 -left-40 size-[50rem] bg-[radial-gradient(circle,rgba(46,125,50,0.14),transparent_64%)]"
            : "-top-40 -left-24 size-[30rem] bg-[radial-gradient(circle,rgba(46,125,50,0.09),transparent_68%)]",
        )}
      />
      {/* Amber wash, right, drifting out of phase — the "harvest" half of the
          palette, so the canvas is not monochrome green. */}
      <div
        className={cn(
          "animate-float absolute rounded-full blur-[100px]",
          hero
            ? "top-1/4 -right-40 size-[42rem] bg-[radial-gradient(circle,rgba(255,179,0,0.13),transparent_66%)] [animation-delay:-4s]"
            : "-right-32 bottom-0 size-[26rem] bg-[radial-gradient(circle,rgba(255,179,0,0.09),transparent_70%)] [animation-delay:-6s]",
        )}
      />
      {/* A tighter core behind the headline. Still faint: its job is to lift the
          heading off the canvas, not to be seen. */}
      <div
        className={cn(
          "animate-pulse-glow absolute rounded-full blur-[60px]",
          hero
            ? "top-16 left-1/2 size-[30rem] -translate-x-1/2 bg-[radial-gradient(circle,rgba(67,160,71,0.11),transparent_62%)]"
            : "top-24 left-1/3 size-[22rem] bg-[radial-gradient(circle,rgba(67,160,71,0.08),transparent_62%)]",
        )}
      />
    </div>
  );
}

/**
 * A faint green grid, masked so it fades toward the edges.
 *
 * Opacity is far lower than the dark-theme version: at 0.18 over off-white the
 * lines competed with body text, which is exactly the readability problem a
 * light theme is supposed to solve.
 */
export function GridBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 opacity-[0.05]",
        "[background-image:linear-gradient(rgba(46,125,50,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(46,125,50,0.6)_1px,transparent_1px)]",
        "[background-size:56px_56px]",
        "[mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_20%,transparent_75%)]",
        className,
      )}
    />
  );
}
