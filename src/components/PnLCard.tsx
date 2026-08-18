"use client";

import { fmtWei, fmtInt, fmtPct, fmtDate } from "@/lib/format";

export interface CardStyle {
  accent: string;
  theme: "dark" | "light" | "gradient" | "holo" | "gold";
  bgMode?: "none" | "image" | "video";
  bgUrl?: string; // data URL or http URL for the art-window background
}

export const defaultCardStyle: CardStyle = { accent: "#f5b13d", theme: "holo", bgMode: "none" };

export interface CardData {
  wallet: string;
  chainLabel: string;
  chainLogo: string;
  symbol: string;
  spentWei: string;
  receivedWei: string;
  gasWei: string;
  realizedPnlWei: string;
  realizedPnlPct: number | null;
  mints: number;
  buys: number;
  sales: number;
  held: number;
  firstTs: number | null;
  lastTs: number | null;
  fromBlock: number;
  toBlock: number;
}

function Mark({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={color} />
      <path d="M17.8 4L7.5 18.2h6.2L12 28l10.5-14.2h-6.2z" fill="#141003" />
    </svg>
  );
}

// ---- theme palettes ----
function palette(theme: CardStyle["theme"], accent: string) {
  switch (theme) {
    case "light":
      return {
        innerBg: "#faf6ec",
        text: "#241f14",
        dim: "#7a7260",
        border: "rgba(60,45,10,.18)",
        artFallback: "linear-gradient(160deg,#efe6c8,#e2d3a0 60%,#d8c484)",
        frame: "linear-gradient(140deg,#e8d27f,#c9a945 30%,#f4e7ae 55%,#b98f2e 80%,#e8d27f)",
      };
    case "gold":
      return {
        innerBg: "linear-gradient(160deg,#221a08,#120d04 70%)",
        text: "#f6ead0",
        dim: "#b09a6a",
        border: "rgba(246,234,208,.16)",
        artFallback: `radial-gradient(120% 120% at 30% 20%, ${accent}44, transparent 60%), linear-gradient(160deg,#2a2008,#0e0a03)`,
        frame: "linear-gradient(140deg,#ffe9a8,#c9962e 28%,#fff3cf 52%,#9a6f1c 78%,#ffe9a8)",
      };
    case "holo":
      return {
        innerBg: "linear-gradient(165deg,#101426,#0a0d1c 60%,#131a33)",
        text: "#eef1ff",
        dim: "#8f97c9",
        border: "rgba(238,241,255,.14)",
        artFallback: `radial-gradient(130% 130% at 25% 15%, ${accent}55, transparent 55%), radial-gradient(120% 120% at 80% 85%, #5b8def44, transparent 60%), linear-gradient(160deg,#1a2044,#070a18)`,
        frame: "linear-gradient(140deg,#a8b6ff,#e6c7ff 22%,#8fe3ff 48%,#ffb3e6 74%,#fff3b0)",
      };
    case "gradient":
      return {
        innerBg: "linear-gradient(155deg,#12100a,#1a1509 55%,#0a0908)",
        text: "#f4f2ee",
        dim: "#94918a",
        border: "rgba(255,255,255,.1)",
        artFallback: `radial-gradient(120% 120% at 30% 20%, ${accent}33, transparent 60%), linear-gradient(160deg,#201a0e,#0a0908)`,
        frame: `linear-gradient(140deg,${accent},#6b5520 35%,${accent} 60%,#3d3010 85%,${accent})`,
      };
    default: // dark
      return {
        innerBg: "#0b0a08",
        text: "#f4f2ee",
        dim: "#94918a",
        border: "rgba(255,255,255,.1)",
        artFallback: "linear-gradient(160deg,#1c1710,#0b0a08)",
        frame: "linear-gradient(140deg,#57503f,#2e2a1e 40%,#6b6350 65%,#211d14)",
      };
  }
}

