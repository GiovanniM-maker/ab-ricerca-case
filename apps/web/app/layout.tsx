import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flatiron Radar",
  description: "Affitti attorno a Flatiron, clusterizzati per tempo reale di arrivo",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body className="bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
