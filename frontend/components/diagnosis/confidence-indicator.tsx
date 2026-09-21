import { cn, confidencePercent } from "@/lib/utils";

/**
 * Confidence indicator (UI/UX brief).
 *
 * A horizontal bar plus a text label — never a bare percentage. The brief is
 * explicit that the scale uses green / amber / gray and **never literal red**,
 * because red reads as an alarm and a low-confidence result is a normal outcome,
 * not an error.
 *
 * Colour is never the only signal: the band name is always written out, so the
 * indicator still works for colour-blind users and on washed-out outdoor screens.
 */
const BAND_STYLES = {
  high: {
    bar: "bg-confidence-high",
    text: "text-confidence-high",
    label: "High confidence",
  },
  medium: {
    bar: "bg-confidence-medium",
    text: "text-confidence-medium-text",
    label: "Medium confidence",
  },
  low: {
    bar: "bg-confidence-low",
    text: "text-confidence-low-text",
    label: "Low confidence",
  },
} as const;

export type ConfidenceBandName = keyof typeof BAND_STYLES;

export function ConfidenceIndicator({
  score,
  band,
  className,
}: {
  score: number;
  band: ConfidenceBandName;
  className?: string;
}) {
  const style = BAND_STYLES[band];
  // Capped at 99 — the app never displays "100% confidence".
  const percent = confidencePercent(score);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("font-semibold", style.text)}>{style.label}</span>
        <span className="text-muted text-base">{percent}%</span>
      </div>

      <div
        className="bg-border h-3 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Model confidence ${percent} percent — ${style.label}`}
      >
        <div
          className={cn("h-full rounded-full", style.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
