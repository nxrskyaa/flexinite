"use client";

import { fmtWei, fmtInt, fmtPct, fmtDate } from "@/lib/format";

export interface CardStyle {
  accent: string;
  theme: "dark" | "light" | "gradient";
}

export const defaultCardStyle: CardStyle = { accent: "#8b5cf6", theme: "gradient" };

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

export default function PnLCard({ data, style }: { data: CardData; style: CardStyle }) {
  const pnl = BigInt(data.realizedPnlWei || "0");
  const isUp = pnl > 0n;
  const isDown = pnl < 0n;
  const pnlColor = isUp ? "#34d399" : isDown ? "#f87171" : "#9aa0c3";

  const bg =
    style.theme === "light"
      ? "#f6f7ff"
      : style.theme === "gradient"
      ? `linear-gradient(145deg, #100f24 0%, #1a1035 55%, #0b1b2e 100%)`
      : "#0b0c1a";
  const textColor = style.theme === "light" ? "#171a33" : "#eef0ff";
  const dim = style.theme === "light" ? "#5b6086" : "#9aa0c3";

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
        borderRadius: 20,
        padding: 22,
        background: bg,
        color: textColor,
        border: `1px solid ${style.accent}55`,
        boxShadow: `0 0 40px ${style.accent}33`,
        fontFamily: "Inter, system-ui, sans-serif",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, letterSpacing: 2 }}>
          <span style={{ fontSize: 20 }}>🐼</span> PANDAPNL
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 999,
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
        <div style={{ fontSize: 12, color: dim }}>REALIZED PNL</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: pnlColor }}>
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
        <span style={{ fontWeight: 700, letterSpacing: 1 }}>PANDAPNL.APP</span>
      </div>
    </div>
  );
}
