"use client";

import { fmtWei, fmtInt, fmtPct, fmtDate } from "@/lib/format";

export interface CardStyle {
  accent: string;
  theme: "dark" | "light" | "gradient";
}

export const defaultCardStyle: CardStyle = { accent: "#f5b13d", theme: "dark" };

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
    <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={color} />
      <path d="M17.8 4L7.5 18.2h6.2L12 28l10.5-14.2h-6.2z" fill="#141003" />
    </svg>
  );
}

export default function PnLCard({ data, style }: { data: CardData; style: CardStyle }) {
  const pnl = BigInt(data.realizedPnlWei || "0");
  const isUp = pnl > 0n;
  const isDown = pnl < 0n;
  const pnlColor = isUp ? "#2fbf71" : isDown ? "#ef5350" : "#94918a";
  const accent = style.accent;

  const bg =
    style.theme === "light"
      ? "#faf8f4"
      : style.theme === "gradient"
      ? "linear-gradient(155deg, #12100a 0%, #1a1509 55%, #0a0908 100%)"
      : "#0b0a08";
  const textColor = style.theme === "light" ? "#191713" : "#f4f2ee";
  const dim = style.theme === "light" ? "#6b675e" : "#94918a";

  const rows: Array<[string, string]> = [
    ["Spent", `${fmtWei(data.spentWei)} ${data.symbol}`],
    ["Received", `${fmtWei(data.receivedWei)} ${data.symbol}`],
    ["Gas fees", `${fmtWei(data.gasWei)} ${data.symbol}`],
    ["Mints / Buys / Sales", `${fmtInt(data.mints)} / ${fmtInt(data.buys)} / ${fmtInt(data.sales)}`],
    ["Positions held", fmtInt(data.held)],
  ];
  if (data.firstTs) rows.push(["First activity", fmtDate(data.firstTs)]);
  if (data.lastTs) rows.push(["Last activity", fmtDate(data.lastTs)]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        borderRadius: 16,
        padding: 22,
        background: bg,
        color: textColor,
        border: `1px solid ${style.theme === "light" ? "rgba(24,18,6,.12)" : "rgba(255,255,255,.1)"}`,
        boxShadow: style.theme === "light" ? "0 10px 30px rgba(24,18,6,.1)" : "0 10px 40px rgba(0,0,0,.5)",
        fontFamily: "Inter, system-ui, sans-serif",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, letterSpacing: 1.5, fontSize: 14 }}>
          <Mark color={accent} /> FLEXINITE
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 8,
            border: `1px solid ${dim}44`,
            color: dim,
          }}
        >
          <span>{data.chainLogo}</span> {data.chainLabel}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 13, fontFamily: "ui-monospace, monospace", color: dim }}>
        {data.wallet}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: dim, textTransform: "uppercase" }}>Realized PnL</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
          <span style={{ fontSize: 32, fontWeight: 800, color: pnlColor }}>
            {isUp ? "+" : ""}{fmtWei(pnl)} {data.symbol}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: pnlColor,
              padding: "3px 9px",
              borderRadius: 999,
              background: `${pnlColor}1a`,
            }}
          >
            {fmtPct(data.realizedPnlPct)}
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          borderTop: `1px dashed ${dim}44`,
          paddingTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
          fontSize: 13,
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: dim }}>{k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", fontSize: 10, color: dim }}>
        <span>blocks {data.fromBlock.toLocaleString()} → {data.toBlock.toLocaleString()}</span>
        <span style={{ fontWeight: 700, letterSpacing: 1.5 }}>FLEXINITE</span>
      </div>
    </div>
  );
}
