"use client";

import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Empty and error states.
 *
 * The design brief requires every screen to have a defined state for empty,
 * loading and error. Both components here pair an icon with text — never colour
 * or imagery alone — because colour perception and literacy vary, and an empty
 * state that is only a picture tells a farmer nothing.
 *
 * Every empty state also offers a way forward. "Nothing here" without an action
 * is a dead end.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "glass rounded-card flex flex-col items-center gap-4 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="bg-primary-soft ring-primary/20 flex size-14 items-center justify-center rounded-full ring-1">
        <Icon className="text-primary size-7" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-muted max-w-sm text-base">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** An inline error with a retry affordance. */
export function ErrorState({
  title = "Something went wrong",
  description = "Please check your connection and try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn(
        "rounded-card border-danger-border/60 bg-danger-bg/60 flex flex-col items-center gap-4 border px-6 py-10 text-center",
        className,
      )}
    >
      <span className="bg-danger-bg flex size-14 items-center justify-center rounded-full">
        <AlertCircle className="text-danger size-7" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-danger text-lg font-semibold">{title}</h2>
        <p className="text-danger/85 max-w-sm text-base">{description}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="bg-accent min-h-tap rounded-card flex items-center gap-2 px-6 font-semibold text-white"
        >
          <RefreshCw className="size-5" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}
