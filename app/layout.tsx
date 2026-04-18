import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EQ Solves Service",
  description: "White-label service operations platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
