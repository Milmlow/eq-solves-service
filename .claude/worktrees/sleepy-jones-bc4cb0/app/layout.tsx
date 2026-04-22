/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import type { Metadata } from "next";
import { EqAttribution } from "@/components/ui/EqAttribution";
import { Providers } from "./providers";
import "./globals.css";

// Publisher is the brand (EQ). Author is the legal entity (CDC Solutions Pty Ltd).
// This distinction is deliberate — it encodes the ASIC "registered business name"
// relationship in crawlable/discoverable metadata.
export const metadata: Metadata = {
  title: "EQ Solves Service",
  description: "EQ Solves Service — proprietary maintenance management platform for electrical contractors.",
  applicationName: "EQ Solves Service",
  authors: [{ name: "CDC Solutions Pty Ltd" }],
  publisher: "EQ",
  other: {
    copyright: "© 2026 EQ · CDC Solutions Pty Ltd",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>
          {children}
          <EqAttribution />
        </Providers>
      </body>
    </html>
  );
}
