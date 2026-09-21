import type { LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * Placeholder for a route whose feature belongs to a later build phase.
 *
 * Kept deliberately plain: it exists so the navigation and the protected-route
 * behaviour are real, not so that it looks finished.
 */
export function ComingSoon({
  icon: Icon,
  title,
  phase,
  description,
}: {
  icon: LucideIcon;
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>

      <div className="rounded-card glass shadow-card flex flex-col items-start gap-4 p-5">
        <div className="flex items-start gap-3">
          <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <span className="bg-primary-soft text-primary w-fit rounded-full px-3 py-0.5 text-sm font-semibold">
              Coming in Phase {phase}
            </span>
            <p className="text-muted text-base">{description}</p>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="min-h-tap rounded-card border-border inline-flex items-center justify-center border px-5 font-semibold"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
