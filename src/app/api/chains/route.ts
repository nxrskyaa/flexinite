import { NextRequest } from "next/server";
import { getAllChains, FEATURED_NETWORKS, type ChainInfo } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Out extends ChainInfo {
  label: string;
}

let memo: Out[] | null = null;

async function buildFeatured(): Promise<Out[]> {
  const all = await getAllChains();
  const out: Out[] = [];
  for (const f of FEATURED_NETWORKS) {
    if (f.network === "solana") {
      out.push({
        chainId: f.chainId,
        name: f.label,
        shortName: f.label.toLowerCase(),
        symbol: f.symbol || "SOL",
        rpcUrl: f.rpc?.[0] || "",
        rpcUrls: f.rpc || [],
        explorer: f.explorer || "",
        logo: f.badge,
        network: "solana",
        label: f.label,
      });
      continue;
    }
    const hit = all.find((c) =>
      f.match?.some((m) => c.name.toLowerCase().includes(m))
    );
    if (hit) out.push({ ...hit, label: f.label, logo: f.badge });
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
