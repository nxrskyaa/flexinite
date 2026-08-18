export interface ChainInfo {
  chainId: number;
  name: string;
  shortName: string;
  symbol: string;
  rpcUrl: string;
  rpcUrls: string[]; // candidates, best first
  explorer: string;
  logo: string; // single char used as badge
  network: "evm" | "solana";
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

// ---------- curated featured networks (UI order) ----------

export interface FeaturedNetwork {
  chainId: number;
  label: string;
  badge: string; // short glyph/char
  network: "evm" | "solana";
  match?: string[]; // substrings to match in chainlist
  symbol?: string;
  explorer?: string;
  rpc?: string[];
}

export const FEATURED_NETWORKS: FeaturedNetwork[] = [
  { chainId: 1, label: "Ethereum", badge: "Ξ", network: "evm", match: ["ethereum mainnet"] },
  { chainId: 900, label: "Solana", badge: "S", network: "solana", symbol: "SOL", explorer: "https://solscan.io", rpc: ["https://api.mainnet-beta.solana.com"] },
  { chainId: 4663, label: "Robinhood", badge: "R", network: "evm", match: ["robinhood"] },
  { chainId: 8453, label: "Base", badge: "B", network: "evm", match: ["base"] },
  { chainId: 56, label: "BNB", badge: "◆", network: "evm", match: ["bnb smart chain", "binance smart chain"] },
  { chainId: 2741, label: "Abstract", badge: "A", network: "evm", match: ["abstract"] },
  { chainId: 33139, label: "ApeChain", badge: "🐵", network: "evm", match: ["apechain"] },
  { chainId: 137, label: "Polygon", badge: "P", network: "evm", match: ["polygon mainnet", "polygon pos"] },
  { chainId: 42161, label: "Arbitrum", badge: "A", network: "evm", match: ["arbitrum one"] },
  { chainId: 10, label: "Optimism", badge: "O", network: "evm", match: ["op mainnet", "optimism"] },
];

// ---------- chainlist loading ----------

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
      network: "evm",
    });
  }
  // virtual non-EVM networks
  out.push({
    chainId: 900,
    name: "Solana",
    shortName: "sol",
    symbol: "SOL",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rpcUrls: ["https://api.mainnet-beta.solana.com"],
    explorer: "https://solscan.io",
    logo: "S",
    network: "solana",
  });
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
