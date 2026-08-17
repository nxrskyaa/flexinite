import { NextRequest } from "next/server";
import { getChain } from "@/lib/chains";
import { getNativeBalance, resolveRpc, ZERO_ADDR } from "@/lib/rpc";
import {
  resolveRange,
  fetchWalletEvents,
  buildWalletStats,
  type WalletScanResult,
} from "@/lib/engine";
import {
  getBlockscout,
  bsAddressTransfers,
  bsTxDetails,
} from "@/lib/blockscout";
import { rateLimited, clientIp, badRequest, tooMany } from "../_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

async function scanViaBlockscout(
  bs: string,
  wallet: string,
  chainId: number,
  fromBlock: number,
  toBlock: number,
  truncated: boolean,
  nativeBalanceWei: bigint,
  explorerSymbol: string
): Promise<WalletScanResult> {
  void explorerSymbol;
  const { items: transfers, truncated: bsTruncated } = await bsAddressTransfers(bs, wallet, fromBlock);

  // tx value/gas attribution
  const txs = await bsTxDetails(bs, transfers.map((t) => t.txHash));

  interface Lot { qty: bigint; unitCostWei: bigint }
  const positions = new Map<string, Lot[]>();
  const stats = new Map<
    string,
    WalletScanResult["tokens"][0] & { _events: number }
  >();
  let totalMints = 0, totalBuys = 0, totalSales = 0;
  let spent = 0n, received = 0n, gas = 0n;
  const wl = wallet.toLowerCase();
  const txTimestamps: Record<string, number> = {};

  // count events per tx for gas sharing
  const perTxCount = new Map<string, number>();
  for (const t of transfers) perTxCount.set(t.txHash, (perTxCount.get(t.txHash) || 0) + 1);

  for (const t of transfers) {
    if (t.from === wl && t.to === wl) continue;
    const k = `${t.contract}:${t.tokenId}`;
    let st = stats.get(k);
    if (!st) {
      st = {
        contract: t.contract,
        tokenId: t.tokenId,
        standard: t.standard,
        mints: 0, buys: 0, sales: 0, held: "0",
        spentWei: "0", receivedWei: "0", realizedPnlWei: "0",
        realizedPnlPct: null, avgBuyWei: null, avgSaleWei: null,
        eventsCount: 0, _events: 0,
      };
      stats.set(k, st);
      positions.set(k, []);
    }
    st.eventsCount++;
    const lots = positions.get(k)!;
    const qty = t.standard === "721" ? 1n : t.amount;
    const tx = txs.get(t.txHash);
    const txValue = tx?.valueWei ?? 0n;
    const gasShare = tx?.gasUsedWei !== null && tx?.gasUsedWei !== undefined
      ? tx.gasUsedWei / BigInt(perTxCount.get(t.txHash) || 1)
      : 0n;

    if (t.to === wl) {
      const isMint = t.from === ZERO_ADDR;
      if (isMint) { st.mints += Number(qty); totalMints += Number(qty); }
      else { st.buys += Number(qty); totalBuys += Number(qty); }
      const unitCost = txValue > 0n
        ? txValue / qty + gasShare / qty
        : gasShare > 0n ? gasShare / qty : 0n;
      lots.push({ qty, unitCostWei: unitCost });
      if (txValue > 0n) {
        st.spentWei = (BigInt(st.spentWei) + txValue).toString();
        spent += txValue;
      }
      if (gasShare > 0n) {
        st.spentWei = (BigInt(st.spentWei) + gasShare).toString();
        gas += gasShare;
      }
    } else if (t.from === wl) {
      st.sales += Number(qty);
      totalSales += Number(qty);
      st.receivedWei = (BigInt(st.receivedWei) + txValue).toString();
      received += txValue;
      if (gasShare > 0n) gas += gasShare;
      let rem = qty, costOut = 0n;
      while (rem > 0n && lots.length) {
        const lot = lots[0];
        const take = lot.qty < rem ? lot.qty : rem;
        costOut += take * lot.unitCostWei;
        lot.qty -= take; rem -= take;
        if (lot.qty === 0n) lots.shift();
      }
      st.realizedPnlWei = (BigInt(st.realizedPnlWei) + txValue - costOut).toString();
    }
    if (tx?.timestamp) txTimestamps[t.txHash] = tx.timestamp;
  }

  let heldTokens = 0;
  for (const st of stats.values()) {
    const lots = positions.get(`${st.contract}:${st.tokenId}`)!;
    const heldBig = lots.reduce((a, l) => a + l.qty, 0n);
    st.held = heldBig.toString();
    if (heldBig > 0n) heldTokens++;
    const sp = BigInt(st.spentWei);
    if (sp > 0n) st.realizedPnlPct = Number((BigInt(st.realizedPnlWei) * 10000n) / sp) / 100;
    if (st.buys > 0 && sp > 0n) st.avgBuyWei = (sp / BigInt(st.buys)).toString();
    if (st.sales > 0) st.avgSaleWei = (BigInt(st.receivedWei) / BigInt(st.sales)).toString();
  }

  const realizedTotal = [...stats.values()].reduce((a, s) => a + BigInt(s.realizedPnlWei), 0n);
  const tokens = [...stats.values()]
    .map(({ _events, ...rest }) => {
      void _events;
      return rest;
    })
    .sort((a, b) => {
      const pa = BigInt(a.realizedPnlWei), pb = BigInt(b.realizedPnlWei);
      return pa === pb ? 0 : pa > pb ? -1 : 1;
    })
    .slice(0, 200);

  return {
    wallet,
    chainId,
    fromBlock,
    toBlock,
    truncated: truncated || bsTruncated,
    nativeBalanceWei: nativeBalanceWei.toString(),
    gasUsedWei: gas.toString(),
    tokens,
    totals: {
      nftsBought: totalBuys,
      nftsSold: totalSales,
      nftsMinted: totalMints,
      currentHeld: heldTokens,
      spentWei: spent.toString(),
      receivedWei: received.toString(),
      gasWei: gas.toString(),
      realizedPnlWei: realizedTotal.toString(),
      realizedPnlPct: spent > 0n ? Number((realizedTotal * 10000n) / spent) / 100 : null,
    },
    sampleTimestamps: txTimestamps,
  };
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip, 40)) return tooMany();

  const sp = req.nextUrl.searchParams;
  const wallet = sp.get("wallet")?.trim();
  const chainIdRaw = sp.get("chainId");
  const fromBlock = sp.get("fromBlock");
  const windowDays = sp.get("window");

  if (!wallet || !ADDR_RE.test(wallet)) return badRequest("Invalid wallet address");
  const chainId = parseInt(chainIdRaw || "1", 10);
  if (isNaN(chainId)) return badRequest("Invalid chainId");

  try {
    const T0 = Date.now();
    const step = (m: string) => console.error(`[scan] ${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`);
    step(`start wallet=${wallet} chain=${chainId}`);
    const chain = await getChain(chainId);
    step("chain loaded");

    // latest block + range (try rpc, fallback to blockscout blocks)
    let rpcUrl: string | null = null;
    let range: { fromBlock: number; toBlock: number; truncated: boolean };
    try {
      rpcUrl = await resolveRpc(chain);
      step(`rpc resolved ${rpcUrl}`);
      range = await resolveRange(rpcUrl, fromBlock, windowDays);
      step("range resolved via rpc");
    } catch (e) {
      step(`rpc failed: ${String((e as Error).message || e).slice(0, 80)}`);
      rpcUrl = null;
      range = { fromBlock: 0, toBlock: 0, truncated: false };
    }
    const bs = await getBlockscout(chain);
    step(`blockscout=${bs || "none"}`);
    if (!rpcUrl && bs) {
      const j = await fetch(`${bs}/api/v2/main-page/blocks`, {
        signal: AbortSignal.timeout(15000),
      }).then((r) => r.json()).catch(() => null);
      const latest = Array.isArray(j) && j[0]?.height ? Number(j[0].height) : NaN;
      if (!isNaN(latest)) {
        const days = windowDays ? parseFloat(windowDays) : 30;
        range = {
          fromBlock: Math.max(0, latest - Math.floor((days * 86400) / 12)),
          toBlock: latest,
          truncated: false,
        };
      }
    }
    if (!rpcUrl && !bs) {
      return Response.json(
        { error: "No RPC or explorer available for this chain" },
        { status: 500 }
      );
    }

    // Blockscout first (indexed, fast), RPC fallback
    if (bs) {
      try {
        let nativeBal = 0n;
        if (rpcUrl) {
          nativeBal = await getNativeBalance(rpcUrl, wallet).catch(() => 0n);
          step("native balance ok");
        }
        step("bs scan start");
        const result = await scanViaBlockscout(
          bs, wallet, chainId, range.fromBlock, range.toBlock, range.truncated, nativeBal, chain.symbol
        );
        step(`bs scan done tokens=${result.tokens.length}`);
        return Response.json(result);
      } catch (e) {
        step(`bs scan failed: ${String((e as Error).message || e).slice(0, 120)}`);
        if (!rpcUrl) throw new Error("Blockscout scan failed");
        // fall through to RPC path
      }
    }

    const events = await fetchWalletEvents(rpcUrl!, wallet, range.fromBlock, range.toBlock);
    const nativeBal = await getNativeBalance(rpcUrl!, wallet);
    const gasNative = events.reduce((a, e) => a + (e.gasUsedWei ?? 0n), 0n);
    const result = await buildWalletStats(
      wallet,
      chainId,
      rpcUrl!,
      events,
      range.fromBlock,
      range.toBlock,
      range.truncated,
      nativeBal,
      gasNative
    );
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: "Scan failed", detail: String((e as Error).message || e) },
      { status: 500 }
    );
  }
}
