import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "代号：黑暗森林",
  description: "多人策略卡牌游戏。宇宙就是一座黑暗森林，每个文明都是带枪的猎人。",
  keywords: ["黑暗森林", "三体", "策略卡牌", "多人游戏", "Next.js", "TypeScript", "React"],
  authors: [{ name: "Dark Forest Team" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "黑暗森林",
    description: "多人策略卡牌游戏",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "黑暗森林",
    description: "多人策略卡牌游戏",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
