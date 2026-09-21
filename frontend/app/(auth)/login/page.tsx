import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Log in — Agri AI",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const { redirect, error } = await searchParams;

  // Preserved by proxy.ts when an unauthenticated user hits a protected route.
  const redirectTo =
    typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
      ? redirect
      : undefined;

  return (
    <AuthForm
      mode="login"
      redirectTo={redirectTo}
      initialError={typeof error === "string" && error ? error : undefined}
    />
  );
}
