"use client";

import { useState } from "react";

import { AppMockup, type MockupView } from "@/components/marketing/app-mockup";
import { TiltCard } from "@/components/ui/tilt-card";
import { cn } from "@/lib/utils";

/**
 * Tabbed product showcase.
 *
 * The reference's "Live" section: a row of pill tabs above a large app
 * screenshot that tilts in 3D as it scrolls. Selecting a tab swaps the mockup.
 *
 * Implemented as a proper tablist (roving arrow-key navigation, aria-selected,
 * aria-controls) rather than a row of buttons — a keyboard or screen reader user
 * gets the same affordance a mouse user does.
 */

const TABS: { id: MockupView; label: string; blurb: string }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    blurb:
      "Every past diagnosis in one place, each with the confidence score it was given.",
  },
  {
    id: "diagnosis",
    label: "Diagnosis",
    blurb:
      "Photograph a leaf and get the likely disease, how sure the model is, and what to do next.",
  },
  {
    id: "assistant",
    label: "Assistant",
    blurb:
      "Ask follow-up questions in plain language and get answers grounded in trusted sources.",
  },
];

export function Showcase() {
  const [active, setActive] = useState<MockupView>("dashboard");
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0];

  const move = (delta: number) => {
    const index = TABS.findIndex((tab) => tab.id === active);
    const next = (index + delta + TABS.length) % TABS.length;
    setActive(TABS[next].id);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Tabs ---- */}
      <div
        role="tablist"
        aria-label="Product screens"
        className="mx-auto flex flex-wrap items-center justify-center gap-2"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={cn(
                "min-h-tap rounded-full px-4 text-sm font-semibold transition-all duration-300",
                selected
                  ? "bg-accent shadow-glow text-white"
                  : "glass text-muted hover:text-ink",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <p className="text-muted mx-auto max-w-xl text-center text-base">{current.blurb}</p>

      {/* ---- Panel ---- */}
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="relative"
      >
        {/* Bloom behind the device, as in the reference. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-8 bottom-0 rounded-[3rem] bg-[radial-gradient(ellipse_at_center,rgba(46,125,50,0.12),transparent_70%)] blur-3xl"
        />
        <TiltCard maxTilt={12} yaw={-4} scaleFrom={0.93} className="relative">
          <AppMockup view={active} className="mx-auto max-w-3xl" />
        </TiltCard>
      </div>
    </div>
  );
}
