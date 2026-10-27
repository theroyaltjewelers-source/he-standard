import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "The Standard", template: "%s · The Standard" },
  description: "A private accountability system for closing the gap between intention and action.",
  applicationName: "The Standard",
  appleWebApp: { capable: true, title: "The Standard", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#161719" },
    { media: "(prefers-color-scheme: light)", color: "#efede7" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = jar.get("theme")?.value;
  const haptics = jar.get("haptics")?.value === "off" ? "off" : "on";
  const t = theme === "light" || theme === "system" ? theme : "dark";
  return (
    <html lang="en" data-theme={t} data-haptics={haptics}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
