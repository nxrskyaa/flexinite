// OpenSea link resolution — no API key required for collection lookups
// Supports:
//   opensea.io/collection/<slug>
//   opensea.io/assets/<chain>/<contract>/<tokenId>
//   opensea.io/<wallet>  (profile)
//   testnets.opensea.io variants

export interface ResolvedLink {
  kind: "collection" | "asset" | "wallet" | "unknown";
  slug?: string;
  name?: string;
  imageUrl?: string;
  contract?: string;
  tokenId?: string;
  wallet?: string;
  chainId?: number;
  chainName?: string;
  contracts?: { address: string; chainId: number; chainName: string }[];
}

const CHAIN_MAP: Record<string, { chainId: number; label: string }> = {
  ethereum: { chainId: 1, label: "Ethereum" },
  base: { chainId: 8453, label: "Base" },
  polygon: { chainId: 137, label: "Polygon" },
  matic: { chainId: 137, label: "Polygon" },
  arbitrum: { chainId: 42161, label: "Arbitrum" },
  optimism: { chainId: 10, label: "Optimism" },
  bnb: { chainId: 56, label: "BNB" },
  binancesmartchain: { chainId: 56, label: "BNB" },
  bnbsmartchain: { chainId: 56, label: "BNB" },
  abstract: { chainId: 2741, label: "Abstract" },
  apechain: { chainId: 33139, label: "ApeChain" },
  robinhood: { chainId: 4663, label: "Robinhood" },
  robinhoodchain: { chainId: 4663, label: "Robinhood" },
  solana: { chainId: 900, label: "Solana" },
  avalanche: { chainId: 43114, label: "Avalanche" },
  zora: { chainId: 7777777, label: "Zora" },
  blast: { chainId: 81457, label: "Blast" },
  linea: { chainId: 59144, label: "Linea" },
  scroll: { chainId: 534352, label: "Scroll" },
  sei: { chainId: 1329, label: "Sei" },
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function looksLikeOpenSeaUrl(text: string): boolean {
  return /opensea\.io/i.test(text);
}

export function parseOpenSeaUrl(raw: string): ResolvedLink {
  let url: URL;
  try {
    const withProto = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    url = new URL(withProto);
  } catch {
    return { kind: "unknown" };
  }
  if (!/opensea\.io$/i.test(url.hostname)) return { kind: "unknown" };

  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.length === 0) return { kind: "unknown" };

  // /collection/<slug>
  if (parts[0] === "collection" && parts[1]) {
    return { kind: "collection", slug: parts[1].toLowerCase() };
  }
  // /assets/<chain>/<contract>/<tokenId?>
  if (parts[0] === "assets" && parts.length >= 3) {
    const chainName = parts[1].toLowerCase();
    const chain = CHAIN_MAP[chainName];
    const contract = parts[2];
    if (chainName === "solana") {
      return { kind: "asset", contract, tokenId: parts[3], chainId: 900, chainName: "Solana" };
    }
    if (chain && ADDR_RE.test(contract)) {
      return { kind: "asset", contract, tokenId: parts[3], chainId: chain.chainId, chainName: chain.label };
    }
    return { kind: "unknown" };
  }
  // /<wallet>  (profile) — single path segment that looks like an address or ENS
  if (parts.length === 1 && (ADDR_RE.test(parts[0]) || /^[a-z0-9-]{3,}\.eth$/i.test(parts[0]))) {
    return { kind: "wallet", wallet: parts[0] };
  }
  return { kind: "unknown" };
}

interface OsCollectionResp {
  collection?: string;
  name?: string;
  image_url?: string;
  contracts?: { address: string; chain: string }[];
}

export async function resolveOpenSeaCollection(slug: string): Promise<ResolvedLink> {
  const r = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) return { kind: "collection", slug };
  const j = (await r.json().catch(() => null)) as OsCollectionResp | null;
  if (!j) return { kind: "collection", slug };
  const contracts = (j.contracts || [])
    .map((c) => {
      const chain = CHAIN_MAP[(c.chain || "").toLowerCase()];
      return chain ? { address: c.address, chainId: chain.chainId, chainName: chain.label } : null;
    })
    .filter((x): x is { address: string; chainId: number; chainName: string } => x !== null);
  const primary = contracts[0];
  return {
    kind: "collection",
    slug,
    name: j.name || slug,
    imageUrl: j.image_url,
    contracts,
    contract: primary?.address,
    chainId: primary?.chainId,
    chainName: primary?.chainName,
  };
}

export async function resolveOpenSeaUrl(raw: string): Promise<ResolvedLink> {
  const parsed = parseOpenSeaUrl(raw);
  if (parsed.kind === "collection" && parsed.slug) {
    return resolveOpenSeaCollection(parsed.slug);
  }
  return parsed;
}
