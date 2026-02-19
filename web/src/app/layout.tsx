import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BottomNav } from "@/components/layout/BottomNav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI Voice Recorder - リアルタイム文字起こし＆翻訳",
    template: "%s | AI Voice Recorder",
  },
  description:
    "音声を録音して、リアルタイムで文字起こしと多言語翻訳。Azure AI技術を活用した高精度な音声認識で、議事録作成も自動化。",
  keywords: [
    "音声録音",
    "文字起こし",
    "翻訳",
    "AI",
    "Azure",
    "議事録",
    "リアルタイム",
  ],
  authors: [{ name: "AI Voice Recorder Team" }],
  creator: "AI Voice Recorder",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AI Recorder",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "https://airecorder.azurestaticapps.net",
    siteName: "AI Voice Recorder",
    title: "AI Voice Recorder - リアルタイム文字起こし＆翻訳",
    description:
      "音声を録音して、リアルタイムで文字起こしと多言語翻訳。Azure AI技術を活用した高精度な音声認識。",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Voice Recorder - リアルタイム文字起こし＆翻訳",
    description:
      "音声を録音して、リアルタイムで文字起こしと多言語翻訳。Azure AI技術を活用。",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.svg" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="min-h-0 flex-1 overflow-hidden pb-[calc(49px+env(safe-area-inset-bottom))] md:pb-0">
              {children}
            </main>
            <div className="hidden md:block">
              <Footer />
            </div>
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
