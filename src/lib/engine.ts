import {
  ZERO_ADDR,
  ERC721_TRANSFER_TOPIC,
  ERC1155_SINGLE_TOPIC,
  ERC1155_BATCH_TOPIC,
  getLogs,
  padAddress,
  topicToAddress,
} from "./rpc";

export interface NftEvent {
  contract: string;
  standard: "721" | "1155";
  tokenId: string;
  value: bigint;
  from: string;
  to: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  txValueWei: bigint;
  gasUsedWei: bigint | null;
  timestamp: number | null;
}

const MAX_BLOCKS = 150000;
const MAX_LOGS = 20000;
const CONCURRENCY = 10;

// simple concurrency pool
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface LogRange {
  fromBlock: number;
  toBlock: number;
  truncated: boolean;
}

export async function resolveRange(
  rpcUrl: string,
  fromBlockParam: string | null,
  windowParam: string | null
): Promise<LogRange> {
  const { rpcCall } = await import("./rpc");
  const bn = await rpcCall(rpcUrl, "eth_blockNumber", []);
  const latest = parseInt(bn, 16);

  let fromBlock: number;
  if (fromBlockParam) {
    fromBlock = parseInt(fromBlockParam, 10);
  } else if (windowParam) {
    const days = parseFloat(windowParam);
    // ~12s block estimate; chains vary, but good enough
    fromBlock = Math.max(0, latest - Math.floor((days * 86400) / 12));
  } else {
    fromBlock = Math.max(0, latest - MAX_BLOCKS);
  }
  if (isNaN(fromBlock) || fromBlock < 0) fromBlock = Math.max(0, latest - MAX_BLOCKS);
  if (latest - fromBlock > MAX_BLOCKS) fromBlock = latest - MAX_BLOCKS;
  const truncated = latest - fromBlock >= MAX_BLOCKS;
  return { fromBlock, toBlock: latest, truncated };
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

// Adaptive log fetch: try the whole range, split in half on limits/errors.
// Nodes with wide range support (most modern ones) answer in 1 request.
export async function fetchRange(
  rpcUrl: string,
  filter: Record<string, unknown>,
  from: number,
  to: number,
  depth = 0
): Promise<RawLog[]> {
  if (depth > 9 || from > to) return [];
  try {
    const logs = await getLogs(rpcUrl, {
      ...filter,
      fromBlock: "0x" + from.toString(16),
      toBlock: "0x" + to.toString(16),
    });
    const arr = Array.isArray(logs) ? (logs as RawLog[]) : [];
    // silent truncation guard: ~10k-cap nodes return exactly 10000
    if (arr.length >= 9990 && from < to) {
      const mid = Math.floor((from + to) / 2);
      const [a, b] = await Promise.all([
        fetchRange(rpcUrl, filter, from, mid, depth + 1),
        fetchRange(rpcUrl, filter, mid + 1, to, depth + 1),
      ]);
      return [...a, ...b];
    }
    return arr;
  } catch (e) {
    if (from < to) {
      const mid = Math.floor((from + to) / 2);
      const [a, b] = await Promise.all([
        fetchRange(rpcUrl, filter, from, mid, depth + 1),
        fetchRange(rpcUrl, filter, mid + 1, to, depth + 1),
      ]);
      return [...a, ...b];
    }
    void e;
    return [];
  }
}

async function fetchChunked(
  rpcUrl: string,
  filter: Record<string, unknown>,
  from: number,
  to: number
): Promise<RawLog[]> {
  // split into ~30k-block segments processed with bounded concurrency
  const SEG = 30000;
  const segs: Array<[number, number]> = [];
  for (let s = from; s <= to; s += SEG) segs.push([s, Math.min(s + SEG - 1, to)]);
  const results = await pool(segs, CONCURRENCY, ([s, e]) => fetchRange(rpcUrl, filter, s, e));
  const out: RawLog[] = [];
  for (const r of results) {
    out.push(...r);
    if (out.length > MAX_LOGS) break;
  }
  return out;
}

function decode1155Data(data: string): Array<{ id: string; value: bigint }> {
  const d = data.replace(/^0x/, "");
  const words: bigint[] = [];
  for (let i = 0; i + 64 <= d.length; i += 64) {
    words.push(BigInt("0x" + d.slice(i, i + 64)));
  }
  if (words.length >= 2 && words[0] === 2n * 32n && words[1] === 3n * 32n) {
    // batch: ids array then values array
    const idsLen = Number(words[2]);
    const ids = words.slice(3, 3 + idsLen);
    const valsLen = Number(words[3 + idsLen]);
    const vals = words.slice(4 + idsLen, 4 + idsLen + valsLen);
    return ids.map((id, i) => ({ id: id.toString(), value: vals[i] ?? 1n }));
  }
  if (words.length >= 2) {
    return [{ id: words[0].toString(), value: words[1] }];
  }
  return [];
}

export async function fetchWalletEvents(
  rpcUrl: string,
  wallet: string,
  from: number,
  to: number
): Promise<NftEvent[]> {
  const w = padAddress(wallet);
  const filters: Array<{ topics: (string[] | null)[]; std: "721" | "1155" }> = [
    // ERC721 out (wallet = from)
    { topics: [[ERC721_TRANSFER_TOPIC], [w]], std: "721" },
    // ERC721 in (wallet = to)
    { topics: [[ERC721_TRANSFER_TOPIC], null, [w]], std: "721" },
    // ERC1155 single out
    { topics: [[ERC1155_SINGLE_TOPIC], null, [w]], std: "1155" },
    // ERC1155 single in
    { topics: [[ERC1155_SINGLE_TOPIC], null, null, [w]], std: "1155" },
    // ERC1155 batch out
    { topics: [[ERC1155_BATCH_TOPIC], null, [w]], std: "1155" },
    // ERC1155 batch in
    { topics: [[ERC1155_BATCH_TOPIC], null, null, [w]], std: "1155" },
  ];
  const results = await Promise.all(
    filters.map((f) =>
      fetchChunked(rpcUrl, { topics: f.topics as unknown[] }, from, to).then((logs) =>
        logs.map((l) => ({ ...l, _std: f.std }))
      )
    )
  );

  // group logs by tx to share value/gas
  const byTx = new Map<string, RawLog[]>();
  for (const logs of results) for (const l of logs) {
    const arr = byTx.get(l.transactionHash) || [];
    arr.push(l);
    byTx.set(l.transactionHash, arr);
  }

  // fetch receipts for txs (value + gas)
  const { rpcCall } = await import("./rpc");
  const txInfo = new Map<string, { valueWei: bigint; gasUsedWei: bigint | null }>();
  const txHashes = [...byTx.keys()].slice(0, 500);
  for (let i = 0; i < txHashes.length; i += 10) {
    const batch = txHashes.slice(i, i + 10);
    await Promise.all(
      batch.map(async (h) => {
        try {
          const [tx, receipt] = await Promise.all([
            rpcCall(rpcUrl, "eth_getTransactionByHash", [h]),
            rpcCall(rpcUrl, "eth_getTransactionReceipt", [h]).catch(() => null),
          ]);
          const value = tx?.value ? BigInt(tx.value) : 0n;
          let gas: bigint | null = null;
          if (receipt?.gasUsed && tx) {
            const price = tx.effectiveGasPrice || tx.gasPrice || receipt.effectiveGasPrice;
            if (price) gas = BigInt(receipt.gasUsed) * BigInt(price);
          }
          txInfo.set(h, { valueWei: value, gasUsedWei: gas });
        } catch {
          txInfo.set(h, { valueWei: 0n, gasUsedWei: null });
        }
      })
    );
  }

  const events: NftEvent[] = [];
  for (const [txHash, logs] of byTx) {
    const info = txInfo.get(txHash) || { valueWei: 0n, gasUsedWei: null };
    const nftLogsInTx = logs.length || 1;
    for (const log of logs) {
      const std = (log as RawLog & { _std: "721" | "1155" })._std;
      if (std === "721") {
        if (log.topics.length < 3) continue;
        events.push({
          contract: log.address.toLowerCase(),
          standard: "721",
          tokenId: BigInt(log.topics[3] ? log.topics[3] : "0x0").toString(),
          value: 1n,
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          txHash,
          blockNumber: parseInt(log.blockNumber, 16),
          logIndex: parseInt(log.logIndex, 16),
          txValueWei: info.valueWei,
          gasUsedWei: info.gasUsedWei !== null ? info.gasUsedWei / BigInt(nftLogsInTx) : null,
          timestamp: null,
        });
      } else {
        if (log.topics.length < 4) continue;
        const parts = decode1155Data(log.data || "0x");
        for (const p of parts) {
          events.push({
            contract: log.address.toLowerCase(),
            standard: "1155",
            tokenId: p.id,
            value: p.value,
            from: topicToAddress(log.topics[2]),
            to: topicToAddress(log.topics[3]),
            txHash,
            blockNumber: parseInt(log.blockNumber, 16),
            logIndex: parseInt(log.logIndex, 16),
            txValueWei: info.valueWei,
            gasUsedWei: info.gasUsedWei !== null ? info.gasUsedWei / BigInt(nftLogsInTx) : null,
            timestamp: null,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return events;
}

// ---------- PnL computation ----------

export interface TokenStat {
  contract: string;
  tokenId: string;
  standard: "721" | "1155";
  mints: number;
  buys: number;
  sales: number;
  transfersOut: number;
  held: string;
  spentWei: string;
  receivedWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
  avgBuyWei: string | null;
  avgSaleWei: string | null;
  eventsCount: number;
}

export interface WalletScanResult {
  wallet: string;
  chainId: number;
  fromBlock: number;
  toBlock: number;
  truncated: boolean;
  nativeBalanceWei: string;
  gasUsedWei: string;
  tokens: TokenStat[];
  totals: {
    nftsBought: number;
    nftsSold: number;
    nftsTransferredOut: number;
    nftsMinted: number;
    currentHeld: number;
    spentWei: string;
    receivedWei: string;
    gasWei: string;
    realizedPnlWei: string;
    realizedPnlPct: number | null;
  };
  sampleTimestamps: Record<string, number>; // txHash -> ts
}

export async function buildWalletStats(
  wallet: string,
  chainId: number,
  rpcUrl: string,
  events: NftEvent[],
  fromBlock: number,
  toBlock: number,
  truncated: boolean,
  nativeBalanceWei: bigint,
  gasNativeWei: bigint
): Promise<WalletScanResult> {
  const wl = wallet.toLowerCase();
  interface Lot { qty: bigint; unitCostWei: bigint; hasCost: boolean }
  const positions = new Map<string, Lot[]>();
  const stats = new Map<string, TokenStat>();

  const key = (c: string, id: string) => `${c}:${id}`;
  let totalMints = 0, totalBuys = 0, totalSales = 0, totalTransfersOut = 0;
  let spent = 0n, received = 0n, gas = 0n;
  const txTimestamps: Record<string, number> = {};

  // per-tx event count: share tx value/gas across events in the same tx
  const perTxCount = new Map<string, number>();
  for (const ev of events) perTxCount.set(ev.txHash, (perTxCount.get(ev.txHash) || 0) + 1);

  for (const ev of events) {
    if (ev.from === wl && ev.to === wl) continue; // self-transfer
    const k = key(ev.contract, ev.tokenId);
    let st = stats.get(k);
    if (!st) {
      st = {
        contract: ev.contract,
        tokenId: ev.tokenId,
        standard: ev.standard,
        mints: 0, buys: 0, sales: 0, transfersOut: 0, held: "0",
        spentWei: "0", receivedWei: "0", realizedPnlWei: "0",
        realizedPnlPct: null, avgBuyWei: null, avgSaleWei: null,
        eventsCount: 0,
      };
      stats.set(k, st);
      positions.set(k, []);
    }
    st.eventsCount++;
    const lots = positions.get(k)!;
    const qty = ev.value > 0n ? ev.value : 1n;
    const nInTx = perTxCount.get(ev.txHash) || 1;
    const valueShare = nInTx > 1 ? ev.txValueWei / BigInt(nInTx) : ev.txValueWei;
    const gasShareFull = ev.gasUsedWei ?? 0n;
    const gasShare = nInTx > 1 ? gasShareFull / BigInt(nInTx) : gasShareFull;

    if (ev.to === wl) {
      // acquisition
      const isMint = ev.from === ZERO_ADDR;
      if (isMint) {
        st.mints += Number(qty);
        totalMints += Number(qty);
      } else {
        st.buys += Number(qty);
        totalBuys += Number(qty);
      }
      const paid = valueShare > 0n;
      const unitCost = paid ? valueShare / qty + gasShare / qty : gasShare > 0n ? gasShare / qty : 0n;
      lots.push({ qty, unitCostWei: unitCost, hasCost: paid || gasShare > 0n });
      if (paid) {
        st.spentWei = (BigInt(st.spentWei) + valueShare).toString();
        spent += valueShare;
      }
      if (gasShare > 0n) {
        st.spentWei = (BigInt(st.spentWei) + gasShare).toString();
        gas += gasShare;
      }
    } else if (ev.from === wl) {
      // disposal — only count as SALE if ETH came in for it
      const revenue = valueShare;
      if (revenue > 0n) {
        st.sales += Number(qty);
        totalSales += Number(qty);
        st.receivedWei = (BigInt(st.receivedWei) + revenue).toString();
        received += revenue;
      } else {
        st.transfersOut += Number(qty);
        totalTransfersOut += Number(qty);
      }
      if (ev.gasUsedWei) {
        gas += nInTx > 1 ? gasShareFull / BigInt(nInTx) : gasShareFull;
      }
      // FIFO cost removal
      let remaining = qty;
      let costOfSold = 0n;
      while (remaining > 0n && lots.length > 0) {
        const lot = lots[0];
        const take = lot.qty < remaining ? lot.qty : remaining;
        costOfSold += take * lot.unitCostWei;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty === 0n) lots.shift();
      }
      st.realizedPnlWei = (BigInt(st.realizedPnlWei) + revenue - costOfSold).toString();
    }
  }

  // held counts + pct + avg
  let heldTokens = 0;
  for (const [k, st] of stats) {
    const lots = positions.get(k)!;
    const heldBig = lots.reduce((a, l) => a + l.qty, 0n);
    st.held = heldBig.toString();
    if (heldBig > 0n) heldTokens++;
    const spentB = BigInt(st.spentWei);
    if (spentB > 0n) {
      st.realizedPnlPct = Number((BigInt(st.realizedPnlWei) * 10000n) / spentB) / 100;
    }
    if (st.buys > 0 && spentB > 0n) st.avgBuyWei = (spentB / BigInt(st.buys)).toString();
    if (st.sales > 0) st.avgSaleWei = (BigInt(st.receivedWei) / BigInt(st.sales)).toString();
  }

  // sample timestamps for top txs (for the card)
  const { getTxTimestamp } = await import("./rpc");
  const interesting = events
    .filter((e) => e.txValueWei > 0n || e.from === ZERO_ADDR || e.to === ZERO_ADDR)
    .slice(-12);
  await Promise.all(
    interesting.map(async (e) => {
      if (txTimestamps[e.txHash]) return;
      const ts = await getTxTimestamp(rpcUrl, e.txHash);
      if (ts) txTimestamps[e.txHash] = ts;
    })
  );

  const realizedTotal = [...stats.values()].reduce((a, s) => a + BigInt(s.realizedPnlWei), 0n);
  const totals = {
    nftsBought: totalBuys,
    nftsSold: totalSales,
    nftsTransferredOut: totalTransfersOut,
    nftsMinted: totalMints,
    currentHeld: heldTokens,
    spentWei: spent.toString(),
    receivedWei: received.toString(),
    gasWei: gas.toString(),
    realizedPnlWei: realizedTotal.toString(),
    realizedPnlPct:
      spent > 0n ? Number((realizedTotal * 10000n) / spent) / 100 : null,
  };

  const tokenList = [...stats.values()]
    .sort((a, b) => {
      const pa = BigInt(a.realizedPnlWei), pb = BigInt(b.realizedPnlWei);
      if (pa !== pb) return pa > pb ? -1 : 1;
      return BigInt(b.spentWei) - BigInt(a.spentWei) > 0n ? 1 : -1;
    })
    .slice(0, 200);

  return {
    wallet,
    chainId,
    fromBlock,
    toBlock,
    truncated,
    nativeBalanceWei: nativeBalanceWei.toString(),
    gasUsedWei: gasNativeWei.toString(),
    tokens: tokenList,
    totals,
    sampleTimestamps: txTimestamps,
  };
}
