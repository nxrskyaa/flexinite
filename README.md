# Flexinite

On-chain NFT performance scanner. Paste a wallet, a collection contract, or an
OpenSea link — Flexinite reads the chain directly and returns buys, mints, fees,
and realized profit.

## Features

- **Wallet scan** — full NFT PnL per token: mints, buys, sales, avg prices, gas, realized PnL
- **Collection scan** — holders, mint count/price, supply, transfers in window, plus your own position
- **Bot PNL** — side-by-side PnL for up to 50 wallets on one collection
- **OpenSea links** — paste collection / asset / profile URLs; Flexinite resolves them (no API key needed)
- **Multi-chain** — Ethereum, Base, Robinhood Chain, BNB, Abstract, ApeChain, Polygon, Arbitrum, Optimism + Solana (activity scan via public RPC)
- **PnL card export** — shareable PNG with custom accent/theme
- **Private** — everything computed server-side from public RPCs / Blockscout; nothing stored

## Stack

Next.js (App Router, TypeScript) · Blockscout v2 first, RPC fallback · deploys to Vercel.

## Local dev

```bash
pnpm install
pnpm dev
```

API:

```
GET /api/scan?wallet=0x…&chainId=1&window=30
GET /api/contract?contract=0x…&chainId=1&window=30&wallet=0x…
GET /api/bot?contract=0x…&wallets=0x…,0x…&chainId=1&window=30
GET /api/resolve?input=<opensea url>
GET /api/chains
```
