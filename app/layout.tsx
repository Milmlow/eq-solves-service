/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { RouteProgress } from "@/components/ui/RouteProgress";
import { ServiceWorkerRegistration } from "@/components/ui/ServiceWorkerRegistration";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted, preloaded, no off-origin round-trip before paint. Replaces
// the previous CSS @import which was render-blocking and shipped no
// optimisation (subset, preload, swap, self-host).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

// Publisher is the brand (EQ). Author is the legal entity (CDC Solutions Pty Ltd).
// This distinction is deliberate — it encodes the ASIC "registered business name"
// relationship in crawlable/discoverable metadata.
export const metadata: Metadata = {
  title: "EQ Service",
  description: "Maintenance management for electrical contractors.",
  applicationName: "EQ Service",
  authors: [{ name: "CDC Solutions Pty Ltd" }],
  publisher: "EQ",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EQ Service",
  },
  other: {
    copyright: "© 2026 EQ · CDC Solutions Pty Ltd",
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
        <meta name="theme-color" content="#3DA8D8" />
      </head>
      <body className="min-h-full">
        <Providers>
          {/* RouteProgress reads useSearchParams() — must live inside a Suspense
              boundary so statically-prerenderable pages (e.g. /acb-testing) don't
              bail out of static generation during the Next build. */}
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          {children}
        </Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
