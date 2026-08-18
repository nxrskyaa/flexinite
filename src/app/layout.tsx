import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const logo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23f5b13d'/%3E%3Cpath d='M17.8 4L7.5 18.2h6.2L12 28l10.5-14.2h-6.2z' fill='%23141003'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "Flexinite — on-chain NFT performance",
  description:
    "Paste a wallet, collection address or OpenSea link. Real-time NFT PnL, mints, sales and holder stats across Ethereum, Solana, Robinhood Chain, Base, BNB and more.",
  icons: { icon: [{ url: logo, type: "image/svg+xml" }] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
