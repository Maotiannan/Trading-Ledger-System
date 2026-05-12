import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from 'next-intl';
import { cookies } from 'next/headers';
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { defaultLocale, getLocaleMessages, isSupportedLocale } from '@/lib/i18n';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "muledger",
  description: "muledger for receipts, invoices, payment details, and SWIFT workflows.",
  keywords: ["muledger", "Ledger", "Finance", "Receipts", "SWIFT"],
  authors: [{ name: "muledger" }],
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "muledger",
    description: "Ledger operations for trading workflows",
    url: "https://muledger.dainty.vip",
    siteName: "muledger",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "muledger",
    description: "Ledger operations for trading workflows",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = isSupportedLocale(localeCookie) ? localeCookie : defaultLocale;
  const messages = await getLocaleMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
