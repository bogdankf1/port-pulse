import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { AuthButton } from "@/components/AuthButton";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Port Pulse",
  description:
    "Live tracker for your investment portfolio — upload a screenshot, watch the prices.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#0a0e1a] text-slate-100">
        <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
          <AuthButton />
        </div>
        {children}
      </body>
    </html>
  );
}
