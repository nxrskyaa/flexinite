// simple in-memory per-IP limiter (per serverless instance, best-effort)
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimited(ip: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > limit;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function badRequest(msg: string) {
  return Response.json({ error: msg }, { status: 400 });
}

export function tooMany() {
  return Response.json(
    { error: "Rate limit exceeded — wait a minute and try again." },
    { status: 429 }
  );
}
