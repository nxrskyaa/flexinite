// format helpers (shared client/server-safe, no bigint literals needed here)

export function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a) return "";
  if (a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function fmtWei(
  wei: string | bigint,
  decimals = 18,
  maxFrac = 4
): string {
  try {
    const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
    fracStr = fracStr.replace(/0+$/, "");
    const wholeStr = whole.toLocaleString("en-US");
    const out = fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
    return (neg ? "-" : "") + out;
  } catch {
    return "0";
  }
}

export function fmtInt(n: string | number | bigint): string {
  return Number(n).toLocaleString("en-US");
}

export function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || isNaN(p)) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

export function pnlClass(wei: string | bigint): string {
  try {
    const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
    if (v > 0n) return "pos";
    if (v < 0n) return "neg";
  } catch {
    /* ignore */
  }
  return "";
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtCompact(n: number | bigint | string): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n));
}
