import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

/**
 * Inter is the UI/body font specified in the UI/UX Design Brief. It is loaded
 * as a variable font so headings can use heavier weights without extra requests.
 * "Noto Sans" (which has strong Devanagari coverage) is the declared fallback in
 * globals.css, ready for the v2 Hindi/Marathi localization work.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Sora is the display face for marketing headings, matching the geometric
 * grotesk in the reference recording. Body copy stays on Inter — Sora is only
 * used at large sizes, where its tighter, rounder forms read better.
 */
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agri AI — Detect crop diseases, find trusted solutions",
  description:
    "An AI-powered platform where farmers detect crop diseases, discover natural and traditional solutions, get evidence-based farming guidance, and learn from a community of other farmers.",
  applicationName: "Agri AI",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mobile-first: the app is designed for phone screens held one-handed.
  maximumScale: 5,
  // The off-white canvas, so the mobile browser chrome blends with the page
  // instead of flashing a band of colour above it.
  themeColor: "#FAFAF5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} h-full antialiased`}>
      <body className="bg-surface text-ink flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
