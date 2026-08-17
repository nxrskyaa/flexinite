import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "PandaPnL — Real-time on-chain NFT PnL",
  description:
    "Paste any wallet. See exactly where you stand — buys, mints, fees, and realized profit. Free on-chain NFT PnL scanner for Ethereum, Base, Abstract, ApeChain and more.",
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐼</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <div className="stars" />
        <div className="nebula a" />
        <div className="nebula b" />
        {children}
      </body>
    </html>
  );
}