export default function PnLCard({ data, style }: { data: CardData; style: CardStyle }) {
  const pnl = BigInt(data.realizedPnlWei || "0");
  const isUp = pnl > 0n;
  const isDown = pnl < 0n;
  const pnlColor = isUp ? "#2fbf71" : isDown ? "#ef5350" : "#94918a";
  const accent = style.accent;
  const p = palette(style.theme, accent);
  const hasCustomBg = style.bgMode !== "none" && !!style.bgUrl;

  const rows: Array<{ icon: string; label: string; value: string }> = [
    { icon: "🔥", label: "Spent", value: `${fmtWei(data.spentWei)} ${data.symbol}` },
    { icon: "💰", label: "Received", value: `${fmtWei(data.receivedWei)} ${data.symbol}` },
    { icon: "🎯", label: "Mints / Buys / Sales", value: `${fmtInt(data.mints)} / ${fmtInt(data.buys)} / ${fmtInt(data.sales)}` },
    { icon: "💎", label: "Held", value: fmtInt(data.held) },
  ];
  if (data.gasWei && data.gasWei !== "0") {
    rows.push({ icon: "⛽", label: "Gas", value: `${fmtWei(data.gasWei)} ${data.symbol}` });
  }

  const flavor = [
    data.firstTs ? `first hunt ${fmtDate(data.firstTs)}` : null,
    data.lastTs ? `last hunt ${fmtDate(data.lastTs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        aspectRatio: "63 / 88", // Pokémon card ratio
        borderRadius: 20,
        padding: 12,
        background: p.frame,
        boxShadow: "0 14px 44px rgba(0,0,0,.55)",
        fontFamily: "Inter, system-ui, sans-serif",
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* holo shine sweep */}
      {style.theme === "holo" && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 5,
            background:
              "linear-gradient(115deg, transparent 20%, rgba(255,255,255,.16) 36%, rgba(168,255,223,.14) 44%, rgba(255,182,255,.13) 52%, transparent 70%)",
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* inner card */}
      <div
        style={{
          height: "100%",
          borderRadius: 12,
          background: p.innerBg,
          color: p.text,
          border: `2px solid ${style.theme === "light" ? "rgba(60,45,10,.25)" : "rgba(0,0,0,.5)"}`,
          display: "flex",
          flexDirection: "column",
          padding: "10px 12px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {/* header: name + HP-style badge */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Mark color={accent} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                FLEXINITE · PNL
              </div>
              <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: p.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {data.wallet}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
              background: "#ffd23f",
              color: "#3d2c00",
              fontWeight: 900,
              fontSize: 12,
              padding: "3px 10px",
              borderRadius: 999,
              border: "2px solid #b8860b",
              boxShadow: "inset 0 -2px 0 rgba(0,0,0,.18)",
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: 1, fontWeight: 800 }}>PNL</span>
            {fmtPct(data.realizedPnlPct)}
          </div>
        </div>

        {/* art window */}
        <div
          data-art
          style={{
            marginTop: 8,
            height: "38%",
            borderRadius: 10,
            border: `3px solid ${style.theme === "light" ? "rgba(60,45,10,.3)" : "rgba(255,255,255,.14)"}`,
            background: p.artFallback,
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "relative",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {hasCustomBg && style.bgMode === "image" && (
            <img
              src={style.bgUrl}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          {hasCustomBg && style.bgMode === "video" && (
            <video
              src={style.bgUrl}
              autoPlay
              muted
              loop
              playsInline
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          {/* scrim + big PnL */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(0,0,0,.05) 40%, rgba(0,0,0,.55))",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,.75)", fontWeight: 700 }}>
              Realized PnL
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 900,
                  color: "#fff",
                  textShadow: `0 2px 14px ${pnlColor}cc`,
                  lineHeight: 1.05,
                }}
              >
                {isUp ? "+" : ""}
                {fmtWei(pnl)} {data.symbol}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#fff",
                  background: pnlColor,
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {fmtPct(data.realizedPnlPct)}
              </span>
            </div>
          </div>
        </div>

        {/* stat rows */}
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5, flex: 1, minHeight: 0 }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                borderRadius: 8,
                background: style.theme === "light" ? "rgba(60,45,10,.06)" : "rgba(255,255,255,.05)",
                border: `1px solid ${p.border}`,
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{r.icon}</span>
              <span style={{ color: p.dim, flex: 1 }}>{r.label}</span>
              <span style={{ fontWeight: 700 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* footer: flavor text + set info */}
        <div style={{ marginTop: 8, flexShrink: 0 }}>
          {flavor && (
            <div style={{ fontSize: 9.5, fontStyle: "italic", color: p.dim, textAlign: "center", marginBottom: 5 }}>
              {flavor}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: `1px solid ${p.border}`,
              paddingTop: 5,
              fontSize: 8.5,
              color: p.dim,
            }}
          >
            <span>
              {data.chainLogo} {data.chainLabel}
              {data.toBlock > 0 ? ` · blocks ${data.fromBlock.toLocaleString()} → ${data.toBlock.toLocaleString()}` : ""}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 800, letterSpacing: 1.2 }}>
              ★ HOLO FLEX
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
