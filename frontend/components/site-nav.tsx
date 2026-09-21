"use client";

import { Leaf, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Public marketing navigation.
 *
 * Mirrors the reference: a full-width bar at rest that contracts into a
 * floating, bordered, blurred pill once the page is scrolled. The transition is
 * what gives the header its "lift off the page" feel.
 *
 * The wordmark is split into ink + violet, as in the reference's "SalesHookAI".
 *
 * On mobile the links collapse behind a menu button — the audience is
 * phone-first, and five inline links do not fit beside a CTA.
 */

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#solutions", label: "Solutions" },
  { href: "#community", label: "Community" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the sheet when the viewport grows past the mobile breakpoint,
  // otherwise it stays open and invisible behind the desktop layout.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(min-width: 768px)");
    const close = () => query.matches && setOpen(false);
    query.addEventListener("change", close);
    return () => query.removeEventListener("change", close);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Main"
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-4 rounded-full transition-all duration-500",
          scrolled
            ? "glass-strong px-4 py-2.5 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)] sm:px-5"
            : "border border-transparent px-3 py-3 sm:px-4",
        )}
      >
        <Link
          href="/"
          className="min-h-tap flex shrink-0 items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <span className="from-primary-dark to-primary shadow-glow flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br">
            <Leaf className="size-4.5 text-white" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            Agri<span className="text-primary"> AI</span>
          </span>
        </Link>

        {/* ---- Desktop links ---- */}
        <ul className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-muted hover:text-ink hover:bg-surface-3 min-h-tap min-w-tap inline-flex items-center rounded-full px-3.5 text-sm font-medium transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* ---- Desktop actions ---- */}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="text-muted hover:text-ink min-h-tap min-w-tap inline-flex items-center rounded-full px-3.5 text-sm font-medium transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="bg-accent min-h-tap shadow-glow hover:bg-primary-dark inline-flex items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white transition-colors"
          >
            Get started
          </Link>
        </div>

        {/* ---- Mobile toggle ---- */}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="glass ml-auto flex size-12 items-center justify-center rounded-full md:hidden"
        >
          {open ? (
            <X className="size-5" aria-hidden="true" />
          ) : (
            <Menu className="size-5" aria-hidden="true" />
          )}
        </button>
      </nav>

      {/* ---- Mobile sheet ---- */}
      {open && (
        <div
          id="site-menu"
          className="glass-strong animate-fade-up mx-auto mt-2 flex max-w-6xl flex-col gap-1 rounded-3xl p-3 md:hidden"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="hover:bg-surface-3 min-h-tap flex items-center rounded-2xl px-4 font-medium transition-colors"
            >
              {link.label}
            </a>
          ))}
          <div className="border-border mt-1 flex flex-col gap-2 border-t pt-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="glass min-h-tap flex items-center justify-center rounded-2xl font-semibold"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className="bg-accent min-h-tap flex items-center justify-center rounded-2xl font-semibold text-white"
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
