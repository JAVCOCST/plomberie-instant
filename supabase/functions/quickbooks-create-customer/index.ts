import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const QB_API_BASE = "https://quickbooks.api.intuit.com";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const reqHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, reqHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID") ?? "";
  const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const {
      given_name, family_name, display_name,
      email, phone, company_name, neq,
      bill_address, ship_address,
      qb_id, // if provided, force update path (no search/create)
    } = body;

    if (!display_name && !given_name) {
      return new Response(JSON.stringify({ error: "display_name ou given_name requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tokens
    const { data: tokenRow } = await supabase
      .from("quickbooks_tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "QuickBooks non connecté" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenRow.access_token;

    // Auto-refresh if expired
    if (new Date(tokenRow.expires_at) < new Date()) {
      const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
      const refreshResp = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
        return new Response(JSON.stringify({ error: "Token refresh failed" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshData.access_token;
      await supabase.from("quickbooks_tokens").update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);
    }

    const realmId = tokenRow.realm_id;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    const effectiveDisplayName = display_name || `${given_name} ${family_name}`.trim();

    // Look up existing customer: by explicit qb_id, otherwise by DisplayName
    let existing: any = null;
    if (qb_id) {
      const r = await fetch(
        `${QB_API_BASE}/v3/company/${realmId}/customer/${encodeURIComponent(qb_id)}?minorversion=73`,
        { headers }
      );
      const j = await r.json();
      existing = j.Customer || null;
    } else {
      const searchQuery = encodeURIComponent(
        `SELECT * FROM Customer WHERE DisplayName = '${effectiveDisplayName.replace(/'/g, "\\'")}'`
      );
      const searchResp = await fetch(
        `${QB_API_BASE}/v3/company/${realmId}/query?query=${searchQuery}&minorversion=73`,
        { headers }
      );
      const searchData = await searchResp.json();
      existing = searchData.QueryResponse?.Customer?.[0] || null;
    }

    // If found, compute a diff and perform a sparse UPDATE if anything changed
    if (existing) {
      const diffs: string[] = [];
      const update: Record<string, unknown> = {
        Id: existing.Id,
        SyncToken: existing.SyncToken,
        sparse: true,
      };

      if (given_name !== undefined && given_name !== (existing.GivenName || "")) {
        update.GivenName = given_name || ""; diffs.push("Prénom");
      }
      if (family_name !== undefined && family_name !== (existing.FamilyName || "")) {
        update.FamilyName = family_name || ""; diffs.push("Nom");
      }
      if (effectiveDisplayName && effectiveDisplayName !== (existing.DisplayName || "")) {
        update.DisplayName = effectiveDisplayName; diffs.push("Display");
      }
      if (company_name !== undefined && (company_name || "") !== (existing.CompanyName || "")) {
        update.CompanyName = company_name || ""; diffs.push("Compagnie");
      }
      if (email !== undefined && email !== (existing.PrimaryEmailAddr?.Address || "")) {
        update.PrimaryEmailAddr = email ? { Address: email } : null; diffs.push("Courriel");
      }
      if (phone !== undefined && phone !== (existing.PrimaryPhone?.FreeFormNumber || "")) {
        update.PrimaryPhone = phone ? { FreeFormNumber: phone } : null; diffs.push("Téléphone");
      }
      if (bill_address !== undefined && bill_address !== (existing.BillAddr?.Line1 || "")) {
        update.BillAddr = bill_address ? { Line1: bill_address } : null; diffs.push("Adresse facturation");
      }
      if (ship_address !== undefined && ship_address !== (existing.ShipAddr?.Line1 || "")) {
        update.ShipAddr = ship_address ? { Line1: ship_address } : null; diffs.push("Adresse livraison");
      }
      // NEQ → Notes (only patch if user provided a value and it differs)
      if (neq !== undefined && neq !== "") {
        const desiredNotes = `NEQ: ${neq}`;
        if (desiredNotes !== (existing.Notes || "")) {
          update.Notes = desiredNotes; diffs.push("NEQ");
        }
      }

      if (diffs.length === 0) {
        console.log("Customer exists, no changes:", existing.DisplayName, existing.Id);
        return new Response(JSON.stringify({
          success: true,
          already_exists: true,
          updated: false,
          customer: {
            id: existing.Id,
            display_name: existing.DisplayName,
            sync_token: existing.SyncToken,
          },
          message: `Le client « ${existing.DisplayName} » est déjà à jour dans QuickBooks (aucune différence détectée).`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log("Updating QB customer:", existing.Id, "fields:", diffs.join(", "));
      const updResp = await fetch(
        `${QB_API_BASE}/v3/company/${realmId}/customer?minorversion=73`,
        { method: "POST", headers, body: JSON.stringify(update) }
      );
      const updData = await updResp.json();
      if (!updResp.ok) {
        console.error("QB update customer failed:", JSON.stringify(updData));
        const detail = updData.Fault?.Error?.[0]?.Detail || "Erreur de mise à jour";
        return new Response(JSON.stringify({ error: detail, details: updData }), {
          status: updResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const updatedCustomer = updData.Customer;

      // Sync the local mirror
      await supabase.from("qb_customers").upsert({
        qb_id: updatedCustomer.Id,
        display_name: updatedCustomer.DisplayName,
        company_name: updatedCustomer.CompanyName || null,
        email: updatedCustomer.PrimaryEmailAddr?.Address || null,
        phone: updatedCustomer.PrimaryPhone?.FreeFormNumber || null,
        bill_address: updatedCustomer.BillAddr?.Line1 || null,
        raw_data: updatedCustomer,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'qb_id' });

      return new Response(JSON.stringify({
        success: true,
        already_exists: true,
        updated: true,
        updated_fields: diffs,
        customer: {
          id: updatedCustomer.Id,
          display_name: updatedCustomer.DisplayName,
          sync_token: updatedCustomer.SyncToken,
        },
        message: `Client « ${updatedCustomer.DisplayName} » mis à jour dans QuickBooks (${diffs.join(", ")})`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // If a qb_id was passed but the customer was not found, surface a clear error
    if (qb_id) {
      return new Response(JSON.stringify({ error: `Client QB ${qb_id} introuvable` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the customer object matching QB API fields
    const newCustomer: Record<string, unknown> = {
      DisplayName: effectiveDisplayName,
      GivenName: given_name || undefined,
      FamilyName: family_name || undefined,
    };

    if (email) {
      newCustomer.PrimaryEmailAddr = { Address: email };
    }
    if (phone) {
      newCustomer.PrimaryPhone = { FreeFormNumber: phone };
    }
    if (company_name) {
      newCustomer.CompanyName = company_name;
    }
    if (bill_address) {
      newCustomer.BillAddr = { Line1: bill_address };
    }
    if (ship_address) {
      newCustomer.ShipAddr = { Line1: ship_address };
    }
    // Store NEQ in Notes field if provided
    if (neq) {
      newCustomer.Notes = `NEQ: ${neq}`;
    }

    console.log("Creating QB customer:", JSON.stringify(newCustomer));

    const createResp = await fetch(
      `${QB_API_BASE}/v3/company/${realmId}/customer?minorversion=73`,
      { method: "POST", headers, body: JSON.stringify(newCustomer) }
    );
    const createData = await createResp.json();

    if (!createResp.ok) {
      console.error("QB create customer failed:", JSON.stringify(createData));
      const detail = createData.Fault?.Error?.[0]?.Detail || "Erreur inconnue";
      return new Response(JSON.stringify({ error: detail, details: createData }), {
        status: createResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const createdCustomer = createData.Customer;
    console.log("QB Customer created:", createdCustomer.DisplayName, createdCustomer.Id);

    // Sync to local qb_customers table
    await supabase.from("qb_customers").upsert({
      qb_id: createdCustomer.Id,
      display_name: createdCustomer.DisplayName,
      company_name: createdCustomer.CompanyName || null,
      email: createdCustomer.PrimaryEmailAddr?.Address || null,
      phone: createdCustomer.PrimaryPhone?.FreeFormNumber || null,
      bill_address: createdCustomer.BillAddr?.Line1 || null,
      raw_data: createdCustomer,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'qb_id' });

    return new Response(JSON.stringify({
      success: true,
      already_exists: false,
      customer: {
        id: createdCustomer.Id,
        display_name: createdCustomer.DisplayName,
        sync_token: createdCustomer.SyncToken,
      },
      message: `Client « ${createdCustomer.DisplayName} » créé dans QuickBooks (ID: ${createdCustomer.Id})`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("quickbooks-create-customer error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
