import {
  ArrowRight,
  Camera,
  Check,
  Leaf,
  MessageCircle,
  Play,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FlowDiagram } from "@/components/marketing/flow";
import { Showcase } from "@/components/marketing/showcase";
import { SystemStatus } from "@/components/marketing/system-status";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { Counter } from "@/components/ui/counter";
import { GlowOrbs, GridBackdrop } from "@/components/ui/glow-orbs";
import { Marquee } from "@/components/ui/marquee";
import { Reveal } from "@/components/ui/reveal";
import { RotatingText } from "@/components/ui/rotating-text";
import { Eyebrow, SectionHeading } from "@/components/ui/section-heading";
import { SpotlightCard } from "@/components/ui/spotlight-card";

export const metadata: Metadata = {
  title: "Agri AI — Detect crop diseases, find trusted solutions",
  description:
    "Photograph a leaf and Agri AI identifies the likely disease, shows how confident it is, and gives you natural and traditional solutions. Plus a farming assistant and a community of farmers.",
};

/* ---------------------------------------------------------------------------
   Content
   ------------------------------------------------------------------------- */

/** Labels the deployed model actually predicts — mirrors app/models/labels.py. */
const RECOGNISES = [
  "Tomato - Early Blight",
  "Tomato - Late Blight",
  "Tomato - Leaf Mold",
  "Tomato - Septoria Leaf Spot",
  "Potato - Early Blight",
  "Potato - Late Blight",
  "Pepper - Bacterial Spot",
  "Healthy crops",
];

const HERO_ROTATION = ["From one photo.", "In seconds.", "Before it spreads."];

const FEATURES = [
  {
    icon: Camera,
    title: "Detect",
    body: "Photograph a leaf and get a disease prediction with a confidence score you can actually read.",
    tone: "primary" as const,
  },
  {
    icon: Leaf,
    title: "Natural solutions",
    body: "Non-chemical, preventive and biological approaches — sourced, not invented on the spot.",
    tone: "natural" as const,
  },
  {
    icon: ScrollText,
    title: "Traditional solutions",
    body: "Curated regional practice, always labelled as traditional. Never presented as a guaranteed treatment.",
    tone: "traditional" as const,
  },
  {
    icon: MessageCircle,
    title: "Ask the assistant",
    body: "Follow-up questions in plain language, answered only from the reviewed knowledge base — with its sources shown.",
    tone: "primary" as const,
  },
];

const STEPS = [
  {
    number: "01",
    title: "Take a photo",
    body: "Open Upload and photograph the affected leaf in daylight. Any phone camera works.",
  },
  {
    number: "02",
    title: "See what it is",
    body: "The model names the likely disease and tells you how confident it is — and asks an expert to confirm when it isn't sure.",
  },
  {
    number: "03",
    title: "Decide what to do",
    body: "Read the natural and traditional options, then ask the assistant anything you're still unsure about.",
  },
];

const COMPARISON = {
  without: [
    "Guessing from a photo in a WhatsApp group",
    "Advice that may not suit your crop or region",
    "No idea how reliable the answer is",
    "Chemical spraying as the first resort",
  ],
  with: [
    "A named disease, with a confidence score",
    "Solutions matched to that exact disease",
    "Natural and traditional options first",
    "Sources shown, and an expert prompt when unsure",
  ],
};

const STATS = [
  { value: 10, suffix: "", label: "diseases and crops recognised", decimals: 0 },
  { value: 3, suffix: "", label: "crops: tomato, potato, pepper", decimals: 0 },
  { value: 1.6, suffix: "s", label: "median diagnosis time", decimals: 1 },
  { value: 100, suffix: "%", label: "of results carry a confidence score", decimals: 0 },
];

const COMMUNITY_CARDS = [
  {
    icon: Users,
    title: "By crop and region",
    body: "Find farmers growing the same crop, dealing with the same season.",
  },
  {
    icon: MessageCircle,
    title: "Real threads",
    body: "Questions, answers and follow-ups — not a feed of announcements.",
  },
  {
    icon: Sprout,
    title: "Tied to your diagnosis",
    body: "Start a discussion straight from a diagnosis result, with the details attached.",
  },
];

const SAFETY_POINTS = [
  "Every prediction carries a confidence score",
  "Low confidence prompts expert confirmation",
  "Traditional practices are labelled as such",
  "Never claims certainty",
];

