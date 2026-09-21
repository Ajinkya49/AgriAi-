"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { signInAction, signUpAction, type AuthState } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const INITIAL_STATE: AuthState = {};

type Mode = "login" | "signup";

/**
 * Shared email + password form for /login and /signup.
 *
 * Submits to a server action so the Supabase session cookies are set server-side
 * by `@supabase/ssr`.
 */
export function AuthForm({
  mode,
  redirectTo,
  initialError,
}: {
  mode: Mode;
  redirectTo?: string;
  initialError?: string;
}) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(
    action,
    initialError ? { error: initialError } : INITIAL_STATE,
  );

  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const isSignUp = mode === "signup";

  // With email confirmation switched on, a successful sign-up returns a notice
  // instead of a session. Swap the form for a confirmation panel.
  if (state.notice) {
    return (
      <div className="rounded-card glass shadow-card flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className="text-primary mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Confirm your email</h2>
            <p className="text-muted text-base">{state.notice}</p>
          </div>
        </div>
        <Link
          href="/login"
          className="min-h-tap rounded-card border-border inline-flex items-center justify-center border px-5 font-semibold"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-card glass shadow-card flex flex-col gap-5 p-6"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {isSignUp ? "Create your account" : "Log in"}
        </h1>
        <p className="text-muted text-base">
          {isSignUp
            ? "It only takes a minute. You can skip the next step if you like."
            : "Welcome back."}
        </p>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}

      {isSignUp && (
        <Field id={nameId} label="Your name" hint="How other farmers will see you">
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            required
            className={inputClass}
            placeholder="e.g. Ramesh Patil"
          />
        </Field>
      )}

      <Field id={emailId} label="Email">
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className={inputClass}
          placeholder="you@example.com"
        />
      </Field>

      <Field
        id={passwordId}
        label="Password"
        hint={isSignUp ? "At least 8 characters" : undefined}
      >
        <PasswordInput
          id={passwordId}
          autoComplete={isSignUp ? "new-password" : "current-password"}
        />
      </Field>

      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "min-h-tap rounded-card bg-accent shadow-glow inline-flex items-center justify-center gap-2 px-6",
          "font-semibold text-white transition-opacity",
          pending ? "opacity-70" : "hover:bg-primary-dark",
        )}
      >
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {pending ? "Please wait…" : isSignUp ? "Create account" : "Log in"}
      </button>

      <p className="text-muted text-center text-base">
        {isSignUp ? "Already have an account? " : "New to Agri AI? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="text-primary font-semibold underline underline-offset-2"
        >
          {isSignUp ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}

// Styling lives in globals.css (.input) so every form shares one definition.
const inputClass = "input";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-muted text-sm">{hint}</p>}
    </div>
  );
}

function PasswordInput({ id, autoComplete }: { id: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name="password"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={8}
        className={cn(inputClass, "pr-14")}
        placeholder="••••••••"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="text-muted min-h-tap absolute inset-y-0 right-0 flex w-12 items-center justify-center"
      >
        {visible ? (
          <EyeOff className="size-5" aria-hidden="true" />
        ) : (
          <Eye className="size-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
