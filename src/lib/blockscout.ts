import { getChain, type ChainInfo } from "./chains";
import { pool } from "./engine";
import { ZERO_ADDR } from "./rpc";

// ---------- instance discovery ----------

const KNOWN_INSTANCES: Record<number, string> = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  8453: "https://base.blockscout.com",
  137: "https://polygon.blockscout.com",
  4663: "https://robinhoodchain.blockscout.com",
  100: "https://gnosis.blockscout.com",
  43114: "https://avax.blockscout.com",
  250: "https://ftm.blockscout.com",
  324: "https://zksync.blockscout.com",
  59144: "https://linea.blockscout.com",
  534352: "https://scroll.blockscout.com",
  5000: "https://mantle.blockscout.com",
  81457: "https://blast.blockscout.com",
  34443: "https://mode.blockscout.com",
  204: "https://opbnb.blockscout.com",
  57073: "https://ink.blockscout.com",
  60808: "https://bob.blockscout.com",
  888: "https://wanchain.blockscout.com",
};

const detectionCache = new Map<number, string | null>();

async function probeInstance(base: string): Promise<boolean> {
  for (const path of [
    "/api/v2/tokens?type=ERC-721",
    "/api/v2/chain-id",
    "/api/v2/stats",
  ]) {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(6000) });
      if (r.ok) return true;
    } catch {
      /* try next probe */
    }
  }
  return false;
}

