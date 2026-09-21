import {
  Camera,
  LayoutDashboard,
  Leaf,
  MessageCircle,
  Sprout,
  UserRound,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A faithful, code-drawn mockup of the Agri AI app.
 *
 * Drawn in HTML/CSS rather than shipped as a screenshot image so it stays sharp
 * at any density, themes correctly, costs no bandwidth, and cannot drift out of
 * date without the build noticing — it imports the same icons and colours the
 * real screens use.
 *
 * The whole thing is `aria-hidden`: it duplicates content that is described in
 * the surrounding copy, and announcing a fake dashboard would only confuse a
 * screen reader user. The real, interactive app is one click away.
 */

const SIDEBAR = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: MessageCircle, label: "Assistant" },
  { icon: Camera, label: "Upload" },
  { icon: Users, label: "Community" },
  { icon: UserRound, label: "Profile" },
];

function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-strong rim overflow-hidden rounded-2xl shadow-[0_24px_60px_-24px_rgba(27,27,27,0.22)]">
      {/* Window bar */}
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <div className="bg-surface-3 text-muted mx-auto hidden rounded-md px-3 py-1 text-[11px] sm:block">
          app.agri-ai.in
        </div>
      </div>
      <div className="flex">{children}</div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="border-border hidden w-44 shrink-0 flex-col gap-1 border-r p-3 sm:flex">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="from-primary-dark to-primary flex size-6 items-center justify-center rounded-lg bg-gradient-to-br">
          <Leaf className="size-3.5 text-white" />
        </span>
        <span className="text-sm font-semibold tracking-tight">
          Agri<span className="text-primary"> AI</span>
        </span>
      </div>
      {SIDEBAR.map(({ icon: Icon, label, active }) => (
        <div
          key={label}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium",
            active ? "bg-primary-soft text-primary" : "text-muted",
          )}
        >
          <Icon className="size-3.5 shrink-0" />
          {label}
        </div>
      ))}
    </aside>
  );
}

/* -------------------------------------------------------------------------
   Views
   ------------------------------------------------------------------------- */

const DIAGNOSES = [
  {
    disease: "Tomato - Late Blight",
    crop: "Tomato",
    confidence: 0.92,
    band: "bg-confidence-high",
    date: "12 Sep",
  },
  {
    disease: "Potato - Early Blight",
    crop: "Potato",
    confidence: 0.74,
    band: "bg-confidence-medium",
    date: "09 Sep",
  },
  {
    disease: "Tomato - Leaf Mold",
    crop: "Tomato",
    confidence: 0.61,
    band: "bg-confidence-medium",
    date: "04 Sep",
  },
];

function DashboardView() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <p className="font-display text-lg font-semibold tracking-tight">Hello, Ravi</p>
        <p className="text-muted text-[12px]">Nashik, Maharashtra · Tomato, Onion</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-semibold">Your recent diagnoses</p>
        {DIAGNOSES.map((row) => (
          <div
            key={row.disease}
            className="border-border bg-surface-2 flex flex-col gap-2 rounded-xl border p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold">{row.disease}</span>
              <span className="text-muted shrink-0 text-[11px]">{row.date}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-border h-1.5 w-20 overflow-hidden rounded-full">
                <div
                  className={cn("h-full rounded-full", row.band)}
                  style={{ width: `${row.confidence * 100}%` }}
                />
              </div>
              <span className="text-muted text-[11px]">
                {Math.round(row.confidence * 100)}% confidence
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Sprout, label: "Check a crop" },
          { icon: MessageCircle, label: "Ask AI" },
          { icon: Users, label: "Community" },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="border-border bg-surface-2 flex flex-col gap-1.5 rounded-xl border p-2.5"
          >
            <Icon className="text-primary size-3.5" />
            <span className="text-[11px] font-medium">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosisView() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
      <div className="border-border bg-surface-2 flex items-center gap-3 rounded-xl border p-3">
        {/* Stand-in for the uploaded leaf photo. */}
        <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-[linear-gradient(135deg,#1c3b24,#2f6b3d_45%,#16301d)]">
          <div className="h-full w-full bg-[radial-gradient(circle_at_35%_30%,rgba(126,217,87,0.5),transparent_60%)]" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted text-[11px]">Detected</span>
          <span className="font-display text-sm font-semibold">Tomato - Late Blight</span>
          <div className="flex items-center gap-1.5">
            <span className="bg-confidence-high size-1.5 rounded-full" />
            <span className="text-confidence-high text-[11px] font-medium">
              92% confidence
            </span>
          </div>
        </div>
      </div>

      <div className="bg-confidence-high/10 border-confidence-high/25 text-confidence-high rounded-xl border p-2.5 text-[11px]">
        High confidence — the model is reliable here.
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <span className="bg-natural-text rounded-full px-3 py-1 text-[11px] font-semibold text-white">
            Natural
          </span>
          <span className="glass text-muted rounded-full px-3 py-1 text-[11px] font-medium">
            Traditional
          </span>
        </div>
        {["Remove and destroy infected leaves", "Improve air flow between plants"].map(
          (item) => (
            <div
              key={item}
              className="bg-natural-bg/60 border-natural-border/40 rounded-xl border p-2.5"
            >
              <p className="text-[11px] font-medium">{item}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function AssistantView() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
      <p className="text-muted text-[11px] font-semibold">
        Asking about: Tomato - Late Blight
      </p>

      <div className="flex justify-end">
        <p className="bg-accent max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-[11px] text-white">
          What should I do about it?
        </p>
      </div>

      <div className="flex items-start gap-2">
        <span className="bg-primary-soft mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
          <Leaf className="text-primary size-3" />
        </span>
        <div className="glass flex flex-col gap-2 rounded-2xl rounded-tl-sm px-3 py-2">
          <p className="text-[11px] leading-relaxed">
            Late blight spreads fast in cool, wet weather. Remove and destroy the affected
            leaves first, then improve airflow.
          </p>
          <div className="border-border flex flex-wrap gap-1.5 border-t pt-2">
            <span className="text-muted text-[10px]">Sources</span>
            <span className="bg-surface-3 rounded px-1.5 py-0.5 text-[10px]">
              ICAR extension note
            </span>
            <span className="bg-surface-3 rounded px-1.5 py-0.5 text-[10px]">
              KVK advisory
            </span>
          </div>
        </div>
      </div>

      <div className="glass mt-auto flex items-center gap-2 rounded-full px-3 py-2">
        <span className="text-muted flex-1 text-[11px]">Ask a question…</span>
        <span className="bg-accent flex size-6 items-center justify-center rounded-full">
          <MessageCircle className="size-3 text-white" />
        </span>
      </div>
    </div>
  );
}

const VIEWS = {
  dashboard: DashboardView,
  diagnosis: DiagnosisView,
  assistant: AssistantView,
} as const;

export type MockupView = keyof typeof VIEWS;

export function AppMockup({
  view = "dashboard",
  className,
}: {
  view?: MockupView;
  className?: string;
}) {
  const View = VIEWS[view];

  return (
    <div aria-hidden="true" className={cn("select-none", className)}>
      <Chrome>
        <Sidebar />
        <View />
      </Chrome>
    </div>
  );
}
