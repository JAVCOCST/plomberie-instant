import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Calls n8n webhook, then polls owner_lookup_results table
 * until results appear or timeout.
 */

const N8N_WEBHOOK_URL = "https://n8n.javcoimmobilier.com/webhook/extract-lots";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  try {
    const { lotNumber } = await req.json();
    if (!lotNumber || typeof lotNumber !== "string") {
      return new Response(JSON.stringify({ error: "lotNumber requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanLot = lotNumber.replace(/\s/g, "");
    console.log("fetch-owner: looking up lot", cleanLot);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Record the start time so we only look at rows created after this point
    const startTime = new Date().toISOString();

    // Fire the n8n webhook
    console.log("fetch-owner: calling n8n...");
    fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lots: [cleanLot] }),
    }).catch((err) => console.error("fetch-owner: n8n error:", err));

    // Poll the table for results
    const MAX_WAIT = 50000; // 50s
    const POLL_INTERVAL = 2000; // 2s
    const started = Date.now();
    let owners: Array<Record<string, string>> = [];
    let complete = false;

    while (Date.now() - started < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const { data, error } = await supabase
        .from("owner_lookup_results")
        .select("*")
        .eq("lot_number", cleanLot)
        .gte("created_at", startTime)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("fetch-owner: poll error:", error);
        continue;
      }

      if (data && data.length > 0) {
        // Check for completion marker
        complete = data.some((r: any) => r.is_complete);
        // Collect owner rows (non-complete markers)
        owners = data
          .filter((r: any) => !r.is_complete && r.owner_name)
          .map((r: any) => ({
            ownerName: r.owner_name,
            address: r.address,
            city: r.city,
            postalCode: r.postal_code,
            acquisitionDate: r.acquisition_date,
            price: r.price,
          }));

        if (complete) {
          console.log("fetch-owner: complete signal found, collected", owners.length, "owners");
          break;
        }
      }
    }

    // Also check for global complete marker
    if (!complete) {
      const { data: completeData } = await supabase
        .from("owner_lookup_results")
        .select("*")
        .eq("is_complete", true)
        .gte("created_at", startTime)
        .limit(1);
      if (completeData && completeData.length > 0) complete = true;
    }

    if (!complete && owners.length === 0) {
      console.log("fetch-owner: timeout, no owners found");
    } else {
      console.log("fetch-owner: returning", owners.length, "owners");
    }

    // Cleanup our rows
    supabase
      .from("owner_lookup_results")
      .delete()
      .eq("lot_number", cleanLot)
      .gte("created_at", startTime)
      .then(() => {});

    if (owners.length > 0) {
      const proprietaire = owners.map((o) => ({
        nom: o.ownerName,
        adresse: o.address,
        ville: o.city,
        codePostal: o.postalCode,
        dateAcquisition: o.acquisitionDate,
        prix: o.price,
      }));

      return new Response(
        JSON.stringify({
          success: true,
          ownerName: owners[0].ownerName,
          proprietaire,
          address: owners[0].address,
          city: owners[0].city,
          postalCode: owners[0].postalCode,
          acquisitionDate: owners[0].acquisitionDate,
          price: owners[0].price,
          lotNumber: cleanLot,
          source: "n8n / Registre foncier",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Propriétaire non trouvé pour ce lot",
        lotNumber: cleanLot,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fetch-owner error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
