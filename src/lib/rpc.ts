import { keccak256 } from "js-sha3";
import { getChain, type ChainInfo } from "./chains";

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function resolveRpc(chain: ChainInfo): Promise<string> {
  if (!chain.rpcUrls || chain.rpcUrls.length <= 1) return chain.rpcUrl;
  return pickWorkingRpc(chain.rpcUrls);
}
export const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ERC1155_SINGLE_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
export const ERC1155_BATCH_TOPIC =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

let id = 0;

// pick the first responsive RPC from candidates — probe ALL in parallel with a
// short per-probe timeout, and cache the winner (public RPCs are flaky; probing
// sequentially through dead endpoints adds tens of seconds).
// THROWS when nothing responds — callers must treat null-RPC as "no rpc".
const rpcCache = new Map<string, string>();

export async function pickWorkingRpc(urls: string[]): Promise<string> {
  const key = urls.join("|");
  const cached = rpcCache.get(key);
  if (cached) return cached;

  const results = await Promise.allSettled(
    urls.slice(0, 12).map(async (url) => {
      await rpcCall(url, "eth_blockNumber", [], 4000);
      return url;
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      rpcCache.set(key, r.value);
      return r.value;
    }
  }
  throw new Error("No responsive RPC for this chain");
}

export async function rpcCall(rpcUrl: string, method: string, params: unknown[], timeoutMs = 15000) {
  id++;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: ctrl.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

export async function getLogs(rpcUrl: string, filter: Record<string, unknown>) {
  return rpcCall(rpcUrl, "eth_getLogs", [filter]);
}

export function padAddress(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40);
}

// ---- contract probing ----

export function fnSig(sig: string): string {
  return "0x" + keccak256(sig).slice(0, 8);
}

export function encodeUint(n: number | bigint): string {
  return n.toString(16).padStart(64, "0");
}

export function decodeString(hex: string | null): string | null {
  if (!hex || hex === "0x" || hex.length < 130) return null;
  try {
    const data = hex.slice(2);
    // try ABI-encoded (offset,len,bytes)
    const len = parseInt(data.slice(64, 128), 16);
    if (!isNaN(len) && len > 0 && len < 512) {
      const chars = data.slice(128, 128 + len * 2);
      const s = hexToUtf8(chars);
      if (s && /^[\x20-\x7e]+$/.test(s)) return s;
    }
    // try raw bytes32 string
    const s = hexToUtf8(data.replace(/00+$/, ""));
    if (s && /^[\x20-\x7e]+$/.test(s)) return s;
    return null;
  } catch {
    return null;
  }
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function decodeUint(hex: string | null): bigint | null {
  if (!hex || hex === "0x") return null;
  try {
    const v = BigInt(hex);
    return v;
  } catch {
    return null;
  }
}

export async function callView(
  rpcUrl: string,
  to: string,
  data: string
): Promise<string | null> {
  try {
    const r = await rpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"]);
    return r as string;
  } catch {
    return null;
  }
}

export interface TokenMeta {
  name: string | null;
  symbol: string | null;
  is721: boolean;
  is1155: boolean;
}

export async function probeToken(rpcUrl: string, contract: string): Promise<TokenMeta> {
  const [name, symbol, s721, s1155] = await Promise.all([
    callView(rpcUrl, contract, fnSig("name()")),
    callView(rpcUrl, contract, fnSig("symbol()")),
    callView(rpcUrl, contract, fnSig("supportsInterface(bytes4)") + "80ac58cd"), // ERC721
    callView(rpcUrl, contract, fnSig("supportsInterface(bytes4)") + "d9b67a26"), // ERC1155
  ]);
  const is721 = s721 !== null && decodeUint(s721) === 1n;
  const is1155 = s1155 !== null && decodeUint(s1155) === 1n;
  return {
    name: decodeString(name),
    symbol: decodeString(symbol),
    is721,
    is1155,
  };
}

export async function contractBalance(
  rpcUrl: string,
  contract: string,
  holder: string
): Promise<bigint> {
  const r = await callView(
    rpcUrl,
    contract,
    fnSig("balanceOf(address)") + holder.toLowerCase().replace(/^0x/, "").padStart(64, "0")
  );
  return decodeUint(r) ?? 0n;
}

export async function currentOwnerOf(
  rpcUrl: string,
  contract: string,
  tokenId: bigint
): Promise<string | null> {
  const r = await callView(rpcUrl, contract, fnSig("ownerOf(uint256)") + encodeUint(tokenId));
  return r ? topicToAddress(r) : null;
}

export async function getNativeBalance(rpcUrl: string, address: string): Promise<bigint> {
  const r = await rpcCall(rpcUrl, "eth_getBalance", [address.toLowerCase(), "latest"]);
  return decodeUint(r) ?? 0n;
}

export async function getTxTimestamp(rpcUrl: string, txHash: string): Promise<number | null> {
  try {
    const tx = await rpcCall(rpcUrl, "eth_getTransactionByHash", [txHash]);
    if (!tx || !tx.blockNumber) return null;
    const block = await rpcCall(rpcUrl, "eth_getBlockByNumber", [tx.blockNumber, false]);
    return block && block.timestamp ? parseInt(block.timestamp, 16) : null;
  } catch {
    return null;
  }
}

export function makeChain(chainId: number): Promise<ChainInfo> {
  return getChain(chainId);
}
