import { NextRequest } from "next/server";
import { resolveOpenSeaUrl, resolveOpenSeaCollection, parseOpenSeaUrl, looksLikeOpenSeaUrl } from "@/lib/opensea";
import { rateLimited, clientIp, badRequest } from "../_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip, 60)) {
    return Response.json({ error: "Rate limit exceeded — wait a minute." }, { status: 429 });
  }
  const input = req.nextUrl.searchParams.get("input")?.trim();
  if (!input) return badRequest("Missing input");

  try {
    // full OpenSea URL
    if (looksLikeOpenSeaUrl(input)) {
      const parsed = parseOpenSeaUrl(input);
      if (parsed.kind === "unknown") {
        return Response.json({ kind: "unknown", hint: "Could not parse that OpenSea link. Supported: /collection/<slug>, /assets/<chain>/<contract>/<tokenId>, /<wallet>." });
      }
      const resolved = await resolveOpenSeaUrl(input);
      return Response.json(resolved);
    }
    // bare collection slug? only if explicitly requested
    const slug = req.nextUrl.searchParams.get("slug");
    if (slug === "1" && /^[a-z0-9][a-z0-9-]{1,80}$/i.test(input)) {
      const resolved = await resolveOpenSeaCollection(input.toLowerCase());
      return Response.json(resolved);
    }
    return Response.json({ kind: "unknown", hint: "Paste an OpenSea link (collection, asset, or profile URL)." });
  } catch (e) {
    return Response.json({ error: "OpenSea lookup failed", detail: String((e as Error).message || e) }, { status: 500 });
  }
}
