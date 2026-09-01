import { NextRequest } from "next/server";
import { getChain } from "@/lib/chains";
import { ZERO_ADDR, resolveRpc, probeToken } from "@/lib/rpc";
import { resolveRange } from "@/lib/engine";
import {
  getBlockscout,
  bsTokenMeta,
  bsTxDetails,
  bsAddressTransfers,
  bsTxNativeInflow,
  bsTxErc20FlowUsd,
  bsCoinPrice,
} from "@/lib/blockscout";
import { rateLimited, clientIp, badRequest, tooMany } from "../_limit";
import { getOpenSeaFloorByContract } from "@/lib/opensea";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_WALLETS = 50;
const BOT_CACHE_TTL_MS = 30_000;
const botCache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip, 30)) return tooMany();

  const sp = req.nextUrl.searchParams;
  const contractRaw = sp.get("contract")?.trim();
  const walletsRaw = sp.get("wallets")?.trim();
  const chainIdRaw = sp.get("chainId");
  const fromBlock = sp.get("fromBlock");
  const windowDays = sp.get("window");

  if (!contractRaw || !ADDR_RE.test(contractRaw)) return badRequest("Invalid contract address");
  if (!walletsRaw) return badRequest("No wallets provided");
  const wallets = walletsRaw
    .split(/[,\s]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => ADDR_RE.test(w));
  if (wallets.length === 0) return badRequest("No valid wallets provided");
  if (wallets.length > MAX_WALLETS) return badRequest(`Max ${MAX_WALLETS} wallets per scan`);
  const chainId = parseInt(chainIdRaw || "1", 10);
  if (isNaN(chainId)) return badRequest("Invalid chainId");

  const cacheKey = `${chainId}:${contractRaw.toLowerCase()}:${wallets.slice().sort().join(",")}:${fromBlock || ""}:${windowDays || "30"}`;
  const cached = botCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOT_CACHE_TTL_MS) {
    return Response.json(cached.data, { headers: { "X-Flexinite-Cache": "HIT" } });
  }

  try {
    const chain = await getChain(chainId);
    const contract = contractRaw.toLowerCase();
    let rpc: string | null = null;
    try { rpc = await resolveRpc(chain); } catch { /* none */ }
    // Robinhood Blockscout is intermittently reachable but its paginated NFT
    // feeds stall in serverless runs. Use wallet-indexed RPC logs there; they
    // are both faster and authoritative for this calculation.
    const bs = chainId === 4663 ? null : await getBlockscout(chain);

    // meta
    let name: string | null = null, symbol: string | null = null, standard = "Unknown";
    if (bs) {
      const meta = await bsTokenMeta(bs, contract);
      name = meta.name; symbol = meta.symbol;
      if (meta.type) standard = meta.type.includes("1155") ? "ERC-1155" : meta.type.includes("721") ? "ERC-721" : meta.type;
    }
    if ((!name || standard === "Unknown") && rpc) {
      const probed = await probeToken(rpc, contract);
      name = name || probed.name;
      if (standard === "Unknown") standard = probed.is721 ? "ERC-721" : probed.is1155 ? "ERC-1155" : "Unknown";
    }

    // range (time-window based)
    let fromB = 0, toB = 0, truncated = false;
    const j = bs ? await fetch(`${bs}/api/v2/main-page/blocks`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null) : null;
    const latest = Array.isArray(j) && j[0]?.height ? Number(j[0].height) : NaN;
    const days = windowDays ? parseFloat(windowDays) : 30;
    const minTs = Math.floor(Date.now() / 1000) - Math.floor(days * 86400);
    if (!isNaN(latest)) {
      toB = latest;
    } else if (rpc) {
      const range = await resolveRange(rpc, fromBlock, windowDays);
      fromB = range.fromBlock; toB = range.toBlock; truncated = range.truncated;
    }

    // ---- transfers: per-wallet history restricted to this contract ----
    // (fast: each wallet's address-transfer feed is small; also catches
    // mints correctly and works within serverless time limits)
    interface WMove {
      dir: "in" | "out";
      qty: bigint;
      txHash: string;
      ts: number;
      mint: boolean;
    }
    const walletMoves = new Map<string, WMove[]>();
    if (bs) {
      const { pool: poolFn } = await import("@/lib/engine");
      await poolFn(wallets, 5, async (w) => {
        const { items } = await bsAddressTransfers(bs!, w, 0, 12, 500, minTs);
        const mv: WMove[] = [];
        for (const t of items) {
          if (t.contract !== contract) continue;
          const qty = t.standard === "721" ? 1n : t.amount;
          if (t.from === w) mv.push({ dir: "out", qty, txHash: t.txHash, ts: t.timestamp || 0, mint: false });
          else if (t.to === w) mv.push({ dir: "in", qty, txHash: t.txHash, ts: t.timestamp || 0, mint: t.from === ZERO_ADDR });
        }
        mv.sort((a, b) => a.ts - b.ts); // chronological for FIFO
        walletMoves.set(w, mv);
      });
      truncated = wallets.some((w) => (walletMoves.get(w) || []).length >= 500);
    } else if (rpc) {
      const { ERC721_TRANSFER_TOPIC, topicToAddress, padAddress, rpcCall } = await import("@/lib/rpc");
      const { pool: poolFn } = await import("@/lib/engine");
      // Holdings and their cost basis require lifetime collection history.
      // Query the contract+wallet indexed topics in one shot. Do NOT feed a
      // full fast-chain lifetime range into adaptive splitting: RPCs that cap
      // ranges can recursively create millions of subqueries and exhaust RAM.
      fromB = fromBlock ? Math.max(0, parseInt(fromBlock, 10) || 0) : 0;
      const candidates = [
        ...(chainId === 4663 ? ["https://rpc.mainnet.chain.robinhood.com"] : []),
        rpc,
        ...chain.rpcUrls,
      ].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

      let winner: string | null = null;
      let latestBlock = 0;
      const logsByWallet = new Map<string, { incoming: Awaited<ReturnType<typeof rpcCall>>; outgoing: Awaited<ReturnType<typeof rpcCall>> }>();
      const rpcDeadline = Date.now() + 30000;
      for (let round = 0; round < 2 && !winner; round++) {
        for (const candidate of candidates) {
          if (Date.now() >= rpcDeadline) break;
          try {
            const latestHex = await rpcCall(candidate, "eth_blockNumber", [], 3000);
            const latest = parseInt(latestHex, 16);
            const result = new Map<string, { incoming: Awaited<ReturnType<typeof rpcCall>>; outgoing: Awaited<ReturnType<typeof rpcCall>> }>();
            await poolFn(wallets, 5, async (w) => {
              const wt = padAddress(w);
              const [incoming, outgoing] = await Promise.all([
                rpcCall(candidate, "eth_getLogs", [{ address: contract, fromBlock: `0x${fromB.toString(16)}`, toBlock: latestHex, topics: [[ERC721_TRANSFER_TOPIC], null, [wt]] }], 6000),
                rpcCall(candidate, "eth_getLogs", [{ address: contract, fromBlock: `0x${fromB.toString(16)}`, toBlock: latestHex, topics: [[ERC721_TRANSFER_TOPIC], [wt]] }], 6000),
              ]);
              if (!Array.isArray(incoming) || !Array.isArray(outgoing)) throw new Error("Invalid eth_getLogs response");
              result.set(w, { incoming, outgoing });
            });
            for (const [w, logs] of result) logsByWallet.set(w, logs);
            winner = candidate;
            latestBlock = latest;
            break;
          } catch {
            // Try the next public RPC as a whole-range provider.
          }
        }
        if (!winner && round === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!winner) throw new Error("No RPC accepted wallet-indexed lifetime logs");
      rpc = winner;
      toB = latestBlock;

      for (const w of wallets) {
        const logs = logsByWallet.get(w) || { incoming: [], outgoing: [] };
        const seen = new Set<string>();
        const mv: WMove[] = [];
        for (const l of [...logs.incoming, ...logs.outgoing]) {
          if (!l.topics || l.topics.length < 4) continue;
          const logKey = `${l.transactionHash}:${l.logIndex}`;
          if (seen.has(logKey)) continue;
          seen.add(logKey);
          const from = topicToAddress(l.topics[1]);
          const to = topicToAddress(l.topics[2]);
          const block = parseInt(l.blockNumber, 16) || 0;
          if (from === w && to !== w) mv.push({ dir: "out", qty: 1n, txHash: l.transactionHash, ts: block, mint: false });
          else if (to === w && from !== w) mv.push({ dir: "in", qty: 1n, txHash: l.transactionHash, ts: block, mint: from === ZERO_ADDR });
        }
        mv.sort((a, b) => a.ts - b.ts);
        walletMoves.set(w, mv);
      }
      truncated = false;
    } else {
      return Response.json({ error: "No data source available for this chain" }, { status: 500 });
    }

    // ---- tx value attribution (only for txs the tracked wallets touched) ----
    const txHashSet = new Set<string>();
    for (const mv of walletMoves.values()) for (const m of mv) txHashSet.add(m.txHash);
    const txValue = new Map<string, { qty: bigint; value: bigint; from: string; to: string }>();
    for (const mv of walletMoves.values()) {
      for (const m of mv) {
        if (!txValue.has(m.txHash)) txValue.set(m.txHash, { qty: 0n, value: 0n, from: "", to: "" });
        txValue.get(m.txHash)!.qty += m.qty;
      }
    }
    let coinPrice = 0;
    if (bs) {
      const details = await bsTxDetails(bs, [...txHashSet], 400);
      for (const [h, d] of details) {
        const agg = txValue.get(h);
        if (agg) { agg.value = d.valueWei; agg.from = d.from; agg.to = d.to; }
      }
      coinPrice = await bsCoinPrice(bs);
    } else if (rpc) {
      const { rpcCall } = await import("@/lib/rpc");
      const hashes = [...txHashSet].slice(0, 400);
      const txRpcs = [
        rpc,
        ...(chainId === 4663 ? ["https://rpc.mainnet.chain.robinhood.com"] : []),
        ...chain.rpcUrls,
      ].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
      for (let i = 0; i < hashes.length; i += 10) {
        const batch = hashes.slice(i, i + 10);
        await Promise.all(batch.map(async (h) => {
          // Public RPCs occasionally return/timeout one transaction request
          // after a successful log scan. Fail over before treating cost as 0.
          for (const txRpc of txRpcs) {
            try {
              const tx = await rpcCall(txRpc, "eth_getTransactionByHash", [h], 8000);
              if (!tx) continue;
              if (tx.value) txValue.get(h)!.value = BigInt(tx.value);
              if (tx.from) txValue.get(h)!.from = String(tx.from).toLowerCase();
              if (tx.to) txValue.get(h)!.to = String(tx.to).toLowerCase();
              break;
            } catch { /* try next rpc */ }
          }
        }));
      }
    }
    // sale proceeds probing: disposal txs initiated by a tracked wallet with
    // 0 native value may pay out via internals or ERC-20 (e.g. USDG on Robinhood)
    const incomeWei = new Map<string, bigint>();
    if (bs) {
      const candidates: string[] = [];
      for (const w of wallets) {
        for (const m of walletMoves.get(w) || []) {
          if (m.dir !== "out") continue;
          const agg = txValue.get(m.txHash);
          if (agg && agg.from === w && agg.value === 0n && !candidates.includes(m.txHash)) {
            candidates.push(m.txHash);
          }
        }
      }
      const { pool: poolFn } = await import("@/lib/engine");
      await poolFn(candidates.slice(0, 30), 6, async (h) => {
        let inflow = 0n;
        for (const w of wallets) {
          inflow += await bsTxNativeInflow(bs!, h, w);
          const { inUsd, outUsd } = await bsTxErc20FlowUsd(bs!, h, w);
          const agg = txValue.get(h);
          void agg;
          const netUsd = inUsd - outUsd;
          if (netUsd > 0) {
            const rate = (await bsTxDetails(bs!, [h], 1)).get(h)?.exchangeRate ?? coinPrice;
            if (rate && rate > 0) inflow += BigInt(Math.round((netUsd / rate) * 1e18));
          }
        }
        incomeWei.set(h, inflow);
      });
    }

    const floor = await getOpenSeaFloorByContract(chainId, contract);

    // per-wallet FIFO
    interface WStat {
      wallet: string;
      bought: bigint; sold: bigint; minted: bigint; held: bigint;
      spent: bigint; received: bigint; realized: bigint;
      lots: { qty: bigint; cost: bigint }[];
    }
    const stats = new Map<string, WStat>(
      wallets.map((w) => [
        w,
        { wallet: w, bought: 0n, sold: 0n, minted: 0n, held: 0n, spent: 0n, received: 0n, realized: 0n, lots: [] },
      ])
    );

    for (const w of wallets) {
      const s = stats.get(w)!;
      for (const m of walletMoves.get(w) || []) {
        const agg = txValue.get(m.txHash);
        const nInTx = agg && agg.qty > 0n ? agg.qty : 1n;
        const unitTxValue = agg && agg.qty > 0n ? agg.value / agg.qty : 0n;
        if (m.dir === "in") {
          if (m.mint) s.minted += m.qty;
          else s.bought += m.qty;
          // cost applies only when THIS wallet paid (initiated a value tx)
          let cost = 0n;
          if (agg && agg.from === w && agg.value > 0n) cost = unitTxValue * m.qty;
          s.spent += cost;
          s.lots.push({ qty: m.qty, cost });
        } else {
          // outgoing — sale only if value came in for it
          let proceeds = 0n;
          if (agg && agg.from !== w && agg.to === w && agg.value > 0n) {
            proceeds = unitTxValue * m.qty; // buyer paid the wallet directly
          } else {
            const probed = incomeWei.get(m.txHash);
            if (probed !== undefined && probed > 0n) proceeds = (probed / nInTx) * m.qty;
          }
          if (proceeds > 0n) {
            s.sold += m.qty;
            s.received += proceeds;
          }
          // FIFO cost removal (sales and transfers-out alike)
          let rem = m.qty, costOut = 0n;
          while (rem > 0n && s.lots.length) {
            const lot = s.lots[0];
            const take = lot.qty < rem ? lot.qty : rem;
            const unitCost = lot.qty > 0n ? lot.cost / lot.qty : 0n;
            const removedCost = unitCost * take;
            costOut += removedCost;
            lot.cost -= removedCost;
            lot.qty -= take; rem -= take;
            if (lot.qty === 0n) s.lots.shift();
          }
          s.realized += proceeds - costOut;
        }
      }
    }

    const rows = wallets.map((w) => {
      const s = stats.get(w)!;
      s.held = s.lots.reduce((a, l) => a + l.qty, 0n);
      const openCost = s.lots.reduce((a, l) => a + l.cost, 0n);
      const currentValue = floor ? s.held * floor.floorPriceWei : 0n;
      const unrealized = floor ? currentValue - openCost : 0n;
      return {
        wallet: s.wallet,
        minted: s.minted.toString(),
        bought: s.bought.toString(),
        sold: s.sold.toString(),
        held: s.held.toString(),
        spentWei: s.spent.toString(),
        receivedWei: s.received.toString(),
        realizedPnlWei: s.realized.toString(),
        realizedPnlPct: s.spent > 0n ? Number((s.realized * 10000n) / s.spent) / 100 : null,
        openCostWei: openCost.toString(),
        currentValueWei: floor ? currentValue.toString() : null,
        unrealizedPnlWei: floor ? unrealized.toString() : null,
        unrealizedPnlPct: floor && openCost > 0n ? Number((unrealized * 10000n) / openCost) / 100 : null,
      };
    });

    const sum = (f: (r: typeof rows[0]) => bigint) => rows.reduce((a, r) => a + f(r), 0n);
    const totalSpent = sum((r) => BigInt(r.spentWei));
    const totalReceived = sum((r) => BigInt(r.receivedWei));
    const totalRealized = sum((r) => BigInt(r.realizedPnlWei));
    const totalOpenCost = sum((r) => BigInt(r.openCostWei));
    const totalCurrentValue = rows.reduce((a, r) => a + BigInt(r.currentValueWei || "0"), 0n);
    const totalUnrealized = floor ? totalCurrentValue - totalOpenCost : 0n;

    const payload = {
      chainId,
      contract,
      name,
      symbol,
      standard,
      fromBlock: fromB,
      toBlock: toB,
      truncated,
      source: bs ? "blockscout" : "rpc",
      floor: floor ? {
        slug: floor.slug,
        priceWei: floor.floorPriceWei.toString(),
        price: floor.floorPrice,
        symbol: floor.symbol,
      } : null,
      wallets: rows,
      totals: {
        walletCount: rows.length,
        minted: sum((r) => BigInt(r.minted)).toString(),
        bought: sum((r) => BigInt(r.bought)).toString(),
        sold: sum((r) => BigInt(r.sold)).toString(),
        held: sum((r) => BigInt(r.held)).toString(),
        spentWei: totalSpent.toString(),
        receivedWei: totalReceived.toString(),
        realizedPnlWei: totalRealized.toString(),
        realizedPnlPct: totalSpent > 0n ? Number((totalRealized * 10000n) / totalSpent) / 100 : null,
        openCostWei: totalOpenCost.toString(),
        currentValueWei: floor ? totalCurrentValue.toString() : null,
        unrealizedPnlWei: floor ? totalUnrealized.toString() : null,
        unrealizedPnlPct: floor && totalOpenCost > 0n ? Number((totalUnrealized * 10000n) / totalOpenCost) / 100 : null,
      },
    };
    botCache.set(cacheKey, { at: Date.now(), data: payload });
    return Response.json(payload, { headers: { "X-Flexinite-Cache": "MISS" } });
  } catch (e) {
    return Response.json(
      { error: "Bot PnL scan failed", detail: String((e as Error).message || e) },
      { status: 500 }
    );
  }
}
