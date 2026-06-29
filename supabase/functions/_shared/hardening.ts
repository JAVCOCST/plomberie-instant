/**
 * Shared security hardening for edge functions.
 * CORS + Origin check + in-memory rate limit + Google URL allowlist.
 *
 * NOTE: the legacy `x-roof-token` gate has been removed because any
 * `VITE_*` env var is bundled into the public client JS and therefore
 * trivially extractable. We now rely on Supabase's anon-key/JWT layer
 * (functions are invoked through `supabase.functions.invoke()` which
 * automatically attaches the apikey + Authorization headers) plus the
 * Origin check and per-IP rate limiter below.
 */

const ALLOWED_ORIGINS = new Set([
  "https://www.soumission.toituresvb.ca",
  "https://soumission.toituresvb.ca",
]);

function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.trim();
  if (!normalized) return false;

  // Lovable preview sandbox can send literal "null" origin.
  if (normalized === "null") return true;

  if (ALLOWED_ORIGINS.has(normalized)) return true;

  // Allow Lovable preview/published domains for testing
  try {
    const { hostname } = new URL(normalized);
    if (hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com") || hostname.endsWith(".vercel.app")) return true;
  } catch {
    return false;
  }

  return false;
}

const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client",
  "x-supabase-api-version",
  "x-supabase-authorization",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "x-requested-with",
].join(", ");

export function cors(origin: string | null, requestHeaders?: string | null): Record<string, string> {
  const allowed = origin ? isAllowedOrigin(origin) : true;
  const allowOrigin = !origin || origin === "null"
    ? "*"
    : allowed
      ? origin
      : "https://www.soumission.toituresvb.ca";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": requestHeaders?.trim() || DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export function assertOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return true;
  return isAllowedOrigin(origin);
}

// ── In-memory rate limiter ──────────────────────────────────
const ipCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 8;
const RATE_WINDOW = 60_000; // 60 s

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── URL allowlist ───────────────────────────────────────────
export function isAllowedGoogleUrl(u: unknown): boolean {
  if (typeof u !== "string" || !u.startsWith("https://")) return false;
  return (
    u.startsWith("https://maps.googleapis.com/maps/api/staticmap") ||
    u.startsWith("https://maps.googleapis.com/maps/api/streetview")
  );
}

// Legacy token gate removed — see file header.
// Kept as a no-op export to preserve any stale imports until full cleanup.
export function requireToken(
  _req: Request,
  _corsHeaders: Record<string, string>,
): Response | null {
  return null;
}

// ── Convenience: run all guards, return early Response or null ──
export function runGuards(
  req: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  if (!assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "Trop de requêtes. Réessayez dans 1 minute." }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
      },
    );
  }

  return null;
}

// ── Admin-only guard: verify Supabase JWT (no x-roof-token needed) ──
export async function runAdminGuards(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (!assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify Supabase JWT
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return null;
}
