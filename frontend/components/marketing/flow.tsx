import {
  Camera,
  Cpu,
  Leaf,
  MessageCircle,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "How a photo becomes a plan" — the node diagram from the reference.
 *
 * The architecture is the point here: the disease model and the conversational
 * assistant are drawn as two separate stages on the spine, never as one box.
 * That separation is a hard constraint of the product, and this diagram is where
 * a technical reader confirms it.
 *
 * Connectors are drawn with CSS borders rather than an SVG so the whole thing
 * reflows correctly on narrow screens without recalculation.
 */

const STEPS = [
  {
    icon: Camera,
    title: "You take a photo",
    detail: "A leaf, in daylight. No special equipment.",
  },
  {
    icon: Cpu,
    title: "The model reads it",
    detail: "EfficientNet-B0 · 10 classes · Tomato, Potato, Pepper",
    accent: true,
  },
  {
    icon: ShieldCheck,
    title: "You see a result and how sure it is",
    detail: "A prediction with a confidence score — never a claim of certainty.",
  },
  {
    icon: Leaf,
    title: "Natural solutions",
    detail: "Non-chemical and preventive measures, from the curated library.",
    branch: "natural" as const,
  },
  {
    icon: ScrollText,
    title: "Traditional solutions",
    detail:
      "Regional practice, always labelled as traditional — not a guaranteed treatment.",
    branch: "traditional" as const,
  },
  {
    icon: MessageCircle,
    title: "Ask the assistant",
    detail: "Follow-up questions answered only from the reviewed knowledge base.",
    accent: true,
  },
  {
    icon: Users,
    title: "Compare with other farmers",
    detail: "See who else is growing the same crop, in the same region.",
  },
];

function Connector() {
  return (
    <div aria-hidden="true" className="flex justify-center">
      <span className="border-border h-7 border-l border-dashed" />
    </div>
  );
}

export function FlowDiagram() {
  return (
    <div className="relative mx-auto w-full max-w-lg">
      {/* Spine bloom */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/4 left-1/2 h-2/3 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(46,125,50,0.09),transparent_70%)] blur-2xl"
      />

      <ol className="relative flex flex-col">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            {index > 0 && <Connector />}
            <div
              className={cn(
                "glass rim relative flex items-start gap-3.5 rounded-2xl p-4 transition-transform duration-300 hover:scale-[1.02]",
                step.accent && "border-primary/25 shadow-glow",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  step.accent
                    ? "from-primary-dark to-primary bg-gradient-to-br text-white"
                    : step.branch === "natural"
                      ? "bg-natural-bg text-natural-text"
                      : step.branch === "traditional"
                        ? "bg-traditional-bg text-traditional-text"
                        : "bg-primary-soft text-primary",
                )}
              >
                <step.icon className="size-5" aria-hidden="true" />
              </span>

              <div className="flex flex-col gap-0.5">
                <span className="font-display text-[0.95rem] font-semibold">
                  {step.title}
                </span>
                <span className="text-muted text-sm leading-snug">{step.detail}</span>
              </div>

              {/* Step index, for a sense of sequence. `text-muted`, not the
                  border colour — at `--color-border` this measured 1.21:1
                  against the card, which is visible text that cannot be read. */}
              <span
                aria-hidden="true"
                className="text-muted absolute top-3 right-3.5 font-mono text-xs"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
