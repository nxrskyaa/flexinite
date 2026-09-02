"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  shortAddr,
  fmtWei,
  fmtInt,
  fmtPct,
  pnlClass,
  fmtDateTime,
} from "@/lib/format";
import PnLCard, { CardStyle, defaultCardStyle } from "@/components/PnLCard";
import { exportCard } from "@/lib/export";

// ---------- types ----------

interface Chain {
  chainId: number;
  name: string;
  label: string;
  symbol: string;
  logo: string;
  explorer: string;
  network?: "evm" | "solana";
}

interface TokenStat {
  contract: string;
  tokenId: string;
  standard: string;
  mints: number;
  buys: number;
  sales: number;
  held: string;
  spentWei: string;
  receivedWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
  avgBuyWei: string | null;
  avgSaleWei: string | null;
}

interface ScanTotals {
  nftsBought: number;
  nftsSold: number;
  nftsMinted: number;
  currentHeld: number;
  spentWei: string;
  receivedWei: string;
  gasWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
}

interface ScanResult {
  wallet: string;
  chainId: number;
  network?: string;
  fromBlock: number;
  toBlock: number;
  truncated: boolean;
  nativeBalanceWei: string;
  gasUsedWei: string;
  tokens: TokenStat[];
  totals: ScanTotals;
  sampleTimestamps: Record<string, number>;
}

interface SolanaScanResult {
  wallet: string;
  truncated: boolean;
  nativeBalanceWei: string;
  signatureCount: number;
  sampled: number;
  netWei: string;
  feesWei: string;
  nftMoves: number;
  nftCollections: number;
  uniqueNfts: string[];
  firstTs: number | null;
  lastTs: number | null;
}

interface ContractResult {
  contract: string;
  name: string | null;
  symbol: string | null;
  standard: string;
  explorer: string;
  fromBlock: number;
  toBlock: number;
  truncated: boolean;
  transferCount: number;
  holdersApprox: number;
  mintCount: number;
  uniqueMinted: number;
  uniqueMinters: number;
  mintPriceWei: string | null;
  totalSupply: string | null;
  maxSupply: string | null;
  wallet: {
    wallet: string;
    held: string;
    bought: string;
    sold: string;
    minted: string;
    spentWei: string;
    receivedWei: string;
    realizedPnlWei: string;
    realizedPnlPct: number | null;
    tokenIds: string[];
  } | null;
}

interface BotRow {
  wallet: string;
  minted: string;
  bought: string;
  sold: string;
  held: string;
  spentWei: string;
  receivedWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
  openCostWei: string;
  currentValueWei: string | null;
  unrealizedPnlWei: string | null;
  unrealizedPnlPct: number | null;
}

interface BotResult {
  contract: string;
  name: string | null;
  symbol: string | null;
  standard: string;
  floor: { slug: string; priceWei: string; price: number; symbol: string } | null;
  totals: {
    walletCount: number;
    minted: string;
    bought: string;
    sold: string;
    held: string;
    spentWei: string;
    receivedWei: string;
    realizedPnlWei: string;
    realizedPnlPct: number | null;
    openCostWei: string;
    currentValueWei: string | null;
    unrealizedPnlWei: string | null;
    unrealizedPnlPct: number | null;
  };
  wallets: BotRow[];
}

interface ResolvedLink {
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
  hint?: string;
}

type Mode = "wallet" | "collection" | "bot";
type Result =
  | { kind: "scan"; data: ScanResult; symbol: string }
  | { kind: "solana"; data: SolanaScanResult }
  | { kind: "contract"; data: ContractResult }
  | { kind: "bot"; data: BotResult };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BOT_RESULT_CACHE_PREFIX = "flexiniteBotResult:";
const BOT_RESULT_CACHE_MS = 10 * 60 * 1000;

// ---------- helpers ----------

function parseWallets(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => ADDR_RE.test(t) || SOL_RE.test(t));
}

function isOpensea(text: string): boolean {
  return /opensea\.io/i.test(text);
}

function mergeBotBatches(parts: BotResult[]): BotResult {
  if (parts.length === 0) throw new Error("No Bot PNL results");
  const first = parts[0];
  const wallets = parts.flatMap((part) => part.wallets);
  const sum = (key: keyof BotRow) => wallets.reduce((total, row) => total + BigInt(String(row[key] ?? "0")), 0n).toString();
  const spent = BigInt(sum("spentWei"));
  const realized = BigInt(sum("realizedPnlWei"));
  const openCost = BigInt(sum("openCostWei"));
  const hasFloor = first.floor !== null;
  const current = hasFloor ? BigInt(sum("currentValueWei")) : null;
  const unrealized = current === null ? null : current - openCost;
  return {
    ...first,
    wallets,
    totals: {
      walletCount: wallets.length,
      minted: sum("minted"), bought: sum("bought"), sold: sum("sold"), held: sum("held"),
      spentWei: spent.toString(), receivedWei: sum("receivedWei"), realizedPnlWei: realized.toString(),
      realizedPnlPct: spent > 0n ? Number((realized * 10000n) / spent) / 100 : null,
      openCostWei: openCost.toString(), currentValueWei: current?.toString() ?? null,
      unrealizedPnlWei: unrealized?.toString() ?? null,
      unrealizedPnlPct: unrealized !== null && openCost > 0n ? Number((unrealized * 10000n) / openCost) / 100 : null,
    },
  };
}

async function jfetch(url: string) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.detail || j.error || "Request failed");
  return j;
}

function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block" }}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M17.8 4L7.5 18.2h6.2L12 28l10.5-14.2h-6.2z" fill="#141003" />
    </svg>
  );
}

// ---------- component ----------

