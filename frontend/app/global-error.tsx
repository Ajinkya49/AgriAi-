"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary.
 *
 * Replaces the root layout when even that fails to render, so it cannot rely on
 * the app's Tailwind theme or fonts — everything here is inline. That is
 * deliberate: a broken theme must not produce a broken error screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
          padding: "24px",
          background: "#FAFAF7",
          color: "#1B1B1B",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>
          Agri AI couldn&apos;t start
        </h1>
        <p style={{ fontSize: "16px", color: "#6B6B66", maxWidth: "32rem", margin: 0 }}>
          Something went wrong loading the app. Your saved records are not affected.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: "44px",
            padding: "0 24px",
            borderRadius: "12px",
            border: "none",
            background: "#F9A825",
            color: "#1B1B1B",
            fontSize: "16px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
