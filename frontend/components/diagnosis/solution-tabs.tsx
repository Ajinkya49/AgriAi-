"use client";

import { CheckCircle2, ExternalLink, FlaskConical, ScrollText } from "lucide-react";
import { useId, useState } from "react";

import type { Solution, Solutions } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Natural / Traditional solution tabs on the diagnosis screen.
 *
 * Per the UI/UX brief the two sections must be **visually distinct** so a farmer
 * immediately understands they are different categories of advice:
 *   * Natural      — green tint
 *   * Traditional  — warm brown tint, always carrying the
 *                    "Traditional Practice — Not a Guaranteed Treatment" badge
 *
 * Every card shows its source, because the credibility of the advice is the
 * whole point of separating curated guidance from a model's guess.
 */
type TabKey = "natural" | "traditional";

const TABS: {
  key: TabKey;
  label: string;
  icon: typeof FlaskConical;
  panel: string;
  chipActive: string;
  card: string;
  heading: string;
}[] = [
  {
    key: "natural",
    label: "Natural solutions",
    icon: FlaskConical,
    panel: "bg-natural-bg",
    // Tinted, not solid. A filled `bg-natural-text` chip is technically
    // accessible but reads as a bright block dropped into a dark UI; the tint
    // plus a ring keeps the two categories obviously distinct without it.
    chipActive:
      "bg-natural-text/20 text-natural-text ring-1 ring-inset ring-natural-text/45",
    card: "border-natural-border bg-surface-2/70",
    heading: "text-natural-text",
  },
  {
    key: "traditional",
    label: "Ancient & Traditional",
    icon: ScrollText,
    panel: "bg-traditional-bg",
    chipActive:
      "bg-traditional-text/20 text-traditional-text ring-1 ring-inset ring-traditional-text/45",
    card: "border-traditional-border bg-surface-2/70",
    heading: "text-traditional-text",
  },
];

export function SolutionTabs({
  solutions,
  heading = "What you can do",
}: {
  solutions: Solutions;
  heading?: string;
}) {
  const [active, setActive] = useState<TabKey>("natural");
  const baseId = useId();

  const counts: Record<TabKey, number> = {
    natural: solutions.natural.length,
    traditional: solutions.traditional.length,
  };

  // Nothing at all: say so plainly rather than rendering two empty panels.
  if (solutions.total === 0) {
    return (
      <section className="rounded-card glass shadow-card p-5">
        <h2 className="font-semibold">{heading}</h2>
        <p className="text-muted mt-2 text-base">
          We don&apos;t have reviewed guidance for this result yet. Please confirm with
          your local KVK or extension officer.
        </p>
      </section>
    );
  }

  // One section missing: show the other and be explicit about the gap.
  const onlyTab: TabKey | null = !solutions.complete
    ? solutions.natural.length > 0
      ? "natural"
      : "traditional"
    : null;
  const effectiveTab: TabKey = onlyTab ?? active;
  const activeTab = TABS.find((t) => t.key === effectiveTab) ?? TABS[0];
  const items: Solution[] =
    effectiveTab === "natural" ? solutions.natural : solutions.traditional;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{heading}</h2>

      <div
        role="tablist"
        aria-label="Solution categories"
        className="rounded-card glass flex gap-2 p-1"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === effectiveTab;
          const count = counts[tab.key];
          const disabled = count === 0 && Boolean(onlyTab);
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${tab.key}`}
              disabled={disabled}
              onClick={() => setActive(tab.key)}
              className={cn(
                "min-h-tap flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-semibold transition-colors",
                isActive ? tab.chipActive : "text-muted",
                disabled && "opacity-40",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="text-left leading-tight">
                {tab.key === "natural" ? "Natural" : "Traditional"}
                <span className="ml-1 font-normal">({count})</span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${effectiveTab}`}
        aria-labelledby={`${baseId}-tab-${effectiveTab}`}
        className={cn("rounded-card flex flex-col gap-3 p-4", activeTab.panel)}
      >
        {effectiveTab === "traditional" && (
          <span className="text-traditional-text bg-surface-2/80 w-fit rounded-full px-3 py-0.5 text-sm font-semibold">
            Traditional Practice — Not a Guaranteed Treatment
          </span>
        )}

        {onlyTab && (
          <p className="text-muted text-sm">
            {counts[effectiveTab === "natural" ? "traditional" : "natural"] === 0
              ? "The other category has no reviewed entries for this disease yet."
              : ""}
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {items.map((solution) => (
            <SolutionCard
              key={solution.id}
              solution={solution}
              heading={activeTab.heading}
              card={activeTab.card}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SolutionCard({
  solution,
  heading,
  card,
}: {
  solution: Solution;
  heading: string;
  card: string;
}) {
  return (
    <li className={cn("rounded-card flex flex-col gap-2 border p-4", card)}>
      <h3 className={cn("font-semibold", heading)}>{solution.title}</h3>
      <p className="text-base">{solution.description}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {solution.source_url ? (
          <a
            href={solution.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2"
          >
            Source: {solution.source_name}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-muted text-sm font-semibold">
            Source: {solution.source_name}
          </span>
        )}

        {solution.region_specific && (
          <span className="bg-surface-3 text-muted rounded-full px-2 py-0.5 text-sm">
            {solution.region_specific}
          </span>
        )}

        {solution.verified && (
          <span className="text-muted inline-flex items-center gap-1 text-sm">
            <CheckCircle2 className="text-primary size-3.5" aria-hidden="true" />
            Traced to source
          </span>
        )}
      </div>
    </li>
  );
}
