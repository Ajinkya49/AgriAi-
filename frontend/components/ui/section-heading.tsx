import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The small pill/dash label that opens each section in the reference
 * ("— Live", "Before vs. After", "Why us").
 *
 * Two variants because the reference uses both: a plain dash-and-caps label on
 * dark, and a bordered pill for the higher-emphasis sections.
 */
export function Eyebrow({
  children,
  variant = "dash",
  className,
}: {
  children: ReactNode;
  variant?: "dash" | "pill";
  className?: string;
}) {
  if (variant === "pill") {
    return (
      <span
        className={cn(
          // `w-fit` matters: inside a flex column the default `align-items:
          // stretch` would pull this pill across the full width, so the border
          // reads as a divider rather than a label.
          "glass text-primary inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-[0.14em] uppercase",
          className,
        )}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-muted inline-flex w-fit items-center gap-3 text-xs font-semibold tracking-[0.18em] uppercase",
        className,
      )}
    >
      <span aria-hidden="true" className="bg-border h-px w-8" />
      {children}
    </span>
  );
}

/**
 * Section heading block: optional eyebrow, a display-face title, optional
 * supporting line. Centred or left-aligned.
 */
export function SectionHeading({
  eyebrow,
  eyebrowVariant = "dash",
  title,
  description,
  align = "left",
  className,
  children,
}: {
  eyebrow?: ReactNode;
  eyebrowVariant?: "dash" | "pill";
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
  children?: ReactNode;
}) {
  const centered = align === "center";

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        centered && "items-center text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow variant={eyebrowVariant}>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "text-muted max-w-2xl text-base sm:text-lg",
            centered && "mx-auto",
          )}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
