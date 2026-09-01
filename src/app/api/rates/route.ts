import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED = new Set(["ETH", "BNB", "SOL", "POL", "MATIC", "AVAX"]);
const cache = new Map<string, { at: number; usd: number; idr: number }>();
const TTL_MS = 5 * 60_000;

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "ETH").toUpperCase();
  if (!SUPPORTED.has(symbol)) return Response.json({ usd: null, idr: null, symbol });

  const coinbaseSymbol = symbol === "POL" ? "MATIC" : symbol;
  const cached = cache.get(coinbaseSymbol);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Response.json({ symbol, usd: cached.usd, idr: cached.idr }, { headers: { "X-Flexinite-Cache": "HIT" } });
  }

  try {
    const response = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(coinbaseSymbol)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Coinbase HTTP ${response.status}`);
    const json = await response.json();
    const usd = Number(json?.data?.rates?.USD);
    const idr = Number(json?.data?.rates?.IDR);
    if (!Number.isFinite(usd) || !Number.isFinite(idr)) throw new Error("Rates unavailable");
    cache.set(coinbaseSymbol, { at: Date.now(), usd, idr });
    return Response.json({ symbol, usd, idr }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900", "X-Flexinite-Cache": "MISS" } });
  } catch {
    return Response.json({ symbol, usd: null, idr: null });
  }
}