/* ---------------------------------------------------------------------------
   Page
   ------------------------------------------------------------------------- */

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col overflow-x-hidden">
      <SiteNav />

      <main className="flex flex-1 flex-col">
        {/* ================= Hero ================= */}
        <section className="relative isolate overflow-hidden px-5 pt-32 pb-20 sm:pt-40 sm:pb-28">
          <GlowOrbs variant="hero" />
          <GridBackdrop />

          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-7 text-center">
            <Reveal>
              <span className="glass text-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold sm:text-sm">
                <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                Grounded in trusted agricultural sources
              </span>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Know your crop.
                <br />
                <RotatingText phrases={HERO_ROTATION} />
                <br />
                <span className="text-gradient-animated">All in one place.</span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="text-muted mx-auto max-w-2xl text-base sm:text-lg">
                Agri AI combines photo-based disease detection, natural and traditional
                solutions from trusted agricultural sources, a plain-language farming
                assistant, and a community of farmers growing the same crop.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
                <Link
                  href="/signup"
                  className="bg-accent shadow-glow hover:bg-primary-dark min-h-tap inline-flex items-center justify-center gap-2 rounded-full px-7 font-semibold text-white transition-colors"
                >
                  Get started free
                  <ArrowRight className="size-4.5" aria-hidden="true" />
                </Link>
                <a
                  href="#how-it-works"
                  className="glass hover:bg-surface-3 min-h-tap inline-flex items-center justify-center gap-2 rounded-full px-7 font-semibold transition-colors"
                >
                  <Play className="size-4" aria-hidden="true" />
                  See how it works
                </a>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <p className="text-muted text-sm">
                No card needed · Works on any phone · Every result shows a confidence
                score
              </p>
            </Reveal>
          </div>

          {/* ---- Hero device ---- */}
          <Reveal
            id="showcase"
            delay={400}
            className="relative mx-auto mt-16 w-full max-w-4xl scroll-mt-24"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-10 top-10 bottom-0 rounded-[3rem] bg-[radial-gradient(ellipse_at_center,rgba(46,125,50,0.12),transparent_70%)] blur-3xl"
            />
            <Showcase />
          </Reveal>
        </section>

        {/* ================= What it recognises ================= */}
        <section className="border-border border-y py-8">
          <p className="text-muted mb-5 text-center text-xs font-semibold tracking-[0.18em] uppercase">
            Trained to recognise
          </p>
          <Marquee speed={42}>
            {RECOGNISES.map((label) => (
              <span
                key={label}
                className="text-muted mx-3 inline-flex items-center gap-2.5 text-sm font-medium whitespace-nowrap"
              >
                <span
                  className="bg-primary/40 size-1.5 rounded-full"
                  aria-hidden="true"
                />
                {label}
              </span>
            ))}
          </Marquee>
        </section>

        {/* ================= How it works ================= */}
        <section id="how-it-works" className="relative scroll-mt-24 px-5 py-24">
          <GlowOrbs variant="section" />

          <div className="relative mx-auto w-full max-w-6xl">
            <Reveal>
              <SectionHeading
                eyebrow="Your workflow"
                title="From a photo to a plan"
                description="Three steps. No jargon, no forms to fill in, nothing to install."
                align="center"
              />
            </Reveal>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal key={step.number} delay={index * 100}>
                  <SpotlightCard className="glass rim h-full rounded-3xl">
                    <div className="flex h-full flex-col gap-4 p-6">
                      <span className="font-display text-primary/70 text-4xl font-semibold">
                        {step.number}
                      </span>
                      <h3 className="font-display text-xl font-semibold">{step.title}</h3>
                      <p className="text-muted text-base">{step.body}</p>
                    </div>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= Features (bento) ================= */}
        <section id="features" className="scroll-mt-24 px-5 py-24">
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <SectionHeading
                eyebrow="What you get"
                title="Four things, working together"
                description="Detection and conversation are deliberately separate systems. The model never writes advice, and the assistant never guesses at a diagnosis."
              />
            </Reveal>

            <div className="mt-14 grid gap-5 sm:grid-cols-2">
              {FEATURES.map((feature, index) => (
                <Reveal key={feature.title} delay={index * 90}>
                  <SpotlightCard className="glass rim h-full rounded-3xl">
                    <div className="flex h-full flex-col gap-4 p-6">
                      <span
                        className={
                          feature.tone === "natural"
                            ? "bg-natural-bg text-natural-text flex size-12 items-center justify-center rounded-2xl"
                            : feature.tone === "traditional"
                              ? "bg-traditional-bg text-traditional-text flex size-12 items-center justify-center rounded-2xl"
                              : "bg-primary-soft text-primary flex size-12 items-center justify-center rounded-2xl"
                        }
                      >
                        <feature.icon className="size-6" aria-hidden="true" />
                      </span>
                      <h3 className="font-display text-xl font-semibold">
                        {feature.title}
                      </h3>
                      <p className="text-muted text-base">{feature.body}</p>
                    </div>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= Safety ================= */}
        <section id="safety" className="scroll-mt-24 px-5 py-16">
          <Reveal className="mx-auto w-full max-w-6xl">
            <div className="glass rim relative overflow-hidden rounded-3xl p-7 sm:p-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,rgba(46,125,50,0.10),transparent_68%)] blur-3xl"
              />
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex max-w-xl flex-col gap-4">
                  <Eyebrow variant="pill">
                    <ShieldCheck className="size-3.5" aria-hidden="true" />
                    Safety &amp; limits
                  </Eyebrow>
                  <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                    Honest about what it doesn&apos;t know
                  </h2>
                  <p className="text-muted text-base">
                    A confident wrong answer is worse than no answer. When the model
                    isn&apos;t sure, Agri AI says so and asks you to confirm with an
                    expert — it does not quietly round up.
                  </p>
                </div>

                <ul className="flex shrink-0 flex-col gap-3">
                  {SAFETY_POINTS.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className="text-primary mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ================= Solutions: comparison ================= */}
        <section id="solutions" className="relative scroll-mt-24 px-5 py-24">
          <GlowOrbs variant="soft" />

          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <div className="flex flex-col gap-6">
                <Eyebrow variant="pill">Before vs. after</Eyebrow>
                <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
                  Guessing vs. knowing
                </h2>

                {/* Without */}
                <div className="bg-danger-bg/40 border-danger-border/40 rounded-2xl border p-5">
                  <p className="text-danger mb-3 text-sm font-semibold">
                    Guessing from a photo
                  </p>
                  <ul className="flex flex-col gap-2.5">
                    {COMPARISON.without.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm">
                        <X
                          className="text-danger mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="text-muted">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* With */}
                <div className="bg-primary-soft/50 border-primary/25 rounded-2xl border p-5">
                  <p className="text-primary mb-3 text-sm font-semibold">With Agri AI</p>
                  <ul className="flex flex-col gap-2.5">
                    {COMPARISON.with.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm">
                        <Check
                          className="text-primary mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <FlowDiagram />
            </Reveal>
          </div>
        </section>

        {/* ================= Community ================= */}
        <section id="community" className="scroll-mt-24 px-5 py-24">
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <SectionHeading
                eyebrow="Farmer community"
                title="Someone nearby has grown this before"
                description="Share what worked. Read what didn't. Ask the farmers whose soil and weather look like yours."
                align="center"
              />
            </Reveal>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {COMMUNITY_CARDS.map((card, index) => (
                <Reveal key={card.title} delay={index * 90}>
                  <SpotlightCard className="glass rim h-full rounded-3xl">
                    <div className="flex h-full flex-col gap-4 p-6">
                      <span className="bg-primary-soft text-primary flex size-12 items-center justify-center rounded-2xl">
                        <card.icon className="size-6" aria-hidden="true" />
                      </span>
                      <h3 className="font-display text-lg font-semibold">{card.title}</h3>
                      <p className="text-muted text-base">{card.body}</p>
                    </div>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= Stats ================= */}
        <section id="stats" className="border-border scroll-mt-24 border-y px-5 py-16">
          <div className="mx-auto grid w-full max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((stat, index) => (
              <Reveal key={stat.label} delay={index * 80}>
                <div className="flex flex-col gap-1 text-center">
                  <span className="font-display text-gradient text-4xl font-semibold tracking-tight sm:text-5xl">
                    <Counter
                      value={stat.value}
                      suffix={stat.suffix}
                      decimals={stat.decimals}
                    />
                  </span>
                  <span className="text-muted text-sm">{stat.label}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= Final CTA ================= */}
        <section
          id="cta"
          className="relative isolate scroll-mt-24 overflow-hidden px-5 py-28"
        >
          <GlowOrbs variant="hero" className="opacity-70" />

          <Reveal className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center">
            <span className="glass text-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold">
              Free to start
            </span>
            <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
              Your next crop problem,
              <br />
              <span className="text-gradient">answered properly.</span>
            </h2>
            <p className="text-muted max-w-lg text-base sm:text-lg">
              Create an account and run your first diagnosis in under a minute.
            </p>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className="bg-accent shadow-glow-lg hover:bg-primary-dark min-h-tap inline-flex items-center justify-center gap-2 rounded-full px-8 font-semibold text-white transition-colors"
              >
                Get started free
                <ArrowRight className="size-4.5" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="glass hover:bg-surface-3 min-h-tap inline-flex items-center justify-center rounded-full px-8 font-semibold transition-colors"
              >
                Log in
              </Link>
            </div>
          </Reveal>
        </section>

        {/* Development-only connectivity panel — confirms the browser can reach
            the API and Supabase. Rendered in development builds only. */}
        {process.env.NODE_ENV === "development" && (
          <div className="px-5 pb-16">
            <SystemStatus />
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