export async function getBlockscout(chain: ChainInfo): Promise<string | null> {
  const cached = detectionCache.get(chain.chainId);
  if (cached !== undefined) return cached;

  const candidates: string[] = [];
  const known = KNOWN_INSTANCES[chain.chainId];
  if (known) candidates.push(known);
  // guess from shortName/name
  const slug = (chain.shortName || chain.name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (slug) {
    candidates.push(`https://${slug}.blockscout.com`);
    candidates.push(`https://${slug}-chain.blockscout.com`);
  }

  for (const c of candidates) {
    if (await probeInstance(c)) {
      detectionCache.set(chain.chainId, c);
      return c;
    }
  }
  detectionCache.set(chain.chainId, null);
  return null;
}

export async function blockscoutForChainId(chainId: number): Promise<string | null> {
  const chain = await getChain(chainId);
  return getBlockscout(chain);
}

// ---------- data types ----------

export interface BsTransfer {
  contract: string;
  tokenId: string;
  amount: bigint; // 1 for 721
  standard: "721" | "1155";
  from: string;
  to: string;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
}

export interface TxDetail {
  valueWei: bigint;
  gasUsedWei: bigint | null;
  timestamp: number | null;
}

async function jget(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

interface BsPage {
  items: Array<{
    block_number: number;
    from: { hash: string } | null;
    to: { hash: string } | null;
    transaction_hash: string;
    timestamp?: string;
    token_type?: string;
    token?: { address_hash?: string; address?: string; type?: string };
    total?: string | { token_id?: string } | null;
  }>;
  next_page_params?: Record<string, string | number> | null;
}

function parsePage(
  page: BsPage,
  onlyToken?: string,
  minBlock?: number,
  minTs?: number
): BsTransfer[] {
  const out: BsTransfer[] = [];
  for (const it of page.items || []) {
    const contract = (
      it.token?.address_hash ||
      it.token?.address ||
      ""
    ).toLowerCase();
    if (onlyToken && contract !== onlyToken) continue;
    if (minBlock !== undefined && it.block_number < minBlock) continue;
    const ts = it.timestamp ? Math.floor(new Date(it.timestamp).getTime() / 1000) : null;
    if (minTs !== undefined && ts !== null && ts < minTs) continue;
    const tt = it.token_type || it.token?.type || "";
    let standard: "721" | "1155" | null = null;
    if (tt.includes("721")) standard = "721";
    else if (tt.includes("1155")) standard = "1155";
    if (!standard) continue;
    const from = (it.from?.hash || ZERO_ADDR).toLowerCase();
    const to = (it.to?.hash || ZERO_ADDR).toLowerCase();
    let tokenId = "0";
    let amount = 1n;
    if (typeof it.total === "string") {
      if (standard === "721") tokenId = it.total;
      else amount = BigInt(it.total || "1");
    } else if (it.total && typeof it.total === "object") {
      tokenId = it.total.token_id || "0";
    }
    out.push({
      contract,
      tokenId,
      amount,
      standard,
      from,
      to,
      txHash: it.transaction_hash,
      blockNumber: it.block_number,
      timestamp: ts,
    });
  }
  return out;
}

function qs(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// paginate until block < minBlock or timestamp < minTs or maxPages or maxItems
async function paginate(
  baseUrl: string,
  firstParams: Record<string, string | number>,
  minBlock: number,
  maxPages: number,
  onlyToken?: string,
  maxItems = Infinity,
  minTs?: number
): Promise<{ items: BsTransfer[]; truncated: boolean }> {
  const out: BsTransfer[] = [];
  let params: Record<string, string | number> | null = firstParams;
  let pages = 0;
  let truncated = false;
  while (params && pages < maxPages) {
    const page = (await jget(`${baseUrl}?${qs(params)}`)) as BsPage | null;
    if (!page || !Array.isArray(page.items)) break;
    const items = parsePage(page, onlyToken, minBlock, minTs);
    out.push(...items);
    pages++;
    if (out.length >= maxItems) {
      out.length = maxItems;
      truncated = true;
      break;
    }
    const last = page.items[page.items.length - 1];
    if (last && last.block_number < minBlock) break;
    // timestamp-based early exit (pages arrive newest-first)
    if (minTs !== undefined && last?.timestamp) {
      const lastTs = Math.floor(new Date(last.timestamp).getTime() / 1000);
      if (lastTs < minTs) break;
    }
    if (!page.next_page_params) break;
    params = { ...firstParams, ...page.next_page_params };
  }
  return { items: out, truncated };
}

// ---------- high-level fetchers ----------

export async function bsAddressTransfers(
  base: string,
  address: string,
  fromBlock: number,
  maxPages = 12,
  maxItems = 500,
  minTs?: number
): Promise<{ items: BsTransfer[]; truncated: boolean }> {
  const first = await paginate(
    `${base}/api/v2/addresses/${address}/token-transfers`,
    { type: "ERC-721,ERC-1155" },
    fromBlock,
    maxPages,
    undefined,
    maxItems,
    minTs
  );
  if (first.items.length > 0) return first;
  // some instances reject the combined type param → retry without and filter client-side
  return paginate(
    `${base}/api/v2/addresses/${address}/token-transfers`,
    {},
    fromBlock,
    maxPages,
    undefined,
    maxItems,
    minTs
  );
}

export async function bsTokenTransfers(
  base: string,
  token: string,
  fromBlock: number,
  maxPages = 40,
  maxItems = 2000,
  minTs?: number
): Promise<{ items: BsTransfer[]; truncated: boolean }> {
  return paginate(
    `${base}/api/v2/tokens/${token}/transfers`,
    {},
    fromBlock,
    maxPages,
    token.toLowerCase(),
    maxItems,
    minTs
  );
}

export async function bsTokenMeta(
  base: string,
  token: string
): Promise<{ name: string | null; symbol: string | null; type: string | null; holders: number | null; totalSupply: string | null }> {
  const j = (await jget(`${base}/api/v2/tokens/${token}`)) as {
    name?: string;
    symbol?: string;
    type?: string;
    total_supply?: string;
    holders?: number;
  } | null;
  let holders: number | null = j?.holders ?? null;
  if (holders === null) {
    const c = (await jget(`${base}/api/v2/tokens/${token}/counters`)) as {
      token_holders_count?: string;
    } | null;
    if (c?.token_holders_count) holders = parseInt(c.token_holders_count, 10) || null;
  }
  return {
    name: j?.name || null,
    symbol: j?.symbol || null,
    type: j?.type || null,
    holders,
    totalSupply: j?.total_supply ?? null,
  };
}

export async function bsTxDetails(
  base: string,
  hashes: string[],
  cap = 220
): Promise<Map<string, TxDetail>> {
  const map = new Map<string, TxDetail>();
  const uniq = [...new Set(hashes)].slice(0, cap);
  await pool(uniq, 20, async (h) => {
    const j = (await jget(`${base}/api/v2/transactions/${h}`)) as {
      value?: string;
      gas_used?: string;
      gas_price?: string;
      timestamp?: string;
    } | null;
    const valueWei = j?.value ? BigInt(j.value) : 0n;
    let gas: bigint | null = null;
    if (j?.gas_used && j?.gas_price) gas = BigInt(j.gas_used) * BigInt(j.gas_price);
    map.set(h, {
      valueWei,
      gasUsedWei: gas,
      timestamp: j?.timestamp ? Math.floor(new Date(j.timestamp).getTime() / 1000) : null,
    });
  });
  return map;
}
