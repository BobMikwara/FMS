import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ToastProvider } from "@/components/ui/feedback";
import { startSimulator } from "@/server/integrations/simulator";

export const metadata: Metadata = {
  title: {
    default: "SmartFuel — Fuel Monitoring & Station Management",
    template: "%s · SmartFuel",
  },
  description:
    "Real-time fuel tank monitoring, refill and consumption detection, anomaly alerts, GPS fleet tracking and reporting for fuel station networks.",
  applicationName: "SmartFuel",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SmartFuel",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#080b11" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Boot the synthetic probe simulator once per server process (demo mode only).
if (typeof window === "undefined") {
  try {
    startSimulator();
  } catch {
    /* simulator is optional */
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
