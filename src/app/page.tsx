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
  fromBlock: number;
  toBlock: number;
  truncated: boolean;
  nativeBalanceWei: string;
  gasUsedWei: string;
  tokens: TokenStat[];
  totals: ScanTotals;
  sampleTimestamps: Record<string, number>;
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
}

interface BotResult {
  contract: string;
  name: string | null;
  symbol: string | null;
  standard: string;
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
  };
  wallets: BotRow[];
}

type Mode = "scan" | "contract" | "bot";
type Result =
  | { kind: "scan"; data: ScanResult; symbol: string }
  | { kind: "contract"; data: ContractResult }
  | { kind: "bot"; data: BotResult };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// ---------- helpers ----------

function parseWallets(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => ADDR_RE.test(t));
}

async function jfetch(url: string) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || j.detail || "Request failed");
  return j;
}

// ---------- component ----------

export default function Home() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<Mode>("scan");
  const [walletInput, setWalletInput] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [timeWindow, setTimeWindow] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [savedWallets, setSavedWallets] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [cardStyle, setCardStyle] = useState<CardStyle>(() => {
    if (typeof window !== "undefined") {
      try {
        const s = localStorage.getItem("pandaCardStyle");
        if (s) return JSON.parse(s);
      } catch { /* ignore */ }
    }
    return defaultCardStyle;
  });
  const [cardModal, setCardModal] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      .catch(() => setError("Failed to load chains"));
  }, []);

  // saved wallets
  useEffect(() => {
    try {
      const s = localStorage.getItem("pandaSavedWallets");
      if (s) setSavedWallets(JSON.parse(s));
    } catch { /* ignore */ }
  }, []);
  const persistWallets = useCallback((ws: string[]) => {
    setSavedWallets(ws);
    localStorage.setItem("pandaSavedWallets", JSON.stringify(ws));
  }, []);

  useEffect(() => {
    localStorage.setItem("pandaCardStyle", JSON.stringify(cardStyle));
  }, [cardStyle]);

  const addWallets = (ws: string[]) => {
    const merged = [...new Set([...savedWallets, ...ws])].slice(0, 200);
    persistWallets(merged);
  };

  const runScan = async (m: Mode) => {
    setError(null);
    if (!chain) return;
    const wallets = parseWallets(walletInput);
    const contract = contractInput.trim();

    if (m === "scan") {
      if (wallets.length === 0) return setError("Enter a valid wallet address (0x…)");
      const w = wallets[0];
      setLoading(true);
      setResult(null);
      try {
        const data = await jfetch(
          `/api/scan?wallet=${w}&chainId=${chain.chainId}&window=${timeWindow}`
        );
        addWallets([w]);
        setResult({ kind: "scan", data, symbol: chain.symbol });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    } else if (m === "contract") {
      if (!ADDR_RE.test(contract)) return setError("Enter a valid contract address");
      setLoading(true);
      setResult(null);
      try {
        const w = wallets[0];
        let url = `/api/contract?contract=${contract}&chainId=${chain.chainId}&window=${timeWindow}`;
        if (w) url += `&wallet=${w}`;
        const data = await jfetch(url);
        setResult({ kind: "contract", data });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    } else {
      if (!ADDR_RE.test(contract)) return setError("Enter a collection contract address for Bot PNL");
      if (wallets.length === 0) return setError("Enter one or more wallet addresses for Bot PNL");
      setLoading(true);
      setResult(null);
      try {
        const data = await jfetch(
          `/api/bot?contract=${contract}&wallets=${wallets.join(",")}&chainId=${chain.chainId}&window=${timeWindow}`
        );
        addWallets(wallets);
        setResult({ kind: "bot", data });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
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

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
  };

  const downloadCard = async () => {
    if (!cardRef.current) return;
    const url = await exportCard(cardRef.current, "panda-pnl-card.png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "panda-pnl-card.png";
    a.click();
  };

  // card data (best scan for card)
  const cardData = useMemo(() => {
    if (!result || result.kind !== "scan") return null;
    const d = result.data;
    const ts = Object.values(d.sampleTimestamps || {}).sort();
    const first = ts[0];
    const last = ts[ts.length - 1];
    return {
      wallet: d.wallet,
      chainLabel: chain?.label || chain?.name || `Chain ${d.chainId}`,
      chainLogo: chain?.logo || "Ξ",
      symbol: result.symbol,
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
  }, [result, chain]);

  return (
    <div className="relative z-10 min-h-screen">
      {/* header */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-5 py-3 border-b backdrop-blur-xl" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}>
        <div className="flex items-center gap-2.5 select-none cursor-default">
          <span className="text-2xl leading-none">🐼</span>
          <span className="font-extrabold tracking-widest text-lg">PANDAPNL</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost !py-1.5 !px-4 text-sm" onClick={() => { setResult(null); setMode("scan"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            Scans
          </button>
          <button
            className="btn btn-ghost !py-1.5 !px-3 text-sm"
            title="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <a className="btn btn-cyan !py-1.5 !px-4 text-sm no-underline" href="#scan">
            Scan now
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-20">
        {/* chain pills */}
        <div className="flex flex-wrap justify-center gap-2.5 mt-8">
          {chains.map((c) => (
            <button
              key={c.chainId}
              className={`chain-pill ${chain?.chainId === c.chainId ? "active" : ""}`}
              onClick={() => setChain(c)}
            >
              <span>{c.logo}</span>
              {c.label}
            </button>
          ))}
        </div>

        {/* 3-column zone */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_260px] gap-6 mt-8 items-start">
          {/* left card */}
          <aside className="panel p-5 hidden lg:block fade-in">
            <h3 className="font-bold text-base mb-1">Get more from every scan</h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
              Everything is computed on-chain, free, and private.
            </p>
            <ul className="space-y-3 text-sm">
              <li>
                <div className="font-semibold">📌 Save your wallets</div>
                <div style={{ color: "var(--text-dim)" }}>Stored locally — no retyping addresses</div>
              </li>
              <li>
                <div className="font-semibold">⚡ Fast scans</div>
                <div style={{ color: "var(--text-dim)" }}>Direct RPC reads, results in seconds</div>
              </li>
              <li>
                <div className="font-semibold">🎨 Your default PnL card</div>
                <div style={{ color: "var(--text-dim)" }}>Set your style once, reuse it</div>
              </li>
            </ul>
            <a href="#scan" className="btn btn-purple w-full justify-center mt-5 no-underline text-sm">
              Start scanning
            </a>
          </aside>

          {/* center hero + inputs */}
          <section id="scan" className="text-center fade-in">
            <div className="text-xs font-semibold tracking-[0.3em] uppercase mb-3" style={{ color: "var(--accent-2)" }}>
              Real-time on-chain PnL
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">
              Track your NFT <span className="grad-text">performance</span>
            </h1>
            <p className="mt-3 text-base max-w-xl mx-auto" style={{ color: "var(--text-dim)" }}>
              Paste any wallet. See exactly where you stand — buys, mints, fees, and realized profit.
            </p>

            {/* wallet input */}
            <div className="mt-7 max-w-2xl mx-auto">
              <div className="relative">
                <textarea
                  className="glow-input w-full px-6 py-4 pr-32 text-sm resize-none mono"
                  rows={walletInput.includes("\n") ? Math.min(5, walletInput.split("\n").length) : 1}
                  placeholder="0x… wallet address (paste multiple for Bot PNL)"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    className="btn btn-ghost !px-3 !py-1.5 text-xs"
                    title="Load wallets from .txt file"
                    onClick={() => fileRef.current?.click()}
                  >
                    📄 .txt
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
                <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                  <button className="chip" onClick={() => setShowSaved(!showSaved)}>
                    💾 Saved ({savedWallets.length})
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

              {/* contract input */}
              <input
                className="glow-input w-full px-6 py-3.5 mt-3 text-sm mono"
                placeholder="Collection contract address (required for Scan Contract & Bot PNL)"
                value={contractInput}
                onChange={(e) => setContractInput(e.target.value)}
              />

              {/* window selector */}
              <div className="mt-3 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
                Time window:
                <select
                  className="glow-input !rounded-lg px-2 py-1 text-xs"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value)}
                >
                  <option value="1">Last 24h</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                </select>
                {chain && (
                  <span className="hidden md:inline">
                    · chain: <b style={{ color: "var(--text)" }}>{chain.label}</b> · symbol: <b style={{ color: "var(--text)" }}>{chain.symbol}</b>
                  </span>
                )}
              </div>

              {/* action buttons */}
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button className="btn btn-cyan" disabled={loading} onClick={() => runScan("scan")}>
                  {loading && mode === "scan" ? <span className="spin" /> : "🔍"} Scan
                </button>
                <button className="btn btn-orange" disabled={loading} onClick={() => runScan("contract")}>
                  {loading && mode === "contract" ? <span className="spin" /> : "🔒"} Scan Contract
                </button>
                <button className="btn btn-purple" disabled={loading} onClick={() => runScan("bot")}>
                  {loading && mode === "bot" ? <span className="spin" /> : "🤖"} Bot PNL
                </button>
              </div>

              {error && (
                <div className="mt-4 text-sm panel px-4 py-3 inline-block neg">⚠ {error}</div>
              )}
            </div>

            {/* results */}
            <div className="mt-8 text-left">
              {loading && (
                <div className="panel p-10 text-center" style={{ color: "var(--text-dim)" }}>
                  <span className="spin mr-2 align-middle" /> Scanning on-chain activity… this can take 10–40s on busy chains.
                </div>
              )}

              {!loading && result?.kind === "scan" && (
                <ScanView
                  data={result.data}
                  symbol={result.symbol}
                  explorer={chain?.explorer || ""}
                  onCopy={copy}
                  onCard={(s) => { if (s) setCardStyle((prev) => ({ ...prev, ...s })); setCardModal(true); }}
                  cardAvailable={!!cardData}
                />
              )}
              {!loading && result?.kind === "contract" && (
                <ContractView data={result.data} symbol={chain?.symbol || "ETH"} />
              )}
              {!loading && result?.kind === "bot" && (
                <BotView data={result.data} symbol={chain?.symbol || "ETH"} />
              )}
              {!loading && !result && !error && (
                <div className="panel p-10 text-center" style={{ color: "var(--text-dim)" }}>
                  <div className="text-3xl mb-2">💎</div>
                  No scans yet — paste a wallet above and hit <b>Scan</b>.
                </div>
              )}
            </div>
          </section>

          {/* right card */}
          <aside className="panel p-5 hidden lg:block fade-in">
            <h3 className="font-bold text-base mb-3">How to use</h3>
            <div className="space-y-3">
              <div className="rounded-xl p-3 text-sm" style={{ background: "rgba(139,92,246,.08)", border: "1px solid var(--border)" }}>
                <b>1 · Wallet Scan</b>
                <div style={{ color: "var(--text-dim)" }}>Paste a wallet → full NFT PnL: mints, buys, sales, fees.</div>
              </div>
              <div className="rounded-xl p-3 text-sm" style={{ background: "rgba(251,146,60,.08)", border: "1px solid var(--border)" }}>
                <b>2 · Scan Contract</b>
                <div style={{ color: "var(--text-dim)" }}>Paste a collection address → holders, mints, supply, mint price.</div>
              </div>
              <div className="rounded-xl p-3 text-sm" style={{ background: "rgba(34,211,238,.08)", border: "1px solid var(--border)" }}>
                <b>3 · Bot PNL</b>
                <div style={{ color: "var(--text-dim)" }}>Multiple wallets + contract → side-by-side PnL for every wallet.</div>
              </div>
            </div>
          </aside>
        </div>

        {/* footer */}
        <footer className="mt-16 text-center text-xs" style={{ color: "var(--text-dim)" }}>
          PandaPnL · on-chain NFT performance scanner · data read directly from public RPCs · nothing is stored on our servers
        </footer>
      </main>

      {/* PnL card modal */}
      {cardModal && cardData && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.7)" }}
          onClick={() => setCardModal(false)}
        >
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div ref={cardRef}>
              <PnLCard data={cardData} style={cardStyle} />
            </div>
            <div className="panel p-4 mt-3">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>Accent:</span>
                {["#8b5cf6", "#22d3ee", "#fb923c", "#34d399", "#f472b6"].map((c) => (
                  <button
                    key={c}
                    className="w-6 h-6 rounded-full border-2"
                    style={{ background: c, borderColor: cardStyle.accent === c ? "#fff" : "transparent" }}
                    onClick={() => setCardStyle({ ...cardStyle, accent: c })}
                  />
                ))}
                <select
                  className="glow-input !rounded-lg px-2 py-1 text-xs ml-auto"
                  value={cardStyle.theme}
                  onChange={(e) => setCardStyle({ ...cardStyle, theme: e.target.value as CardStyle["theme"] })}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="gradient">Gradient</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-purple flex-1 justify-center text-sm" onClick={downloadCard}>
                  ⬇ Download PNG
                </button>
                <button className="btn btn-ghost text-sm" onClick={() => setCardModal(false)}>
                  Close
                </button>
              </div>
              <div className="text-[10px] mt-2" style={{ color: "var(--text-dim)" }}>
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
          <div className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{it.label}</div>
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
  onCopy: (t: string) => void;
  onCard: (s?: Partial<CardStyle>) => void;
  cardAvailable: boolean;
}) {
  const t = data.totals;
  const pnl = BigInt(t.realizedPnlWei || "0");
  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold">
          Wallet PnL — <span className="mono">{shortAddr(data.wallet, 10, 8)}</span>
        </h2>
        <button className="btn btn-cyan !py-1.5 text-sm" onClick={() => onCard()}>
          🎴 PnL Card
        </button>
      </div>

      {data.truncated && (
        <div className="panel px-4 py-2 mb-4 text-xs" style={{ color: "var(--accent-3)" }}>
          ⚠ Long history detected — showing the most recent ~150k blocks. Use a smaller time window for a full picture.
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
                      <a href={href} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--accent-2)" }}>
                        {shortAddr(tk.contract)} #{tk.tokenId}
                      </a>
                    ) : (
                      <span className="mono">{shortAddr(tk.contract)} #{tk.tokenId}</span>
                    )}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,.15)", color: "var(--accent)" }}>
                      {tk.standard === "721" ? "721" : "1155"}
                    </span>
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

function ContractView({ data, symbol }: { data: ContractResult; symbol: string }) {
  const w = data.wallet;
  return (
    <div className="fade-in">
      <h2 className="text-lg font-bold mb-4">
        Contract Scan — {data.name || data.symbol || shortAddr(data.contract)}
      </h2>

      {data.truncated && (
        <div className="panel px-4 py-2 mb-4 text-xs" style={{ color: "var(--accent-3)" }}>
          ⚠ Window limited — showing the most recent ~150k blocks of activity.
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

function BotView({ data, symbol }: { data: BotResult; symbol: string }) {
  const t = data.totals;
  return (
    <div className="fade-in">
      <h2 className="text-lg font-bold mb-1">
        Bot PNL — {data.name || data.symbol || shortAddr(data.contract)}
      </h2>
      <div className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
        {t.walletCount} wallets · {data.standard}
      </div>

      <StatCards
        items={[
          { label: "Total realized PnL", value: `${fmtWei(t.realizedPnlWei)} ${symbol} (${fmtPct(t.realizedPnlPct)})`, cls: pnlClass(t.realizedPnlWei) },
          { label: "Total spent", value: `${fmtWei(t.spentWei)} ${symbol}` },
          { label: "Total received", value: `${fmtWei(t.receivedWei)} ${symbol}` },
          { label: "Held by all wallets", value: fmtInt(t.held) },
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
