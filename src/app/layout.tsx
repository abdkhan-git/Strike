import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";
import { themeScript } from "@/components/ThemeToggle";
import "./globals.css";

const sans = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Strike", template: "%s · Strike" },
  description: "Options flow scanner, daily picks sized to your goal, and a trade log with live calls",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* applies the saved light/dark choice before first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
