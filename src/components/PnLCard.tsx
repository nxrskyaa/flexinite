"use client";

import { fmtWei, fmtInt, fmtPct, fmtDate } from "@/lib/format";

export type CardCurrency = "native" | "usd" | "idr" | "escekek" | "cilok" | "telurgulung" | "nasirendang" | "naskuli";

const snackCurrencies: Record<"escekek" | "cilok" | "telurgulung" | "nasirendang" | "naskuli", { price: number; short: string; unit: string }> = {
  escekek: { price: 4000, short: "Es cekek", unit: "gelas es cekek" },
  cilok: { price: 1500, short: "Cilok", unit: "porsi cilok bojot aa" },
  telurgulung: { price: 2000, short: "Telur", unit: "tusuk telur gulung" },
  nasirendang: { price: 16000, short: "Naspad rendang", unit: "bungkus naspad rendang" },
  naskuli: { price: 10000, short: "Naspad kuli", unit: "bungkus naspad kuli" },
};

export interface CardStyle {
  accent: string;
  theme: "dark" | "light" | "gradient" | "holo" | "gold";
  currency?: CardCurrency;
  hideWallet?: boolean;
  username?: string;
  bgMode?: "none" | "image" | "video";
  bgUrl?: string;
  bgX?: number;
  bgY?: number;
  bgScale?: number;
  artOpacity?: number;
  effect?: "none" | "aurora" | "sunset" | "ocean" | "candy";
  frame?: "clean" | "editorial" | "vault" | "signal" | "gallery" | "collector";
}

export const defaultCardStyle: CardStyle = {
  accent: "#b99762",
  theme: "dark",
  currency: "native",
  hideWallet: false,
  username: "",
  bgMode: "none",
  bgX: 50,
  bgY: 50,
  bgScale: 100,
  artOpacity: 46,
  effect: "none",
  frame: "clean",
};

export interface CardData {
  wallet: string;
  projectName?: string;
  chainLabel: string;
  chainLogo: string;
  symbol: string;
  nativeUsd?: number | null;
  nativeIdr?: number | null;
  spentWei: string;
  receivedWei: string;
  gasWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
  pnlLabel?: string;
  mints: number;
  buys: number;
  sales: number;
  held: number;
  firstTs: number | null;
  lastTs: number | null;
  fromBlock: number;
  toBlock: number;
}

type Palette = {
  bg: string;
  surface: string;
  surfaceStrong: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  line: string;
};

function palette(theme: CardStyle["theme"], accent: string): Palette {
  switch (theme) {
    case "light":
      return {
        bg: "#f4f1eb",
        surface: "rgba(255,255,255,.58)",
        surfaceStrong: "#ebe6dc",
        text: "#242321",
        muted: "#716e68",
        faint: "#99948b",
        border: "rgba(36,35,33,.12)",
        line: "rgba(36,35,33,.08)",
      };
    case "gradient":
      return {
        bg: `linear-gradient(150deg,#151412 0%,#211d18 62%,${accent}26 100%)`,
        surface: "rgba(255,255,255,.045)",
        surfaceStrong: "rgba(255,255,255,.075)",
        text: "#f5f2ec",
        muted: "#aaa49a",
        faint: "#77736c",
        border: "rgba(255,255,255,.11)",
        line: "rgba(255,255,255,.07)",
      };
    case "holo":
      return {
        bg: "linear-gradient(150deg,#11151b 0%,#17202a 58%,#1d252b 100%)",
        surface: "rgba(216,229,238,.055)",
        surfaceStrong: "rgba(216,229,238,.085)",
        text: "#eef1f2",
        muted: "#9aa5aa",
        faint: "#66737a",
        border: "rgba(200,219,228,.12)",
        line: "rgba(200,219,228,.07)",
      };
    case "gold":
      return {
        bg: "linear-gradient(150deg,#1a1713 0%,#211b15 58%,#171411 100%)",
        surface: "rgba(199,168,119,.055)",
        surfaceStrong: "rgba(199,168,119,.09)",
        text: "#f2ede5",
        muted: "#aaa096",
        faint: "#756d65",
        border: "rgba(199,168,119,.14)",
        line: "rgba(199,168,119,.08)",
      };
    default:
      return {
        bg: "#171717",
        surface: "rgba(255,255,255,.045)",
        surfaceStrong: "rgba(255,255,255,.075)",
        text: "#f5f5f3",
        muted: "#a3a3a0",
        faint: "#696967",
        border: "rgba(255,255,255,.105)",
        line: "rgba(255,255,255,.065)",
      };
  }
}

