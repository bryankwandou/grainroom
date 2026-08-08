import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans-stack",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-stack",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://grainroom.vercel.app"),
  title: {
    default: "Grainroom — a darkroom that runs in your browser",
    template: "%s · Grainroom",
  },
  description:
    "A full photo editor that runs entirely on your own machine. No upload, no watermark, no account. Every edit is a Look you can hand to someone else, with the credit attached.",
  keywords: [
    "photo editor",
    "browser photo editor",
    "offline photo editing",
    "film grain",
    "colour grading",
    "presets",
    "WebGL",
  ],
  authors: [{ name: "Bryan Kwandou" }],
  openGraph: {
    title: "Grainroom — a darkroom that runs in your browser",
    description:
      "Edit photos on your own device. Nothing uploads. Every edit is a Look you can share, fork, and get credited for.",
    type: "website",
    siteName: "Grainroom",
  },
  twitter: {
    card: "summary_large_image",
    title: "Grainroom",
    description: "A darkroom that runs in your browser. Nothing uploads.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  width: "device-width",
  initialScale: 1,
  // The editor puts controls near the edges; letting the page zoom on a
  // double-tap would fight the drag gestures on the canvas.
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
