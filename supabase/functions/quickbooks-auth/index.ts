import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPES = "com.intuit.quickbooks.accounting";

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

  const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID") ?? "";
  const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "QuickBooks credentials not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── STATUS: check if we have valid tokens ──
    if (action === "status") {
      const { data } = await supabase
        .from("quickbooks_tokens")
        .select("realm_id, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const expired = new Date(data.expires_at) < new Date();
      return new Response(JSON.stringify({
        connected: !expired,
        realm_id: data.realm_id,
        expires_at: data.expires_at,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── AUTHORIZE: redirect to Intuit ──
    if (action === "authorize") {
      const body = await req.json().catch(() => ({}));
      const redirectUri = body.redirect_uri;
      if (!redirectUri) {
        return new Response(JSON.stringify({ error: "redirect_uri required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const state = crypto.randomUUID();
      const authUrl = `${QB_AUTH_URL}?client_id=${QB_CLIENT_ID}&response_type=code&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

      return new Response(JSON.stringify({ auth_url: authUrl, state }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CALLBACK: exchange code for tokens ──
    if (action === "callback") {
      const body = await req.json();
      const { code, realm_id, redirect_uri } = body;

      if (!code || !realm_id || !redirect_uri) {
        return new Response(JSON.stringify({ error: "code, realm_id, redirect_uri required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
      const tokenResp = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri,
        }),
      });

      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("QB token exchange failed:", tokenData);
        return new Response(JSON.stringify({ error: "Token exchange failed", details: tokenData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Upsert tokens
      await supabase.from("quickbooks_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const { error: insertErr } = await supabase.from("quickbooks_tokens").insert({
        realm_id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
      });

      if (insertErr) {
        console.error("Failed to store tokens:", insertErr);
        return new Response(JSON.stringify({ error: "Failed to store tokens" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, realm_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REFRESH: refresh access token ──
    if (action === "refresh") {
      const { data: tokenRow } = await supabase
        .from("quickbooks_tokens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!tokenRow) {
        return new Response(JSON.stringify({ error: "No tokens found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
      const refreshResp = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokenRow.refresh_token,
        }),
      });

      const refreshData = await refreshResp.json();
      if (!refreshResp.ok) {
        return new Response(JSON.stringify({ error: "Refresh failed", details: refreshData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await supabase.from("quickbooks_tokens").update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
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
    console.error("quickbooks-auth error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
