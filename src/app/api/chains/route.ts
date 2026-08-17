import { NextRequest } from "next/server";
import { getAllChains, type ChainInfo } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// featured chains shown in the UI (name substrings matched against chainlist)
const FEATURED = [
  { match: ["ethereum mainnet"], label: "Ethereum", logo: "Ξ" },
  { match: ["base"], label: "Base", logo: "B" },
  { match: ["abstract"], label: "Abstract", logo: "A" },
  { match: ["apechain"], label: "ApeChain", logo: "🐵" },
  { match: ["robinhood"], label: "Robinhood", logo: "R" },
  { match: ["bnb smart chain", "binance smart chain"], label: "BNB", logo: "◆" },
  { match: ["polygon mainnet", "polygon pos"], label: "Polygon", logo: "P" },
  { match: ["arbitrum one"], label: "Arbitrum", logo: "A" },
  { match: ["op mainnet", "optimism"], label: "Optimism", logo: "O" },
];

interface Out extends ChainInfo {
  label: string;
}

let memo: Out[] | null = null;

async function buildFeatured(): Promise<Out[]> {
  const all = await getAllChains();
  const out: Out[] = [];
  for (const f of FEATURED) {
    const hit = all.find((c) =>
      f.match.some((m) => c.name.toLowerCase().includes(m))
    );
    if (hit) out.push({ ...hit, label: f.label, logo: f.logo });
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    if (!memo) memo = await buildFeatured();
    const all = req.nextUrl.searchParams.get("all") === "1";
    if (all) {
      const chains = await getAllChains();
      return Response.json({
        chains: chains.map((c) => ({
          chainId: c.chainId,
          name: c.name,
          symbol: c.symbol,
          explorer: c.explorer,
          logo: c.logo,
        })),
      });
    }
    return Response.json({ chains: memo });
  } catch (e) {
    return Response.json(
      { error: "Failed to load chains", detail: String(e) },
      { status: 500 }
    );
  }
}