function shortWallet(wallet: string) {
  if (!wallet.startsWith("0x") || wallet.length < 16) return wallet;
  return `${wallet.slice(0, 8)}…${wallet.slice(-6)}`;
}

function money(wei: string | bigint, data: CardData, currency: CardCurrency) {
  const amount = Number(BigInt(wei || "0")) / 1e18;
  if (currency in snackCurrencies && data.nativeIdr) {
    const snack = snackCurrencies[currency as keyof typeof snackCurrencies];
    return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount * data.nativeIdr / snack.price)} ${snack.unit}`;
  }
  if (currency === "usd" && data.nativeUsd) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount * data.nativeUsd);
  }
  if (currency === "idr" && data.nativeIdr) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount * data.nativeIdr);
  }
  return `${fmtWei(BigInt(wei || "0"))} ${data.symbol}`;
}

function BrandMark({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={color} />
      <path d="M17.8 4L7.5 18.2h6.2L12 28l10.5-14.2h-6.2z" fill="#141310" />
    </svg>
  );
}

export default function PnLCard({ data, style }: { data: CardData; style: CardStyle }) {
  const pnl = BigInt(data.realizedPnlWei || "0");
  const isUp = pnl > 0n;
  const isDown = pnl < 0n;
  const accent = style.accent || defaultCardStyle.accent;
  const p = palette(style.theme || "dark", accent);
  const currency = style.currency || "native";
  const needsIdr = currency === "idr" || currency in snackCurrencies;
  const displayCurrency = currency === "usd" && !data.nativeUsd ? "native" : needsIdr && !data.nativeIdr ? "native" : currency;
  const currencyLabel = displayCurrency in snackCurrencies ? snackCurrencies[displayCurrency as keyof typeof snackCurrencies].short : displayCurrency === "native" ? data.symbol : displayCurrency.toUpperCase();
  const statCurrency: CardCurrency = displayCurrency in snackCurrencies ? "idr" : displayCurrency;
  const pnlColor = isUp ? "#62aa83" : isDown ? "#c96f6f" : p.muted;
  const hasCustomBg = style.bgMode !== "none" && !!style.bgUrl;
  const activity = data.mints + data.buys + data.sales;
  const projectName = data.projectName?.trim() || "NFT Portfolio";
  const period = [data.firstTs ? fmtDate(data.firstTs) : null, data.lastTs ? fmtDate(data.lastTs) : null].filter(Boolean).join(" — ");
  const bgPosition = `${style.bgX ?? 50}% ${style.bgY ?? 50}%`;
  const bgScale = (style.bgScale ?? 100) / 100;
  const artOpacity = Math.min(85, Math.max(15, style.artOpacity ?? 46)) / 100;
  const artOverlay = style.theme === "light" ? `rgba(244,241,235,${Math.max(.18, .72 - artOpacity * .7)})` : `rgba(16,16,16,${Math.max(.18, .72 - artOpacity * .75)})`;
  const effect = style.effect || "none";
  const effectGradient = effect === "aurora" ? "radial-gradient(circle at 12% 88%, rgba(60,255,189,.34), transparent 42%), radial-gradient(circle at 92% 8%, rgba(111,111,255,.42), transparent 47%)" : effect === "sunset" ? "radial-gradient(circle at 6% 92%, rgba(255,79,111,.38), transparent 45%), radial-gradient(circle at 96% 4%, rgba(255,181,70,.42), transparent 48%)" : effect === "ocean" ? "radial-gradient(circle at 8% 86%, rgba(35,196,255,.36), transparent 45%), radial-gradient(circle at 92% 6%, rgba(97,71,255,.42), transparent 50%)" : effect === "candy" ? "radial-gradient(circle at 8% 88%, rgba(255,83,178,.35), transparent 43%), radial-gradient(circle at 94% 8%, rgba(110,198,255,.42), transparent 48%)" : "none";
  const username = style.username?.trim().replace(/^@+/, "");
  const frame = style.frame || "clean";
  const frameStyle = frame === "editorial"
    ? { border: `2px solid ${accent}`, borderRadius: 18, boxShadow: `inset 0 0 0 5px ${p.bg}, 0 24px 70px rgba(0,0,0,.38)` }
    : frame === "vault"
      ? { border: `1px solid ${accent}`, borderRadius: 8, boxShadow: `inset 0 0 0 1px ${p.border}, 0 24px 70px rgba(0,0,0,.38)` }
      : frame === "gallery"
        ? { border: `7px solid ${p.surfaceStrong}`, borderRadius: 15, boxShadow: `inset 0 0 0 1px ${accent}88, 0 24px 70px rgba(0,0,0,.42)` }
        : frame === "collector"
          ? { border: `2px solid ${accent}`, borderRadius: 22, boxShadow: `0 0 0 5px ${accent}30, 0 0 42px ${accent}88, inset 0 0 0 1px rgba(255,255,255,.30)` }
      : frame === "signal"
        ? { border: `1px solid ${p.border}`, borderRadius: 24, boxShadow: `inset 0 0 0 1px ${accent}44, 0 24px 70px rgba(0,0,0,.38)` }
        : { border: `1px solid ${p.border}`, borderRadius: 24, boxShadow: "0 24px 70px rgba(0,0,0,.38)" };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        aspectRatio: "4 / 5",
        background: p.bg,
        color: p.text,
        border: frameStyle.border,
        borderRadius: frameStyle.borderRadius,
        boxShadow: frameStyle.boxShadow,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        margin: "0 auto",
        padding: 24,
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div aria-hidden style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", right: -130, top: -145, background: accent, opacity: style.theme === "light" ? 0.09 : 0.1, filter: "blur(12px)" }} />
      {hasCustomBg && style.bgMode === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={style.bgUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: bgPosition, transform: `scale(${bgScale})`, transformOrigin: bgPosition, opacity: artOpacity }} />
      )}
      {hasCustomBg && style.bgMode === "video" && <video src={style.bgUrl} autoPlay muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: bgPosition, transform: `scale(${bgScale})`, transformOrigin: bgPosition, opacity: artOpacity }} />}
      {hasCustomBg && <div aria-hidden style={{ position: "absolute", inset: 0, background: artOverlay }} />}
      {effect !== "none" && <div aria-hidden style={{ position: "absolute", inset: -30, background: effectGradient, filter: "blur(18px)", mixBlendMode: "screen", opacity: hasCustomBg ? .8 : 1, pointerEvents: "none" }} />}
      {frame === "collector" && <><div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(118deg, rgba(255,255,255,.23) 0%, transparent 28%, transparent 66%, rgba(255,255,255,.12) 100%)", mixBlendMode: "screen", pointerEvents: "none" }} /><div aria-hidden style={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", right: -100, bottom: -105, background: accent, opacity: .24, filter: "blur(18px)" }} /></>}
      {frame === "signal" && <div aria-hidden style={{ position: "absolute", inset: 11, border: `1px solid ${accent}88`, borderRadius: 16, pointerEvents: "none" }} />}
      {frame === "vault" && <><div aria-hidden style={{ position: "absolute", top: 12, left: 12, width: 20, height: 20, borderTop: `2px solid ${accent}`, borderLeft: `2px solid ${accent}` }} /><div aria-hidden style={{ position: "absolute", right: 12, bottom: 12, width: 20, height: 20, borderRight: `2px solid ${accent}`, borderBottom: `2px solid ${accent}` }} /></>}
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <BrandMark color={accent} />
          <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: 2.1 }}>FLEXINITE</span>
        </div>
        <span style={{ border: `1px solid ${p.border}`, background: p.surface, color: p.muted, borderRadius: 999, padding: "5px 10px", fontSize: 10, fontWeight: 600 }}>
          {data.chainLabel}
        </span>
      </div>

      <div style={{ position: "relative", zIndex: 1, marginTop: 30 }}>
        <div style={{ color: p.faint, fontSize: 10, fontWeight: 650, letterSpacing: 1.6, textTransform: "uppercase" }}>Collection performance</div>
        <div style={{ marginTop: 6, fontSize: 24, lineHeight: 1.12, fontWeight: 600, letterSpacing: -0.55, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{projectName}</div>
        {!style.hideWallet && <div style={{ marginTop: 7, color: p.muted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }}>{shortWallet(data.wallet)}</div>}
        {username && <div style={{ marginTop: 7, color: accent, fontSize: 11, fontWeight: 650, letterSpacing: .15 }}>@{username}</div>}
      </div>

      <div style={{ position: "relative", zIndex: 1, marginTop: 24, padding: "20px 20px 18px", borderRadius: 18, background: p.surfaceStrong, border: `1px solid ${p.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ color: p.muted, fontSize: 10, fontWeight: 650, letterSpacing: 1.45, textTransform: "uppercase" }}>{data.pnlLabel || "Realized PnL"}</span>
          <span style={{ color: pnlColor, fontSize: 12, fontWeight: 650 }}>{fmtPct(data.realizedPnlPct)}</span>
        </div>
        <div style={{ color: pnlColor, fontSize: displayCurrency in snackCurrencies ? 21 : displayCurrency === "idr" ? 29 : 34, lineHeight: 1.06, fontWeight: 600, letterSpacing: displayCurrency in snackCurrencies ? -.5 : -1.2, whiteSpace: displayCurrency in snackCurrencies ? "normal" : "nowrap" }}>
          {isUp ? "+" : ""}{money(pnl, data, displayCurrency)}
        </div>
        {displayCurrency in snackCurrencies && <div style={{ marginTop: 7, color: p.faint, fontSize: 9.5, fontWeight: 600, letterSpacing: .55 }}>SIMULASI JAJAN · {currencyLabel}</div>}
        <div style={{ height: 3, borderRadius: 99, background: p.line, marginTop: 17, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, Math.max(8, Math.abs(data.realizedPnlPct || 0) / 3))}%`, height: "100%", borderRadius: 99, background: pnlColor }} />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        {[
          ["Invested", money(data.spentWei, data, statCurrency)],
          ["Received", money(data.receivedWei, data, statCurrency)],
          ["NFTs held", fmtInt(data.held)],
          ["Activity", `${fmtInt(activity)} tx`],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: "12px 13px", background: p.surface, border: `1px solid ${p.line}`, borderRadius: 13 }}>
            <div style={{ color: p.faint, fontSize: 9.5, fontWeight: 600, letterSpacing: .75, textTransform: "uppercase" }}>{label}</div>
            <div style={{ marginTop: 5, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ position: "relative", zIndex: 1, marginTop: "auto", borderTop: `1px solid ${p.line}`, paddingTop: 13, display: "flex", alignItems: "center", justifyContent: "space-between", color: p.faint, fontSize: 9.5 }}>
        <span>{period || `${fmtInt(data.mints)} mint · ${fmtInt(data.buys)} buy · ${fmtInt(data.sales)} sale`}</span>
        <span style={{ fontWeight: 650, letterSpacing: .7 }}>{currencyLabel}</span>
      </div>
      <div style={{ position: "relative", zIndex: 1, marginTop: 9, textAlign: "center", color: p.faint, fontSize: 9, letterSpacing: .8, fontWeight: 650 }}>FLEXINITE <span style={{ opacity: .65 }}>BY NXRLABS</span></div>
    </div>
  );
}
