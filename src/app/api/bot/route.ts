import { NextRequest } from "next/server";
import { getChain } from "@/lib/chains";
import { ZERO_ADDR, resolveRpc, probeToken } from "@/lib/rpc";
import { resolveRange } from "@/lib/engine";
import { getBlockscout, bsTokenTransfers, bsTokenMeta, bsTxDetails } from "@/lib/blockscout";
import { rateLimited, clientIp, badRequest, tooMany } from "../_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_MOVES = 20000;
const MAX_WALLETS = 50;

interface Move { from: string; to: string; qty: bigint; tokenId: string; txHash: string }

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

  try {
    const chain = await getChain(chainId);
    const contract = contractRaw.toLowerCase();
    let rpc: string | null = null;
    try { rpc = await resolveRpc(chain); } catch { /* none */ }
    const bs = await getBlockscout(chain);

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

    // transfers
    let moves: Move[] = [];
    if (bs) {
      const { items: transfers, truncated: bsTruncated } = await bsTokenTransfers(
        bs, contract, fromB, 40, 2000, minTs
      );
      moves = transfers.map((t) => ({
        from: t.from, to: t.to,
        qty: t.standard === "721" ? 1n : t.amount,
        tokenId: t.tokenId, txHash: t.txHash,
      }));
      truncated = bsTruncated || transfers.length >= MAX_MOVES;
    } else if (rpc) {
      const { ERC721_TRANSFER_TOPIC, topicToAddress } = await import("@/lib/rpc");
      const { fetchRange, pool } = await import("@/lib/engine");
      const segs: Array<[number, number]> = [];
      for (let s = fromB; s <= toB; s += 30000) segs.push([s, Math.min(s + 29999, toB)]);
      const pages = await pool(segs, 10, ([s, e]) =>
        fetchRange(rpc!, { address: contract, topics: [[ERC721_TRANSFER_TOPIC]] }, s, e)
      );
      for (const logs of pages) {
        for (const l of logs) {
          if (!l.topics || l.topics.length < 3) continue;
          moves.push({ from: topicToAddress(l.topics[1]), to: topicToAddress(l.topics[2]), qty: 1n, tokenId: BigInt(l.topics[2] || "0x0").toString(), txHash: l.transactionHash });
          if (moves.length > MAX_MOVES) break;
        }
        if (moves.length > MAX_MOVES) break;
      }
    } else {
      return Response.json({ error: "No data source available for this chain" }, { status: 500 });
    }

    // tx value attribution
    const txValue = new Map<string, { qty: bigint; value: bigint }>();
    for (const mv of moves) {
      if (!txValue.has(mv.txHash)) txValue.set(mv.txHash, { qty: 0n, value: 0n });
      txValue.get(mv.txHash)!.qty += mv.qty;
    }
    if (bs) {
      const details = await bsTxDetails(bs, [...txValue.keys()], 400);
      for (const [h, d] of details) {
        const agg = txValue.get(h);
        if (agg) agg.value = d.valueWei;
      }
    } else if (rpc) {
      const { rpcCall } = await import("@/lib/rpc");
      const hashes = [...txValue.keys()].slice(0, 400);
      for (let i = 0; i < hashes.length; i += 10) {
        const batch = hashes.slice(i, i + 10);
        await Promise.all(batch.map(async (h) => {
          try {
            const tx = await rpcCall(rpc!, "eth_getTransactionByHash", [h]);
            if (tx?.value) txValue.get(h)!.value = BigInt(tx.value);
          } catch { /* ignore */ }
        }));
      }
    }
    const unitValue = (h: string): bigint => {
      const agg = txValue.get(h);
      if (!agg || agg.qty === 0n) return 0n;
      return agg.value / agg.qty;
    };

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

    for (const mv of moves) {
      if (mv.from === mv.to) continue;
      const sFrom = mv.from !== ZERO_ADDR ? stats.get(mv.from) : undefined;
      const sTo = stats.get(mv.to);
      const uv = unitValue(mv.txHash);
      if (sTo) {
        if (mv.from === ZERO_ADDR) sTo.minted += mv.qty;
        else sTo.bought += mv.qty;
        const cost = uv * mv.qty;
        sTo.spent += cost;
        sTo.lots.push({ qty: mv.qty, cost });
      }
      if (sFrom) {
        sFrom.sold += mv.qty;
        const rev = uv * mv.qty;
        sFrom.received += rev;
        let rem = mv.qty, costOut = 0n;
        while (rem > 0n && sFrom.lots.length) {
          const lot = sFrom.lots[0];
          const take = lot.qty < rem ? lot.qty : rem;
          costOut += lot.qty > 0n ? (lot.cost / lot.qty) * take : 0n;
          lot.qty -= take; rem -= take;
          if (lot.qty === 0n) sFrom.lots.shift();
        }
        sFrom.realized += rev - costOut;
      }
    }

    const rows = wallets.map((w) => {
      const s = stats.get(w)!;
      s.held = s.lots.reduce((a, l) => a + l.qty, 0n);
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
      };
    });

    const sum = (f: (r: typeof rows[0]) => bigint) => rows.reduce((a, r) => a + f(r), 0n);
    const totalSpent = sum((r) => BigInt(r.spentWei));
    const totalReceived = sum((r) => BigInt(r.receivedWei));
    const totalRealized = sum((r) => BigInt(r.realizedPnlWei));

    return Response.json({
      chainId,
      contract,
      name,
      symbol,
      standard,
      fromBlock: fromB,
      toBlock: toB,
      truncated,
      source: bs ? "blockscout" : "rpc",
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
      },
    });
  } catch (e) {
    return Response.json(
      { error: "Bot PnL scan failed", detail: String((e as Error).message || e) },
      { status: 500 }
    );
  }
}
