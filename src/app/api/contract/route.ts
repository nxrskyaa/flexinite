import { NextRequest } from "next/server";
import { getChain } from "@/lib/chains";
import {
  ZERO_ADDR,
  resolveRpc,
  probeToken,
  callView,
  fnSig,
  decodeUint,
} from "@/lib/rpc";
import { resolveRange } from "@/lib/engine";
import {
  getBlockscout,
  bsTokenTransfers,
  bsTokenMeta,
  bsTxDetails,
} from "@/lib/blockscout";
import { rateLimited, clientIp, badRequest, tooMany } from "../_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_MOVES = 20000;

interface Move { from: string; to: string; qty: bigint; tokenId: string; txHash: string }

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip, 30)) return tooMany();

  const sp = req.nextUrl.searchParams;
  const contractRaw = sp.get("contract")?.trim();
  const walletRaw = sp.get("wallet")?.trim() || null;
  const chainIdRaw = sp.get("chainId");
  const fromBlock = sp.get("fromBlock");
  const windowDays = sp.get("window");

  if (!contractRaw || !ADDR_RE.test(contractRaw)) return badRequest("Invalid contract address");
  const contract = contractRaw.toLowerCase();
  const chainId = parseInt(chainIdRaw || "1", 10);
  if (isNaN(chainId)) return badRequest("Invalid chainId");
  if (walletRaw && !ADDR_RE.test(walletRaw)) return badRequest("Invalid wallet address");

  try {
    const chain = await getChain(chainId);
    let rpc: string | null = null;
    try { rpc = await resolveRpc(chain); } catch { /* no rpc */ }
    const bs = await getBlockscout(chain);

    // meta: Blockscout preferred, RPC fallback
    let name: string | null = null, symbol: string | null = null, standard = "Unknown";
    let holdersFromIndex: number | null = null;
    if (bs) {
      const meta = await bsTokenMeta(bs, contract);
      name = meta.name;
      symbol = meta.symbol;
      if (meta.type) standard = meta.type.includes("1155") ? "ERC-1155" : meta.type.includes("721") ? "ERC-721" : meta.type;
      holdersFromIndex = meta.holders;
    }
    if ((!name || !symbol) && rpc) {
      const probed = await probeToken(rpc, contract);
      name = name || probed.name;
      symbol = symbol || probed.symbol;
      if (standard === "Unknown") standard = probed.is721 ? "ERC-721" : probed.is1155 ? "ERC-1155" : "Unknown";
    }

    // range + transfers: Blockscout preferred (time-window based)
    let moves: Move[] = [];
    let fromB = 0, toB = 0, truncated = false;
    let viaBlockscout = false;
    const txTimestamps = new Map<string, number>();
    const days = windowDays ? parseFloat(windowDays) : 30;
    const minTs = Math.floor(Date.now() / 1000) - Math.floor(days * 86400);

    if (bs) {
      // latest block via blockscout
      const j = await fetch(`${bs}/api/v2/main-page/blocks`, {
        signal: AbortSignal.timeout(15000),
      }).then((r) => r.json()).catch(() => null);
      const latest = Array.isArray(j) && j[0]?.height ? Number(j[0].height) : NaN;
      if (!isNaN(latest)) {
        toB = latest;
      } else if (rpc) {
        const range = await resolveRange(rpc, fromBlock, windowDays);
        fromB = range.fromBlock; toB = range.toBlock;
      }
      const { items: transfers, truncated: bsTruncated } = await bsTokenTransfers(
        bs, contract, fromB, 40, 2000, minTs
      );
      moves = transfers.map((t) => ({
        from: t.from, to: t.to, qty: t.standard === "721" ? 1n : t.amount, tokenId: t.tokenId, txHash: t.txHash,
      }));
      for (const t of transfers) if (t.timestamp) txTimestamps.set(t.txHash, t.timestamp);
      truncated = bsTruncated || transfers.length >= MAX_MOVES;
      viaBlockscout = true;
    }

    if (!viaBlockscout && rpc) {
      // RPC fallback: fetch logs directly
      const range = await resolveRange(rpc, fromBlock, windowDays);
      fromB = range.fromBlock; toB = range.toBlock; truncated = range.truncated;
      const { ERC721_TRANSFER_TOPIC, topicToAddress } = await import("@/lib/rpc");
      const { fetchRange, pool } = await import("@/lib/engine");
      const segs: Array<[number, number]> = [];
      for (let s = fromB; s <= toB; s += 30000) segs.push([s, Math.min(s + 29999, toB)]);
      const logsPages = await pool(segs, 10, ([s, e]) =>
        fetchRange(rpc!, { address: contract, topics: [[ERC721_TRANSFER_TOPIC]] }, s, e)
      );
      for (const logs of logsPages) {
        for (const l of logs) {
          if (!l.topics || l.topics.length < 4) continue;
          moves.push({
            from: topicToAddress(l.topics[1]),
            to: topicToAddress(l.topics[2]),
            qty: 1n,
            tokenId: BigInt(l.topics[3] || "0x0").toString(),
            txHash: l.transactionHash,
          });
          if (moves.length > MAX_MOVES) break;
        }
        if (moves.length > MAX_MOVES) break;
      }
    }

    if (!bs && !rpc) {
      return Response.json({ error: "No data source available for this chain" }, { status: 500 });
    }

    // ---- holders simulation within window ----
    const holdings = new Map<string, Map<string, bigint>>();
    const apply = (owner: string, tokenId: string, delta: bigint) => {
      if (owner === ZERO_ADDR) return;
      let m = holdings.get(owner);
      if (!m) { m = new Map(); holdings.set(owner, m); }
      const cur = (m.get(tokenId) || 0n) + delta;
      if (cur <= 0n) m.delete(tokenId);
      else m.set(tokenId, cur);
    };
    for (const mv of moves) {
      apply(mv.from, mv.tokenId, -mv.qty);
      apply(mv.to, mv.tokenId, mv.qty);
    }
    let holdersWindow = 0;
    for (const m of holdings.values()) if (m.size > 0) holdersWindow++;

    // ---- mint stats ----
    const minters = new Set<string>();
    const mintTxAgg = new Map<string, { qty: bigint; value: bigint }>();
    let mintCount = 0;
    for (const mv of moves) {
      if (mv.from === ZERO_ADDR) {
        mintCount++;
        minters.add(mv.to);
        const agg = mintTxAgg.get(mv.txHash) || { qty: 0n, value: 0n };
        agg.qty += mv.qty;
        mintTxAgg.set(mv.txHash, agg);
      }
    }
    // resolve mint tx values
    if (bs && mintTxAgg.size > 0) {
      const details = await bsTxDetails(bs, [...mintTxAgg.keys()], 300);
      for (const [h, d] of details) {
        const agg = mintTxAgg.get(h);
        if (agg) agg.value = d.valueWei;
      }
    } else if (rpc && mintTxAgg.size > 0) {
      const { rpcCall } = await import("@/lib/rpc");
      const hashes = [...mintTxAgg.keys()].slice(0, 300);
      for (let i = 0; i < hashes.length; i += 10) {
        const batch = hashes.slice(i, i + 10);
        await Promise.all(batch.map(async (h) => {
          try {
            const tx = await rpcCall(rpc!, "eth_getTransactionByHash", [h]);
            if (tx?.value) mintTxAgg.get(h)!.value = BigInt(tx.value);
          } catch { /* ignore */ }
        }));
      }
    }
    const priceCounts = new Map<string, number>();
    for (const { value, qty } of mintTxAgg.values()) {
      if (qty > 0n) {
        const unit = (value / qty).toString();
        priceCounts.set(unit, (priceCounts.get(unit) || 0) + 1);
      }
    }
    let mintPriceWei: string | null = null;
    let best = 0;
    for (const [p, c] of priceCounts) if (c > best) { best = c; mintPriceWei = p; }

    // ---- supply probes (RPC only, cheap) ----
    let totalSupply: string | null = null, maxSupply: string | null = null;
    if (rpc) {
      const ts = decodeUint(await callView(rpc, contract, fnSig("totalSupply()")));
      const ms = decodeUint(await callView(rpc, contract, fnSig("maxSupply()")));
      if (ts !== null) totalSupply = ts.toString();
      if (ms !== null) maxSupply = ms.toString();
    }

    // ---- optional wallet-in-collection stats ----
    let walletStats = null;
    if (walletRaw) {
      const w = walletRaw.toLowerCase();
      let spent = 0n, received = 0n;
      let bought = 0n, sold = 0n, minted = 0n, realized = 0n;
      const lots: { qty: bigint; cost: bigint }[] = [];
      for (const mv of moves) {
        if (mv.from === mv.to) continue;
        const agg = mintTxAgg.get(mv.txHash);
        const unit = agg && agg.qty > 0n ? agg.value / agg.qty : 0n;
        if (mv.to === w && mv.from !== w) {
          if (mv.from === ZERO_ADDR) minted += mv.qty;
          else bought += mv.qty;
          const cost = unit * mv.qty;
          spent += cost;
          lots.push({ qty: mv.qty, cost });
        } else if (mv.from === w && mv.to !== w) {
          sold += mv.qty;
          const rev = unit * mv.qty;
          received += rev;
          let rem = mv.qty, costOut = 0n;
          while (rem > 0n && lots.length) {
            const lot = lots[0];
            const take = lot.qty < rem ? lot.qty : rem;
            costOut += lot.qty > 0n ? (lot.cost / lot.qty) * take : 0n;
            lot.qty -= take; rem -= take;
            if (lot.qty === 0n) lots.shift();
          }
          realized += rev - costOut;
        }
      }
      const held = lots.reduce((a, l) => a + l.qty, 0n);
      walletStats = {
        wallet: walletRaw,
        held: held.toString(),
        bought: bought.toString(),
        sold: sold.toString(),
        minted: minted.toString(),
        spentWei: spent.toString(),
        receivedWei: received.toString(),
        gasWei: "0",
        realizedPnlWei: realized.toString(),
        realizedPnlPct: spent > 0n ? Number((realized * 10000n) / spent) / 100 : null,
        tokenIds: [...(holdings.get(w)?.keys() || [])].slice(0, 100),
      };
    }

    return Response.json({
      chainId,
      contract,
      name,
      symbol,
      standard,
      explorer: chain.explorer,
      fromBlock: fromB,
      toBlock: toB,
      truncated,
      source: bs ? "blockscout" : "rpc",
      transferCount: moves.length,
      holdersApprox: holdersFromIndex ?? holdersWindow,
      holdersWindow,
      mintCount,
      uniqueMinted: new Set(moves.filter((m) => m.from === ZERO_ADDR).map((m) => m.tokenId)).size,
      uniqueMinters: minters.size,
      mintPriceWei,
      totalSupply,
      maxSupply,
      wallet: walletStats,
    });
  } catch (e) {
    return Response.json(
      { error: "Contract scan failed", detail: String((e as Error).message || e) },
      { status: 500 }
    );
  }
}
