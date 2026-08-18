// Solana scanner — public RPC only (no API key)
// Strategy: getSignaturesForAddress → sample getTransaction → compute
// SOL volume, NFT-like token movements, and activity window.
// Lamports are scaled to 18-decimal "wei" strings so the shared
// formatting helpers render SOL values directly.

const RPCS = [
  "https://api.mainnet-beta.solana.com",
];

const SCALE = 1_000_000_000n; // lamports → 18-dec units

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.error) {
        lastErr = new Error(j.error.message || "rpc error");
        continue;
      }
      return j.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("solana rpc failed");
}

export async function solanaBalanceWei(address: string): Promise<string> {
  const j = await rpc<{ value: number }>("getBalance", [address]);
  return (BigInt(j.value) * SCALE).toString();
}

interface SigInfo {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

interface TxMeta {
  accountKeys?: Array<{ pubkey: string }>;
  preBalances?: number[];
  postBalances?: number[];
  preTokenBalances?: Array<{ owner?: string; mint: string; uiTokenAmount?: { decimals: number; uiAmount: number | null } }>;
  postTokenBalances?: Array<{ owner?: string; mint: string; uiTokenAmount?: { decimals: number; uiAmount: number | null } }>;
}

export interface SolanaScanResult {
  wallet: string;
  chainId: 900;
  signatureCount: number;
  sampled: number;
  truncated: boolean;
  solSpentWei: string; // lamports scaled to 18-dec
  solReceivedWei: string;
  netWei: string;
  feesWei: string;
  nftMoves: number; // transfers of decimals-0 tokens (NFT-like)
  nftMints: number;
  uniqueNfts: string[];
  firstTs: number | null;
  lastTs: number | null;
  nativeBalanceWei: string;
  windowStart: number | null;
}

export async function scanSolanaWallet(
  address: string,
  windowDays: number,
  maxSigs = 500,
  maxSampled = 60
): Promise<SolanaScanResult> {
  const cutoff = Math.floor(Date.now() / 1000) - Math.floor(windowDays * 86400);

  // collect signatures (paginated, capped)
  const sigs: SigInfo[] = [];
  let before: string | undefined;
  while (sigs.length < maxSigs) {
    const params: unknown[] = [{ limit: 250 }];
    if (before) params[0] = { limit: 250, before };
    const page = await rpc<SigInfo[]>("getSignaturesForAddress", [address, params[0]]);
    if (!Array.isArray(page) || page.length === 0) break;
    sigs.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 250) break;
  }

  // keep only within window + successful
  const inWindow = sigs.filter((s) => s.blockTime !== null && s.blockTime >= cutoff && s.err === null);
  const truncated = sigs.length >= maxSigs;

  const sampled = inWindow.slice(0, maxSampled);
  let spent = 0n;
  let received = 0n;
  let fees = 0n;
  let nftMoves = 0;
  const nftSet = new Set<string>();
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  // sample transactions in small parallel batches
  for (let i = 0; i < sampled.length; i += 6) {
    const batch = sampled.slice(i, i + 6);
    const txs = await Promise.all(
      batch.map((s) =>
        rpc<{ meta: TxMeta; blockTime?: number } | null>("getTransaction", [
          s.signature,
          { maxSupportedTransactionVersion: 0, transactionDetails: "full", commitment: "confirmed" },
        ]).catch(() => null)
      )
    );
    for (let k = 0; k < txs.length; k++) {
      const tx = txs[k];
      const ts = batch[k].blockTime;
      if (ts !== null) {
        if (firstTs === null || ts < firstTs) firstTs = ts;
        if (lastTs === null || ts > lastTs) lastTs = ts;
      }
      if (!tx?.meta) continue;
      const meta = tx.meta;
      const keys = (meta.accountKeys || []).map((a) => a.pubkey);
      const idx = keys.indexOf(address);
      if (idx >= 0 && meta.preBalances && meta.postBalances) {
        const pre = BigInt(meta.preBalances[idx] ?? 0);
        const post = BigInt(meta.postBalances[idx] ?? 0);
        const delta = post - pre;
        if (delta < 0n) spent += -delta;
        else received += delta;
      }
      // NFT-like: decimals == 0 token balance changes owned by the wallet
      const preMap = new Map<string, number>();
      for (const tb of meta.preTokenBalances || []) {
        if (tb.owner === address) preMap.set(tb.mint, tb.uiTokenAmount?.uiAmount ?? 0);
      }
      for (const tb of meta.postTokenBalances || []) {
        if (tb.owner !== address || tb.uiTokenAmount?.decimals !== 0) continue;
        const beforeAmt = preMap.get(tb.mint) ?? 0;
        const afterAmt = tb.uiTokenAmount?.uiAmount ?? 0;
        if (beforeAmt !== afterAmt) {
          nftMoves++;
          nftSet.add(tb.mint);
          preMap.delete(tb.mint);
        }
      }
      for (const [mint] of preMap) {
        nftMoves++;
        nftSet.add(mint);
      }
    }
  }

  // fees: rough — 5000 lamports per sampled tx
  fees = BigInt(sampled.length) * 5000n * SCALE;

  const bal = await solanaBalanceWei(address).catch(() => "0");

  return {
    wallet: address,
    chainId: 900,
    signatureCount: inWindow.length,
    sampled: sampled.length,
    truncated,
    solSpentWei: (spent * SCALE).toString(),
    solReceivedWei: (received * SCALE).toString(),
    netWei: ((received > spent ? received - spent : -(spent - received)) * SCALE).toString(),
    feesWei: fees.toString(),
    nftMoves,
    nftMints: nftSet.size,
    uniqueNfts: [...nftSet].slice(0, 100),
    firstTs,
    lastTs,
    nativeBalanceWei: bal,
    windowStart: cutoff,
  };
}
