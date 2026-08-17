export interface ChainInfo {
  chainId: number;
  name: string;
  shortName: string;
  symbol: string;
  rpcUrl: string;
  rpcUrls: string[]; // candidates, best first
  explorer: string;
  logo: string; // single char used as badge
}

interface ChainlistEntry {
  name: string;
  chain: string;
  chainId: number;
  shortName?: string;
  nativeCurrency?: { symbol: string; name: string };
  rpc?: Array<string | { url: string; tracking?: string }>;
  explorers?: { url: string }[];
}

let cache: ChainInfo[] | null = null;

function pickRpcs(
  rpcs: Array<string | { url: string; tracking?: string }> | undefined,
  max = 4
): string[] {
  if (!rpcs || rpcs.length === 0) return [];
  const urls = rpcs.map((r) =>
    typeof r === "string" ? { url: r, tracking: "unknown" } : r
  );
  const valid = urls.filter(
    (u) =>
      u.url.startsWith("https://") &&
      !u.url.includes("${") &&
      !u.url.includes("localhost")
  );
  // prefer non-tracking public RPCs
  const ranked = [
    ...valid.filter((u) => u.tracking === "none"),
    ...valid.filter((u) => u.tracking !== "none"),
  ];
  return ranked.slice(0, max).map((u) => u.url);
}

async function fetchAllChains(): Promise<ChainInfo[]> {
  let list: ChainlistEntry[] = [];
  for (const url of [
    "https://chainlist.org/rpcs.json",
    "https://chainlist.org/chains.json",
  ]) {
    try {
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) continue;
      const j = await res.json();
      list = Array.isArray(j) ? j : j.chains || [];
      if (list.length > 0) break;
    } catch {
      /* try next source */
    }
  }
  if (list.length === 0) throw new Error("chainlist fetch failed");
  const out: ChainInfo[] = [];
  for (const c of list) {
    const rpcs = pickRpcs(c.rpc);
    if (rpcs.length === 0) continue;
    out.push({
      chainId: c.chainId,
      name: c.name,
      shortName: c.shortName || c.name,
      symbol: c.nativeCurrency?.symbol || "ETH",
      rpcUrl: rpcs[0],
      rpcUrls: rpcs,
      explorer: c.explorers?.[0]?.url || "",
      logo: (c.shortName || c.name || "?").trim().charAt(0).toUpperCase(),
    });
  }
  return out;
}

export async function getAllChains(): Promise<ChainInfo[]> {
  if (!cache) {
    cache = await fetchAllChains();
  }
  return cache;
}

export async function getChain(chainId: number): Promise<ChainInfo> {
  const chains = await getAllChains();
  const c = chains.find((x) => x.chainId === chainId);
  if (!c) throw new Error(`Unknown chainId ${chainId}`);
  return c;
}
