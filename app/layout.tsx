import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrowTop — Top Up Growtopia Private Server",
  description: "Top up Growtopia Private Server dengan alur pesanan yang jelas dan pelacakan status.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" /></head><body>{children}</body></html>;
}
