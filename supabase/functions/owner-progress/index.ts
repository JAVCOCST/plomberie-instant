/**
 * Receives owner progress callbacks from n8n.
 * Inserts each proprietaire into owner_lookup_results table.
 * No JWT required — called by n8n directly.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "progress";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();

    if (action === "progress") {
      const lot = String(body.lot || "").replace(/\s+/g, "");
      console.log("owner-progress: received owner for lot", lot, "name:", body.ownerName);

      const { error } = await supabase.from("owner_lookup_results").insert({
        lot_number: lot,
        owner_name: body.ownerName || "",
        address: body.address || "",
        city: body.city || "",
        postal_code: body.postalCode || "",
        acquisition_date: body.acquisitionDate || "",
        price: body.price || "",
        is_complete: false,
      });

      if (error) {
        console.error("owner-progress: insert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("owner-progress: inserted owner for lot", lot);
      return new Response(JSON.stringify({ ok: true, lot }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "complete") {
      const lot = String(body.lot || body.companyId || "").replace(/\s+/g, "");
      console.log("owner-progress: complete signal for lot", lot);

      // Insert a completion marker row
      const { error } = await supabase.from("owner_lookup_results").insert({
        lot_number: lot || "__complete__",
        is_complete: true,
      });

      if (error) console.error("owner-progress: complete insert error:", error);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("owner-progress error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
