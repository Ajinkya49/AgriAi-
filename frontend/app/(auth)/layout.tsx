import { Leaf } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { GlowOrbs } from "@/components/ui/glow-orbs";

/**
 * Shell for the sign-up / log-in screens.
 *
 * Centred on the dark canvas with the same violet bloom used on the landing
 * page, so the transition from marketing to auth feels continuous rather than
 * like a different product.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden px-5 py-14">
      <GlowOrbs variant="hero" className="opacity-80" />

      <div className="relative flex w-full max-w-md flex-col gap-7">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <span className="from-primary-dark to-primary shadow-glow flex size-10 items-center justify-center rounded-xl bg-gradient-to-br">
            <Leaf className="size-5 text-white" aria-hidden="true" />
          </span>
          <span className="font-display text-2xl font-semibold tracking-tight">
            Agri<span className="text-primary"> AI</span>
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}
