import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Create your account — Agri AI",
};

export default function SignUpPage() {
  return <AuthForm mode="signup" />;
}
