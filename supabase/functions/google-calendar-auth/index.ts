import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_REDIRECT_URI = "https://soumission.toituresvb.ca/admin/calendar";

function getGoogleRedirectUri(): string {
  const configured = (Deno.env.get("GOOGLE_REDIRECT_URI") ?? "").trim();
  return configured || DEFAULT_REDIRECT_URI;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const reqHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, reqHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "Google credentials not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── STATUS ──
    if (action === "status") {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Auto-refresh if expired instead of reporting disconnected
      let connected = true;
      let expiresAt = data.expires_at;
      if (new Date(data.expires_at) < new Date()) {
        try {
          const refreshResp = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              refresh_token: data.refresh_token,
              grant_type: "refresh_token",
            }),
          });
          const refreshData = await refreshResp.json();
          if (refreshResp.ok && refreshData.access_token) {
            expiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
            await supabase.from("google_calendar_tokens").update({
              access_token: refreshData.access_token,
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
            }).eq("id", data.id);
            connected = true;
          } else {
            console.error("Auto-refresh failed:", refreshData);
            connected = false;
          }
        } catch (e) {
          console.error("Auto-refresh error:", e);
          connected = false;
        }
      }

      return new Response(JSON.stringify({
        connected,
        calendar_id: data.calendar_id,
        expires_at: expiresAt,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── AUTHORIZE ──
    if (action === "authorize") {
      await req.json().catch(() => ({}));
      const redirectUri = getGoogleRedirectUri();

      const state = crypto.randomUUID();
      const authUrl = `${GOOGLE_AUTH_URL}?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&state=${state}`;

      return new Response(JSON.stringify({ auth_url: authUrl, state, redirect_uri: redirectUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CALLBACK ──
    if (action === "callback") {
      const body = await req.json();
      const { code } = body;
      const redirect_uri = getGoogleRedirectUri();

      if (!code) {
        return new Response(JSON.stringify({ error: "code required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("Google token exchange failed:", tokenData);
        return new Response(JSON.stringify({ error: "Token exchange failed", details: tokenData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Delete old tokens, insert new
      await supabase.from("google_calendar_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const { error: insertErr } = await supabase.from("google_calendar_tokens").insert({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        calendar_id: "primary",
      });

      if (insertErr) {
        console.error("Failed to store Google tokens:", insertErr);
        return new Response(JSON.stringify({ error: "Failed to store tokens" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REFRESH ──
    if (action === "refresh") {
      const { data: tokenRow } = await supabase
        .from("google_calendar_tokens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!tokenRow) {
        return new Response(JSON.stringify({ error: "No tokens found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refreshResp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: tokenRow.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const refreshData = await refreshResp.json();
      if (!refreshResp.ok) {
        return new Response(JSON.stringify({ error: "Refresh failed", details: refreshData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await supabase.from("google_calendar_tokens").update({
        access_token: refreshData.access_token,
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("google-calendar-auth error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