export default function Home() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<Mode>("wallet");
  const [walletInput, setWalletInput] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [timeWindow, setTimeWindow] = useState("30");
  const [loading, setLoading] = useState(false);
  const [botProgress, setBotProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [savedWallets, setSavedWallets] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [resolved, setResolved] = useState<ResolvedLink | null>(null);
  const [resolving, setResolving] = useState(false);
  const [cardStyle, setCardStyle] = useState<CardStyle>(() => {
    if (typeof window !== "undefined") {
      try {
        const s = localStorage.getItem("flexiniteCardStyle");
        if (s) {
          const saved = JSON.parse(s) as CardStyle;
          const legacyDefault = saved.theme === "holo" && saved.accent === "#f5b13d" && saved.currency === undefined;
          return legacyDefault ? defaultCardStyle : { ...defaultCardStyle, ...saved };
        }
      } catch { /* ignore */ }
    }
    return defaultCardStyle;
  });
  const [cardModal, setCardModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cardRates, setCardRates] = useState<{ usd: number | null; idr: number | null }>({ usd: null, idr: null });
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const profileFileRef = useRef<HTMLInputElement>(null);

  const symbol = chain?.symbol || "ETH";

  // theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // load chains
  useEffect(() => {
    fetch("/api/chains")
      .then((r) => r.json())
      .then((d) => {
        setChains(d.chains || []);
        if (d.chains?.length) setChain(d.chains[0]);
      })
      .catch(() => setError("Failed to load networks"));
  }, []);

  // saved wallets
  useEffect(() => {
    try {
      const s = localStorage.getItem("flexiniteSavedWallets");
      if (s) setSavedWallets(JSON.parse(s));
    } catch { /* ignore */ }
  }, []);
  const persistWallets = useCallback((ws: string[]) => {
    setSavedWallets(ws);
    localStorage.setItem("flexiniteSavedWallets", JSON.stringify(ws));
  }, []);

  useEffect(() => {
    localStorage.setItem("flexiniteCardStyle", JSON.stringify(cardStyle));
  }, [cardStyle]);

  useEffect(() => {
    if (!cardModal || !symbol) return;
    let active = true;
    fetch(`/api/rates?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (active) setCardRates({ usd: Number(d.usd) || null, idr: Number(d.idr) || null }); })
      .catch(() => { if (active) setCardRates({ usd: null, idr: null }); });
    return () => { active = false; };
  }, [cardModal, symbol]);

  const addWallets = (ws: string[]) => {
    const merged = [...new Set([...savedWallets, ...ws])].slice(0, 200);
    persistWallets(merged);
  };

  // resolve an OpenSea link (contract field or wallet field)
  const resolveLink = async (url: string): Promise<ResolvedLink | null> => {
    setResolving(true);
    setResolved(null);
    try {
      const d = await jfetch(`/api/resolve?input=${encodeURIComponent(url)}`);
      if (d.kind === "unknown") {
        setError(d.hint || "Could not resolve that OpenSea link.");
        return null;
      }
      setResolved(d);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setResolving(false);
    }
  };

  const pickChainById = (id: number | undefined) => {
    if (!id) return;
    const hit = chains.find((c) => c.chainId === id);
    if (hit) setChain(hit);
  };

  const runScan = async (m: Mode) => {
    setError(null);
    const rawWallet = walletInput.trim();
    const wallets = parseWallets(walletInput);
    const contractRaw = contractInput.trim();

    if (m === "wallet") {
      // OpenSea profile link as wallet input
      if (isOpensea(rawWallet)) {
        setLoading(true);
        const d = await resolveLink(rawWallet);
        if (!d) { setLoading(false); return; }
        if (d.kind === "wallet" && d.wallet && ADDR_RE.test(d.wallet)) {
          setWalletInput(d.wallet);
          // fall through with resolved wallet below
          return doEvmScan([d.wallet], m);
        }
        setError("That OpenSea profile link didn't resolve to a wallet address.");
        setLoading(false);
        return;
      }
      if (wallets.length === 0) return setError("Enter a wallet address (0x… or Solana base58) or an OpenSea profile link");
      const w = wallets[0];
      // auto-route Solana addresses
      if (SOL_RE.test(w)) {
        setLoading(true);
        setResult(null);
        try {
          const data = await jfetch(`/api/scan?wallet=${w}&chainId=900&window=${timeWindow}`);
          addWallets([w]);
          setResult({ kind: "solana", data });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setResult(null);
      return doEvmScan(wallets, m);
    }

    if (m === "collection") {
      setLoading(true);
      setResult(null);
      try {
        let contract = contractRaw;
        // OpenSea collection/asset link support
        if (isOpensea(contractRaw)) {
          const d = await resolveLink(contractRaw);
          if (!d) { setLoading(false); return; }
          if (d.kind === "collection" && d.contract) {
            contract = d.contract;
            pickChainById(d.chainId);
          } else if (d.kind === "asset" && d.contract) {
            contract = d.contract;
            if (d.chainId) pickChainById(d.chainId);
          } else if (d.kind === "wallet") {
            setError("That's a profile link — switch to Wallet Scan for wallets.");
            setLoading(false);
            return;
          } else {
            setError("That OpenSea link doesn't resolve to a collection contract.");
            setLoading(false);
            return;
          }
        }
        if (!ADDR_RE.test(contract)) { setError("Enter a collection contract address or OpenSea link"); setLoading(false); return; }
        if (!chain) { setError("Pick a network first"); setLoading(false); return; }
        const w = wallets[0];
        let url = `/api/contract?contract=${contract}&chainId=${chain.chainId}&window=${timeWindow}`;
        if (w && ADDR_RE.test(w)) url += `&wallet=${w}`;
        const data = await jfetch(url);
        setResult({ kind: "contract", data });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // bot
    setLoading(true);
    setResult(null);
    try {
      let contract = contractRaw;
      if (isOpensea(contractRaw)) {
        const d = await resolveLink(contractRaw);
        if (!d) { setLoading(false); return; }
        if ((d.kind === "collection" || d.kind === "asset") && d.contract) {
          contract = d.contract;
          if (d.chainId) pickChainById(d.chainId);
        } else {
          setError("That OpenSea link doesn't resolve to a collection contract.");
          setLoading(false);
          return;
        }
      }
      if (!ADDR_RE.test(contract)) { setError("Enter a collection contract address or OpenSea link for Bot PNL"); setLoading(false); return; }
      if (wallets.length === 0) { setError("Enter one or more wallet addresses for Bot PNL"); setLoading(false); return; }
      if (wallets.length > 50) { setError("Max 50 wallets per Bot PNL scan"); setLoading(false); return; }
      if (!chain) { setError("Pick a network first"); setLoading(false); return; }
      const cacheKey = `${BOT_RESULT_CACHE_PREFIX}${chain.chainId}:${contract.toLowerCase()}:${wallets.slice().sort().join(",")}:${timeWindow}`;
      try {
        const saved = sessionStorage.getItem(cacheKey);
        if (saved) {
          const cached = JSON.parse(saved) as { at: number; data: BotResult };
          if (Date.now() - cached.at < BOT_RESULT_CACHE_MS) setResult({ kind: "bot", data: cached.data });
        }
      } catch { /* cache is optional */ }
      // Robinhood RPC lifetime transfer queries reject larger parallel wallet
      // sets. Six wallets per request is the verified stable limit; aggregate
      // all chunks in the browser so a long bot list still completes.
      const batches: BotResult[] = [];
      const totalBatches = Math.ceil(wallets.length / 6);
      setBotProgress({ done: 0, total: totalBatches });
      for (let i = 0; i < wallets.length; i += 6) {
        const batch = wallets.slice(i, i + 6).filter((w) => ADDR_RE.test(w));
        let data: BotResult | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2 && !data; attempt++) {
          try {
            data = await jfetch(
              `/api/bot?contract=${contract}&wallets=${batch.join(",")}&chainId=${chain.chainId}&window=${timeWindow}`
            ) as BotResult;
          } catch (err) {
            lastError = err;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        if (!data) throw lastError;
        batches.push(data);
        setBotProgress({ done: batches.length, total: totalBatches });
      }
      const data = mergeBotBatches(batches);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })); } catch { /* cache is optional */ }
      addWallets(wallets);
      setResult({ kind: "bot", data });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBotProgress(null);
      setLoading(false);
    }
  };

  const doEvmScan = async (wallets: string[], m: Mode) => {
    void m;
    if (!chain) { setError("Pick a network first"); setLoading(false); return; }
    if (chain.network === "solana") { setError("Use a Solana address for the Solana network."); setLoading(false); return; }
    const w = wallets[0];
    if (!ADDR_RE.test(w)) { setError("Enter a valid EVM wallet address (0x…)"); setLoading(false); return; }
    setResult(null);
    try {
      const data = await jfetch(`/api/scan?wallet=${w}&chainId=${chain.chainId}&window=${timeWindow}`);
      addWallets([w]);
      setResult({ kind: "scan", data, symbol: chain.symbol });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ws = parseWallets(String(reader.result || ""));
      if (ws.length === 0) return setError("No valid addresses found in file");
      addWallets(ws);
      setWalletInput((prev) => {
        const existing = parseWallets(prev);
        return [...new Set([...existing, ...ws])].join("\n");
      });
    };
    reader.readAsText(f);
  };

  const downloadCard = async () => {
    if (!cardRef.current) return;
    const url = await exportCard(cardRef.current, "flexinite-pnl.png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "flexinite-pnl.png";
    a.click();
  };

  const copyCard = async () => {
    if (!cardRef.current) return;
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        filter: (el) => !(el instanceof HTMLElement && el.hasAttribute("data-no-export")),
      });
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not supported */ }
  };

  const onBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const isVideo = f.type.startsWith("video/");
    // keep under ~4MB for export reliability
    if (f.size > 6 * 1024 * 1024) {
      setError("Background file too large (max ~6MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setCardStyle((s) => ({ ...s, bgMode: isVideo ? "video" : "image", bgUrl: url }));
      setError(null);
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const onProfileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Profile must be an image"); return; }
    if (f.size > 2 * 1024 * 1024) { setError("Profile image too large (max 2MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => { setCardStyle((s) => ({ ...s, profileUrl: String(reader.result || "") })); setError(null); };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  // card data (wallet scan or bot PNL)
  const cardData = useMemo(() => {
    if (!result) return null;
    if (result.kind === "bot") {
      const d = result.data;
      const t = d.totals;
      return {
        wallet: t.walletCount === 1 ? d.wallets[0]?.wallet || d.contract : `${t.walletCount} wallets`,
        projectName: d.name || d.symbol || d.floor?.slug || shortAddr(d.contract),
        chainLabel: chain?.label || chain?.name || "Chain",
        chainLogo: chain?.logo || "◈",
        symbol: chain?.symbol || "ETH",
        nativeUsd: cardRates.usd,
        nativeIdr: cardRates.idr,
        spentWei: t.spentWei,
        receivedWei: t.receivedWei,
        gasWei: "0",
        realizedPnlWei: t.unrealizedPnlWei ?? t.realizedPnlWei,
        realizedPnlPct: t.unrealizedPnlPct ?? t.realizedPnlPct,
        pnlLabel: t.unrealizedPnlWei !== null ? "Unrealized PnL" : "Realized PnL",
        mints: Number(t.minted),
        buys: Number(t.bought),
        sales: Number(t.sold),
        held: Number(t.held),
        firstTs: null,
        lastTs: null,
        fromBlock: 0,
        toBlock: 0,
      };
    }
    if (result.kind !== "scan") return null;
    const d = result.data;
    const ts = Object.values(d.sampleTimestamps || {}).sort();
    const first = ts[0];
    const last = ts[ts.length - 1];
    return {
      wallet: d.wallet,
      projectName: "Wallet portfolio",
      chainLabel: chain?.label || chain?.name || `Chain ${d.chainId}`,
      chainLogo: chain?.logo || "Ξ",
      symbol: result.symbol,
      nativeUsd: cardRates.usd,
      nativeIdr: cardRates.idr,
      spentWei: d.totals.spentWei,
      receivedWei: d.totals.receivedWei,
      gasWei: d.totals.gasWei,
      realizedPnlWei: d.totals.realizedPnlWei,
      realizedPnlPct: d.totals.realizedPnlPct,
      mints: d.totals.nftsMinted,
      buys: d.totals.nftsBought,
      sales: d.totals.nftsSold,
      held: d.totals.currentHeld,
      firstTs: first || null,
      lastTs: last || null,
      fromBlock: d.fromBlock,
      toBlock: d.toBlock,
    };
  }, [result, chain, cardRates]);

  return (
    <div className="relative z-10 min-h-screen">
      {/* header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-5 md:px-8 py-3.5 border-b backdrop-blur-xl"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}
      >
        <div className="flex items-center gap-2.5 select-none cursor-default">
          <Mark size={26} />
          <span className="font-bold tracking-[0.18em] text-[15px]">FLEXINITE</span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            className="btn btn-ghost !py-1.5 !px-3 !text-[13px]"
            title="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <a className="btn btn-accent !py-1.5 !px-4 !text-[13px] no-underline" href="#scan">
            Scan now
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 md:px-8 pb-24">
        {/* hero */}
        <section className="pt-14 md:pt-20 text-center fade-in">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase px-3 py-1.5 rounded-full mb-5"
            style={{ border: "1px solid var(--border-strong)", color: "var(--accent)" }}>
            <span className="dot" style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)" }} />
            on-chain NFT performance
          </div>
          <h1 className="text-4xl md:text-[52px] font-extrabold leading-[1.08] tracking-tight max-w-3xl mx-auto">
            Know exactly where you stand — <span className="grad-text">every chain, every wallet</span>
          </h1>
          <p className="mt-4 text-[15px] md:text-base max-w-xl mx-auto" style={{ color: "var(--text-dim)" }}>
            Paste a wallet, a collection address, or an OpenSea link. Flexinite reads the chain directly
            and returns buys, mints, fees, and realized profit. No account, nothing stored.
          </p>
        </section>

        {/* network pills */}
        <div className="flex flex-wrap justify-center gap-2 mt-9">
          {chains.map((c) => (
            <button
              key={c.chainId}
              className={`pill ${chain?.chainId === c.chainId ? "active" : ""}`}
              onClick={() => setChain(c)}
            >
              <span className="mono text-xs">{c.logo}</span>
              {c.label}
            </button>
          ))}
        </div>

        {/* scanner card */}
        <section id="scan" className="mt-8 max-w-3xl mx-auto">
          <div className="panel p-5 md:p-6">
            {/* mode switch */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="seg">
                <button className={mode === "wallet" ? "active" : ""} onClick={() => { setMode("wallet"); setError(null); }}>
                  Wallet scan
                </button>
                <button className={mode === "collection" ? "active" : ""} onClick={() => { setMode("collection"); setError(null); }}>
                  Collection
                </button>
                <button className={mode === "bot" ? "active" : ""} onClick={() => { setMode("bot"); setError(null); }}>
                  Bot PNL
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
                window
                <select
                  className="input !rounded-lg px-2.5 py-1.5 text-xs !w-auto"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value)}
                >
                  <option value="1">24h</option>
                  <option value="7">7d</option>
                  <option value="30">30d</option>
                  <option value="90">90d</option>
                  <option value="365">1y</option>
                </select>
              </div>
            </div>

            {/* wallet input */}
            <div className="relative">
              <textarea
                className="input w-full px-4 py-3.5 pr-28 text-sm resize-none mono"
                rows={walletInput.includes("\n") ? Math.min(5, walletInput.split("\n").length) : 1}
                placeholder={mode === "bot" ? "0x… paste one wallet per line" : "0x… wallet, Solana address, or OpenSea profile link"}
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  className="btn btn-quiet !px-3 !py-1.5 !text-xs"
                  title="Load wallets from .txt file"
                  onClick={() => fileRef.current?.click()}
                >
                  .txt
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
                />
              </div>
            </div>

            {/* saved wallets chips */}
            {savedWallets.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button className="chip" onClick={() => setShowSaved(!showSaved)}>
                  Saved ({savedWallets.length})
                </button>
                {showSaved &&
                  savedWallets.map((w) => (
                    <span key={w} className="chip mono">
                      <span onClick={() => setWalletInput((p) => (p ? p + "\n" + w : w))} className="cursor-pointer">
                        {shortAddr(w)}
                      </span>
                      <span className="x cursor-pointer" onClick={() => persistWallets(savedWallets.filter((x) => x !== w))}>
                        ✕
                      </span>
                    </span>
                  ))}
              </div>
            )}

            {/* contract input (collection + bot modes) */}
            {mode !== "wallet" && (
              <input
                className="input w-full px-4 py-3.5 mt-3 text-sm mono"
                placeholder="Collection contract address or OpenSea collection link"
                value={contractInput}
                onChange={(e) => { setContractInput(e.target.value); setResolved(null); }}
              />
            )}

            {/* resolved opensea preview */}
            {resolved && (resolved.kind === "collection" || resolved.kind === "asset") && (
              <div className="mt-3 flex items-center gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}>
                {resolved.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolved.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {resolved.name || resolved.slug}
                    {resolved.kind === "asset" && resolved.tokenId ? ` #${resolved.tokenId}` : ""}
                  </div>
                  <div className="text-xs truncate mono" style={{ color: "var(--text-dim)" }}>
                    {resolved.contract && shortAddr(resolved.contract)} · {resolved.chainName || "—"}
                  </div>
                </div>
                {resolved.contracts && resolved.contracts.length > 1 && (
                  <div className="ml-auto flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
                    {resolved.contracts.slice(0, 3).map((c) => (
                      <button key={c.address} className="link-accent text-left bg-transparent border-0 p-0 cursor-pointer" onClick={() => { setContractInput(c.address); pickChainById(c.chainId); }}>
                        {c.chainName} · {shortAddr(c.address)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* run */}
            <div className="mt-4 flex items-center gap-3">
              <button
                className="btn btn-primary flex-1 md:flex-none md:!px-10 !py-3 !text-sm"
                disabled={loading || resolving}
                onClick={() => runScan(mode)}
              >
                {loading || resolving ? <span className="spin" /> : null}
                {resolving ? "Resolving…" : mode === "bot" && botProgress ? `Reading bots ${botProgress.done}/${botProgress.total}` : loading ? "Scanning…" : mode === "wallet" ? "Scan wallet" : mode === "collection" ? "Scan collection" : "Run Bot PNL"}
              </button>
              {chain && (
                <span className="text-xs hidden md:inline" style={{ color: "var(--text-dim)" }}>
                  network <b style={{ color: "var(--text)" }}>{chain.label}</b> · <b style={{ color: "var(--text)" }}>{chain.symbol}</b>
                </span>
              )}
            </div>

            {error && (
              <div className="mt-4 text-sm rounded-xl px-4 py-3" style={{ background: "rgba(239,83,80,.08)", border: "1px solid rgba(239,83,80,.25)", color: "var(--neg)" }}>
                {error}
              </div>
            )}
          </div>
        </section>

        {/* results */}
        <div className="mt-10">
          {loading && (
            <div className="panel p-10 text-center text-sm" style={{ color: "var(--text-dim)" }}>
              <span className="spin mr-2 align-middle" /> Reading on-chain activity… this can take 10–40s on busy chains.
            </div>
          )}

          {!loading && result?.kind === "scan" && (
            <ScanView
              data={result.data}
              symbol={result.symbol}
              explorer={chain?.explorer || ""}
              onCard={() => setCardModal(true)}
            />
          )}
          {!loading && result?.kind === "solana" && <SolanaView data={result.data} />}
          {!loading && result?.kind === "contract" && (
            <ContractView data={result.data} symbol={chain?.symbol || "ETH"} />
          )}
          {!loading && result?.kind === "bot" && (
            <BotView data={result.data} symbol={chain?.symbol || "ETH"} onCard={() => setCardModal(true)} />
          )}
          {!loading && !result && !error && (
            <div className="panel p-10 text-center text-sm" style={{ color: "var(--text-dim)" }}>
              <div className="mx-auto mb-3 w-9 h-9"><Mark size={36} /></div>
              No scans yet — paste a wallet or OpenSea link above and hit <b style={{ color: "var(--text)" }}>Scan</b>.
            </div>
          )}
        </div>

        {/* footer */}
        <footer className="mt-20 pt-6 text-center text-xs border-t" style={{ color: "var(--text-faint)", borderColor: "var(--border)" }}>
          Flexinite · on-chain NFT performance · data read directly from public RPCs and Blockscout · nothing stored on our servers
        </footer>
      </main>

      {/* PnL card modal */}
      {cardModal && cardData && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 overflow-y-auto"
          style={{ background: "rgba(0,0,0,.72)", backdropFilter: "blur(4px)" }}
          onClick={() => setCardModal(false)}
        >
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div ref={cardRef}>
              <PnLCard data={cardData} style={cardStyle} />
            </div>
            <div className="panel p-4 mt-3">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className="text-xs">
                  <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Card theme</span>
                  <select
                    className="input !rounded-lg px-2 py-2 text-xs w-full"
                    value={cardStyle.theme}
                    onChange={(e) => setCardStyle({ ...cardStyle, theme: e.target.value as CardStyle["theme"] })}
                  >
                    <option value="dark">Graphite</option>
                    <option value="light">Ivory</option>
                    <option value="holo">Midnight</option>
                    <option value="gold">Espresso</option>
                    <option value="gradient">Obsidian</option>
                  </select>
                </label>
                <div className="text-xs">
                  <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>PNL currency</span>
                  <div className="grid grid-cols-3 gap-1 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                    {([
                      ["native", symbol], ["usd", "USD"], ["idr", "IDR"],
                      ["escekek", "Es cekek"], ["cilok", "Cilok"], ["telurgulung", "Telur"],
                      ["nasirendang", "Naspad Rndg"], ["naskuli", "Naspad Kuli"], ["mbg", "Porsi MBG"],
                      ["robux", "Robux"],
                    ] as const).map(([currency, label]) => (
                      <button
                        key={currency}
                        className="py-2 text-[10px] font-semibold cursor-pointer border-0"
                        style={{
                          background: (cardStyle.currency || "native") === currency ? "var(--text)" : "var(--panel-2)",
                          color: (cardStyle.currency || "native") === currency ? "var(--bg)" : "var(--text-dim)",
                        }}
                        onClick={() => setCardStyle({ ...cardStyle, currency })}
                        title={currency === "robux" ? "Rp8 / Robux" : currency === "mbg" ? "Rp10.000 / porsi" : currency === "escekek" ? "Rp4.000 / gelas" : currency === "cilok" ? "Rp1.500 / porsi" : currency === "telurgulung" ? "Rp2.000 / tusuk" : currency === "nasirendang" ? "Rp16.000 / bungkus" : currency === "naskuli" ? "Rp10.000 / bungkus" : undefined}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>Mode PnL: Robux Rp8 · MBG Rp10rb · Es cekek Rp4rb · Cilok Rp1,5rb · Telur Rp2rb · Naspad rendang Rp16rb · Naspad kuli Rp10rb</div>
                  <div className="mt-3 text-xs"><span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Invested equivalent</span><div className="grid grid-cols-3 gap-1.5">{([ ["native", symbol], ["idr", "IDR"], ["kerbau", "Kerbau"], ["sapi", "Sapi"], ["kambing", "Kambing"], ["indomie", "Indomie"] ] as const).map(([investedCurrency, label]) => <button key={investedCurrency} className="rounded-lg px-1 py-2 text-[10px] font-semibold cursor-pointer" style={{ border: `1px solid ${(cardStyle.investedCurrency || "native") === investedCurrency ? cardStyle.accent : "var(--border)"}`, color: "var(--text-dim)" }} onClick={() => setCardStyle({ ...cardStyle, investedCurrency })}>{label}</button>)}</div><span className="block mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>Patokan: kerbau Rp30jt · sapi Rp25jt · kambing Rp2,5jt · Indomie Rp3,5rb</span></div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>Accent</span>
                {["#b99762", "#638c7b", "#687b9c", "#966f76", "#7b718f", "#ff6b8a", "#7c6cff", "#22b8a8", "#ff9f43", "#3b9cff", "#c779ff"].map((c) => (
                  <button
                    key={c}
                    aria-label={`Accent ${c}`}
                    className="w-6 h-6 rounded-full border-2 cursor-pointer"
                    style={{ background: c, borderColor: cardStyle.accent === c ? "var(--text)" : "transparent" }}
                    onClick={() => setCardStyle({ ...cardStyle, accent: c })}
                  />
                ))}
                <label className="ml-auto inline-flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--text-dim)" }}>
                  <input
                    type="checkbox"
                    checked={!!cardStyle.hideWallet}
                    onChange={(e) => setCardStyle({ ...cardStyle, hideWallet: e.target.checked })}
                  />
                  Hide wallet address
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                <div><span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Card font</span><div className="grid grid-cols-3 gap-1">{([ ["sans", "Modern"], ["serif", "Editorial"], ["mono", "Mono"] ] as const).map(([font, label]) => <button key={font} className="rounded-md py-2 text-[10px] cursor-pointer" style={{ border: `1px solid ${(cardStyle.font || "sans") === font ? cardStyle.accent : "var(--border)"}`, color: "var(--text-dim)" }} onClick={() => setCardStyle({ ...cardStyle, font })}>{label}</button>)}</div></div>
                <div><span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Logo / lockup</span><div className="grid grid-cols-3 gap-1">{([ ["mark", "Mark"], ["wordmark", "Word"], ["text", "FLXNITE"] ] as const).map(([brand, label]) => <button key={brand} className="rounded-md py-2 text-[10px] cursor-pointer" style={{ border: `1px solid ${(cardStyle.brand || "mark") === brand ? cardStyle.accent : "var(--border)"}`, color: "var(--text-dim)" }} onClick={() => setCardStyle({ ...cardStyle, brand })}>{label}</button>)}</div></div>
              </div>

              <div className="mb-3 text-xs">
                <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>PnL ink</span>
                <div className="grid grid-cols-5 gap-1.5">{([ ["neutral", "Neutral", "#e9e6df"], ["emerald", "Emerald", "#7fbf9a"], ["amber", "Amber", "#dfb770"], ["ice", "Ice", "#9bcde0"], ["rose", "Rose", "#d78392"] ] as const).map(([pnlTone, label, color]) => <button key={pnlTone} className="rounded-lg py-2 text-[10px] font-semibold cursor-pointer" style={{ border: `1px solid ${(cardStyle.pnlTone || "neutral") === pnlTone ? color : "var(--border)"}`, color }} onClick={() => setCardStyle({ ...cardStyle, pnlTone })}>{label}</button>)}</div>
              </div>

              <div className="mb-3 text-xs">
                <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Gradient / blur effect</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {([
                    ["none", "Plain"], ["aurora", "Aurora"], ["sunset", "Sunset"], ["ocean", "Ocean"], ["candy", "Candy"],
                  ] as const).map(([effect, label]) => (
                    <button key={effect} className="rounded-lg px-1 py-2 text-[10px] font-semibold cursor-pointer" style={{ border: `1px solid ${(cardStyle.effect || "none") === effect ? cardStyle.accent : "var(--border)"}`, background: effect === "none" ? "transparent" : effect === "aurora" ? "linear-gradient(135deg,#32d7ad,#6f6fff)" : effect === "sunset" ? "linear-gradient(135deg,#ff4f6f,#ffb546)" : effect === "ocean" ? "linear-gradient(135deg,#23c4ff,#6147ff)" : "linear-gradient(135deg,#ff53b2,#6ec6ff)", color: effect === "none" ? "var(--text-dim)" : "#fff" }} onClick={() => setCardStyle({ ...cardStyle, effect })}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 mb-3">
                <label className="text-xs">
                  <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Display name / username</span>
                  <input
                    className="input w-full px-3 py-2 text-xs"
                    placeholder="e.g. nxrskyaa (will show as @nxrskyaa)"
                    maxLength={32}
                    value={cardStyle.username || ""}
                    onChange={(e) => setCardStyle({ ...cardStyle, username: e.target.value })}
                  />
                </label>
                <div className="flex items-center gap-2 text-xs">
                  {cardStyle.profileUrl ? <img src={cardStyle.profileUrl} alt="Profile preview" className="w-8 h-8 rounded-full object-cover" style={{ border: `1px solid ${cardStyle.accent}` }} /> : <div className="w-8 h-8 rounded-full" style={{ border: "1px dashed var(--border)" }} />}
                  <button className="btn btn-ghost !py-1 text-xs" onClick={() => profileFileRef.current?.click()}>{cardStyle.profileUrl ? "Change profile" : "Add profile image"}</button>
                  {cardStyle.profileUrl && <button className="btn btn-ghost !py-1 text-xs" style={{ color: "var(--neg)" }} onClick={() => setCardStyle({ ...cardStyle, profileUrl: undefined })}>Remove</button>}
                  <input ref={profileFileRef} type="file" accept="image/*" className="hidden" onChange={onProfileUpload} />
                </div>
                <div className="text-xs">
                  <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Card finish</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([ ["matte", "Matte"], ["glossy", "Glossy"], ["holo3d", "Holo 3D ✦"] ] as const).map(([finish, label]) => <button key={finish} className="rounded-lg px-1 py-2 text-[10px] font-semibold cursor-pointer" style={{ border: `1px solid ${(cardStyle.finish || "matte") === finish ? cardStyle.accent : "var(--border)"}`, background: finish === "holo3d" ? "linear-gradient(135deg,#806cff,#4debd3)" : (cardStyle.finish || "matte") === finish ? "var(--panel-2)" : "transparent", color: finish === "holo3d" ? "#121212" : "var(--text-dim)" }} onClick={() => setCardStyle({ ...cardStyle, finish })}>{label}</button>)}
                  </div>
                </div>
                <div className="text-xs">
                  <span className="block mb-1.5" style={{ color: "var(--text-dim)" }}>Frame</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ["clean", "Clean"], ["editorial", "Edge"], ["vault", "Vault"],
                      ["signal", "Signal"], ["gallery", "Gallery"], ["collector", "Collector ✦"],
                    ] as const).map(([frame, label]) => (
                      <button
                        key={frame}
                        className="rounded-lg px-2 py-2 text-[10px] font-semibold cursor-pointer"
                        style={{ border: `1px solid ${cardStyle.frame === frame ? cardStyle.accent : "var(--border)"}`, background: cardStyle.frame === frame ? "var(--panel-2)" : "transparent", color: "var(--text-dim)" }}
                        onClick={() => setCardStyle({ ...cardStyle, frame })}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* custom art background */}
              <div className="rounded-xl p-3 mb-3" style={{ border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: "var(--text-dim)" }}>Card art</span>
                  <button className="btn btn-ghost !py-1 text-xs" onClick={() => bgFileRef.current?.click()}>
                    {cardStyle.bgMode === "none" ? "Upload image / video" : "Change art"}
                  </button>
                  {cardStyle.bgMode !== "none" && <button className="btn btn-ghost !py-1 text-xs" style={{ color: "var(--neg)" }} onClick={() => setCardStyle({ ...cardStyle, bgMode: "none", bgUrl: undefined })}>Remove</button>}
                  <input ref={bgFileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onBgUpload} />
                </div>
                {cardStyle.bgMode !== "none" && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    {([
                      ["Position X", "bgX", cardStyle.bgX ?? 50], ["Position Y", "bgY", cardStyle.bgY ?? 50], ["Zoom", "bgScale", cardStyle.bgScale ?? 100], ["Art visible", "artOpacity", cardStyle.artOpacity ?? 46],
                    ] as const).map(([label, key, value]) => (
                      <label key={key} className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                        <span className="flex justify-between mb-1"><span>{label}</span><b style={{ color: "var(--text-dim)" }}>{value}%</b></span>
                        <input className="w-full accent-current" style={{ accentColor: cardStyle.accent }} type="range" min={key === "bgScale" ? 100 : key === "artOpacity" ? 15 : 0} max={key === "bgScale" ? 180 : key === "artOpacity" ? 85 : 100} value={value} onChange={(e) => setCardStyle({ ...cardStyle, [key]: Number(e.target.value) })} />
                      </label>
                    ))}
                  </div>
                )}
                <div className="text-[10px] mt-2" style={{ color: "var(--text-faint)" }}>Naikin Art visible biar gambar tidak ketutup gelap. Collector pakai glossy highlight + glow ala kartu koleksi.</div>
              </div>

              <div className="flex gap-2">
                <button className="btn btn-accent flex-1 justify-center text-sm" onClick={downloadCard}>
                  Download PNG
                </button>
                <button className="btn btn-ghost text-sm" onClick={copyCard}>
                  {copied ? "Copied! ✓" : "Copy"}
                </button>
                <button className="btn btn-ghost text-sm" onClick={() => setCardModal(false)}>
                  Close
                </button>
              </div>
              <div className="text-[10px] mt-2" style={{ color: "var(--text-faint)" }}>
                Your card style is saved as default for next time.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- sub-views ----------

function StatCards({ items }: { items: { label: string; value: string; cls?: string }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {items.map((it) => (
        <div key={it.label} className="panel p-4">
          <div className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-faint)" }}>{it.label}</div>
          <div className={`text-lg font-bold ${it.cls || ""}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function ScanView({
  data,
  symbol,
  explorer,
  onCard,
}: {
  data: ScanResult;
  symbol: string;
  explorer: string;
  onCard: () => void;
}) {
  const t = data.totals;
  const pnl = BigInt(t.realizedPnlWei || "0");
  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold">
          Wallet PnL — <span className="mono text-base">{shortAddr(data.wallet, 10, 8)}</span>
        </h2>
        <button className="btn btn-ghost !py-1.5 text-sm" onClick={onCard}>
          PnL Card →
        </button>
      </div>

      {data.truncated && (
        <div className="panel px-4 py-2.5 mb-4 text-xs" style={{ color: "var(--accent)" }}>
          Long history detected — showing the most recent activity window. Use a smaller time window for a full picture.
        </div>
      )}

      <StatCards
        items={[
          { label: "Realized PnL", value: `${fmtWei(pnl)} ${symbol} (${fmtPct(t.realizedPnlPct)})`, cls: pnlClass(pnl) },
          { label: "Spent (buys + mints)", value: `${fmtWei(t.spentWei)} ${symbol}` },
          { label: "Received (sales)", value: `${fmtWei(t.receivedWei)} ${symbol}` },
          { label: "Est. gas spent", value: `${fmtWei(t.gasWei)} ${symbol}` },
        ]}
      />
      <StatCards
        items={[
          { label: "NFTs bought", value: fmtInt(t.nftsBought) },
          { label: "NFTs sold", value: fmtInt(t.nftsSold) },
          { label: "NFTs minted", value: fmtInt(t.nftsMinted) },
          { label: "Positions held", value: fmtInt(t.currentHeld) },
        ]}
      />

      <div className="panel overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Token</th>
              <th>Held</th>
              <th>Mints</th>
              <th>Buys</th>
              <th>Sales</th>
              <th>Avg buy</th>
              <th>Avg sale</th>
              <th>Spent</th>
              <th>Received</th>
              <th>Realized PnL</th>
            </tr>
          </thead>
          <tbody>
            {data.tokens.map((tk) => {
              const p = BigInt(tk.realizedPnlWei || "0");
              const href = explorer ? `${explorer.replace(/\/$/, "")}/token/${tk.contract}` : null;
              return (
                <tr key={`${tk.contract}:${tk.tokenId}`}>
                  <td>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="mono link-accent">
                        {shortAddr(tk.contract)} #{tk.tokenId}
                      </a>
                    ) : (
                      <span className="mono">{shortAddr(tk.contract)} #{tk.tokenId}</span>
                    )}
                    <span className="ml-2 tag">{tk.standard === "721" ? "721" : "1155"}</span>
                  </td>
                  <td>{fmtWei(tk.held, 0, 0)}</td>
                  <td>{tk.mints}</td>
                  <td>{tk.buys}</td>
                  <td>{tk.sales}</td>
                  <td>{tk.avgBuyWei ? `${fmtWei(tk.avgBuyWei)} ${symbol}` : "—"}</td>
                  <td>{tk.avgSaleWei ? `${fmtWei(tk.avgSaleWei)} ${symbol}` : "—"}</td>
                  <td>{fmtWei(tk.spentWei)} {symbol}</td>
                  <td>{fmtWei(tk.receivedWei)} {symbol}</td>
                  <td className={pnlClass(p)}>
                    {fmtWei(p)} ({fmtPct(tk.realizedPnlPct)})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.tokens.length === 0 && (
          <div className="p-6 text-center text-sm" style={{ color: "var(--text-dim)" }}>
            No NFT activity found for this wallet in the selected window.
          </div>
        )}
      </div>
    </div>
  );
}

function SolanaView({ data }: { data: SolanaScanResult }) {
  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold">
          Solana Activity — <span className="mono text-base">{shortAddr(data.wallet, 8, 6)}</span>
        </h2>
        <span className="tag">SOLANA · sampled {data.sampled}/{data.signatureCount} txs</span>
      </div>

      {data.truncated && (
        <div className="panel px-4 py-2.5 mb-4 text-xs" style={{ color: "var(--accent)" }}>
          Very active wallet — showing the {data.sampled} most recent transactions inside the window.
        </div>
      )}

      <StatCards
        items={[
          { label: "Net SOL flow", value: `${fmtWei(data.netWei)} SOL`, cls: pnlClass(data.netWei) },
          { label: "Transactions", value: fmtInt(data.signatureCount) },
          { label: "NFT-like transfers", value: fmtInt(data.nftMoves) },
          { label: "Distinct NFTs touched", value: fmtInt(data.nftCollections) },
        ]}
      />
      <StatCards
        items={[
          { label: "SOL balance", value: `${fmtWei(data.nativeBalanceWei)} SOL` },
          { label: "Est. fees", value: `${fmtWei(data.feesWei)} SOL` },
          { label: "First activity", value: data.firstTs ? fmtDateTime(data.firstTs) : "—" },
          { label: "Last activity", value: data.lastTs ? fmtDateTime(data.lastTs) : "—" },
        ]}
      />

      {data.uniqueNfts.length > 0 && (
        <div className="panel p-5">
          <h3 className="font-bold text-sm mb-3">NFT mints touched in window</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.uniqueNfts.map((m) => (
              <a key={m} className="chip mono no-underline" href={`https://solscan.io/token/${m}`} target="_blank" rel="noreferrer">
                {shortAddr(m, 6, 4)}
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs mt-3" style={{ color: "var(--text-faint)" }}>
        Solana scans read the public RPC directly — volume and NFT activity are sampled from recent transactions in the window.
      </div>
    </div>
  );
}

function ContractView({ data, symbol }: { data: ContractResult; symbol: string }) {
  const w = data.wallet;
  return (
    <div className="fade-in">
      <h2 className="text-lg font-bold mb-4">
        Collection — {data.name || data.symbol || shortAddr(data.contract)}
      </h2>

      {data.truncated && (
        <div className="panel px-4 py-2.5 mb-4 text-xs" style={{ color: "var(--accent)" }}>
          Window limited — showing the most recent activity only.
        </div>
      )}

      <StatCards
        items={[
          { label: "Standard", value: data.standard },
          { label: "Total supply", value: data.totalSupply !== null ? fmtInt(data.totalSupply) : "—" },
          { label: "Max supply", value: data.maxSupply !== null ? fmtInt(data.maxSupply) : "—" },
          { label: "Mint price (mode)", value: data.mintPriceWei ? `${fmtWei(data.mintPriceWei)} ${symbol}` : "—" },
        ]}
      />
      <StatCards
        items={[
          { label: "Transfers in window", value: fmtInt(data.transferCount) },
          { label: "Holders (in window)", value: `~${fmtInt(data.holdersApprox)}` },
          { label: "Mints", value: fmtInt(data.mintCount) },
          { label: "Unique minters", value: fmtInt(data.uniqueMinters) },
        ]}
      />

      {w && (
        <div className="panel p-5">
          <h3 className="font-bold mb-3">
            Your position — <span className="mono">{shortAddr(w.wallet, 10, 8)}</span>
          </h3>
          <StatCards
            items={[
              { label: "Realized PnL", value: `${fmtWei(w.realizedPnlWei)} ${symbol} (${fmtPct(w.realizedPnlPct)})`, cls: pnlClass(w.realizedPnlWei) },
              { label: "Held", value: fmtInt(w.held) },
              { label: "Bought / Minted / Sold", value: `${fmtInt(w.bought)} / ${fmtInt(w.minted)} / ${fmtInt(w.sold)}` },
              { label: "Spent → Received", value: `${fmtWei(w.spentWei)} → ${fmtWei(w.receivedWei)} ${symbol}` },
            ]}
          />
          {w.tokenIds.length > 0 && (
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              Token IDs held: <span className="mono">{w.tokenIds.join(", ")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BotView({ data, symbol, onCard }: { data: BotResult; symbol: string; onCard?: () => void }) {
  const t = data.totals;
  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold">
          Bot PNL — {data.name || data.symbol || shortAddr(data.contract)}
        </h2>
        {onCard && (
          <button className="btn btn-ghost text-sm !py-1.5" onClick={onCard}>
            PnL Card →
          </button>
        )}
      </div>
      <div className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
        {t.walletCount} wallets · {data.standard}
        {data.floor ? ` · floor ${data.floor.price} ${data.floor.symbol}` : " · floor unavailable"}
      </div>

      <StatCards
        items={[
          { label: "Unrealized PnL", value: t.unrealizedPnlWei !== null ? `${fmtWei(t.unrealizedPnlWei)} ${symbol} (${fmtPct(t.unrealizedPnlPct)})` : "Floor unavailable", cls: t.unrealizedPnlWei !== null ? pnlClass(t.unrealizedPnlWei) : "" },
          { label: "Current floor value", value: t.currentValueWei !== null ? `${fmtWei(t.currentValueWei)} ${symbol}` : "—" },
          { label: "Open cost basis", value: `${fmtWei(t.openCostWei)} ${symbol}` },
          { label: "Realized PnL", value: `${fmtWei(t.realizedPnlWei)} ${symbol} (${fmtPct(t.realizedPnlPct)})`, cls: pnlClass(t.realizedPnlWei) },
        ]}
      />

      <div className="panel overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Minted</th>
              <th>Bought</th>
              <th>Sold</th>
              <th>Held</th>
              <th>Spent</th>
              <th>Received</th>
              <th>Unrealized PnL</th>
              <th>Realized PnL</th>
            </tr>
          </thead>
          <tbody>
            {data.wallets
              .slice()
              .sort((a, b) => (BigInt(b.realizedPnlWei) > BigInt(a.realizedPnlWei) ? 1 : -1))
              .map((r) => {
                const p = BigInt(r.realizedPnlWei);
                return (
                  <tr key={r.wallet}>
                    <td className="mono">{shortAddr(r.wallet, 8, 6)}</td>
                    <td>{fmtInt(r.minted)}</td>
                    <td>{fmtInt(r.bought)}</td>
                    <td>{fmtInt(r.sold)}</td>
                    <td>{fmtInt(r.held)}</td>
                    <td>{fmtWei(r.spentWei)} {symbol}</td>
                    <td>{fmtWei(r.receivedWei)} {symbol}</td>
                    <td className={r.unrealizedPnlWei !== null ? pnlClass(r.unrealizedPnlWei) : ""}>
                      {r.unrealizedPnlWei !== null ? `${fmtWei(r.unrealizedPnlWei)} (${fmtPct(r.unrealizedPnlPct)})` : "—"}
                    </td>
                    <td className={pnlClass(p)}>{fmtWei(p)} ({fmtPct(r.realizedPnlPct)})</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
