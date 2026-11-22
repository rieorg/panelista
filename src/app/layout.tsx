import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { Header, Footer } from "@/components/chrome";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
// Step numbers and counters (font-mono). Not preloaded: only pages that show one fetch it.
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"], preload: false });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://panelista.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Panelista: Find IT professionals to evaluate your capstone", template: "%s | Panelista" },
  description:
    "Find IT professionals to evaluate your capstone. Free for Philippine capstone students, with ratings, Verified badges and in-app chat.",
  openGraph: { siteName: "Panelista", type: "website", locale: "en_PH" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#176B55" };

// No per-request work here: pages prerender and serve from the CDN (CSP is a static header in next.config.ts).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // translate="no": Chrome offers to translate "fil" pages, and its DOM rewrites crash
    // React on the next update. The app has its own English toggle.
    <html lang="fil" translate="no" className={`${jakarta.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AppProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
