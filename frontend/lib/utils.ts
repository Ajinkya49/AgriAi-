import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind conflicts.
 *
 * `cn("px-2 py-1", condition && "px-4")` -> "py-1 px-4"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Confidence banding used by the diagnosis result screen.
 *
 * The UI/UX brief specifies a green / amber / gray indicator (deliberately not
 * literal red, which reads as an alarm) rather than a raw percentage alone.
 * Thresholds: >= 0.70 high, >= 0.45 medium, below that low.
 *
 * NOTE: this only maps a score to a visual band. It never asserts certainty —
 * every diagnosis screen still shows the numeric score and, at low confidence,
 * the "confirm with a local expert" prompt.
 */
export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/**
 * Format a 0.0–1.0 confidence score as a percentage string for display.
 *
 * Two deliberate constraints, both from the product principles:
 *
 *  1. **Never 100%.** The PRD states the app must never claim an image diagnosis
 *     is certain. A genuine score of 0.996 would round to "100%" and read as a
 *     guarantee, so the displayed value is capped at 99%.
 *  2. **Round down, never up.** Rounding up would overstate confidence, which is
 *     the one direction that could cause real harm to a farmer's crop.
 *
 * The underlying score is stored and returned unmodified — only the label is
 * clamped.
 */
export function formatConfidence(score: number): string {
  return `${confidencePercent(score)}%`;
}

/** The integer percentage used for both the label and the indicator bar width. */
export function confidencePercent(score: number): number {
  return Math.min(99, Math.max(0, Math.floor(score * 100)));
}

/**
 * Short relative time for community posts — "just now", "3 h", "2 d".
 *
 * Deliberately terse: the audience reads this on a phone in a field, and an
 * absolute timestamp is more precise but harder to scan.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} w ago`;

  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
