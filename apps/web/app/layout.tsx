import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flatiron Rental Radar",
  description: "Affitti attorno a Flatiron, clusterizzati per tempo reale di arrivo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
