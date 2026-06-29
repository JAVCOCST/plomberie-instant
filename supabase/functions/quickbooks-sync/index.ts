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
    // Get tokens (auto-refresh if expired)
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

    const body = await req.json();
    const { type } = body; // "products" or "customers"

    const realmId = tokenRow.realm_id;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    if (type === "products") {
      // QB SQL parser rejects the previous OR chain for Item.Type in some realms.
      // Fetch items then filter supported sellable types in code.
      const query = encodeURIComponent("SELECT * FROM Item MAXRESULTS 1000");
      const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${query}&minorversion=73`, { headers });
      const data = await resp.json();

      if (!resp.ok) {
        console.error("QB items query failed:", data);
        return new Response(JSON.stringify({ error: "QB query failed", details: data }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawItems = data.QueryResponse?.Item || [];
      const allowedTypes = new Set(["Service", "NonInventory", "Inventory"]);
      const items = rawItems.filter((item: { Type?: string }) => item?.Type && allowedTypes.has(item.Type));

      // Persist to qb_products table
      for (const item of items) {
        const addr = item.BillAddr;
        await supabase.from("qb_products").upsert({
          qb_id: String(item.Id),
          name: item.Name,
          type: item.Type,
          unit_price: item.UnitPrice ?? null,
          purchase_cost: item.PurchaseCost ?? null,
          sku: item.Sku ?? null,
          description: item.Description ?? null,
          income_account_name: item.IncomeAccountRef?.name ?? null,
          expense_account_name: item.ExpenseAccountRef?.name ?? null,
          active: item.Active ?? true,
          raw_data: item,
          synced_at: new Date().toISOString(),
        }, { onConflict: "qb_id" });
      }

      return new Response(JSON.stringify({ items, count: items.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "customers") {
      const query = encodeURIComponent("SELECT * FROM Customer MAXRESULTS 1000");
      const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${query}&minorversion=73`, { headers });
      const data = await resp.json();

      if (!resp.ok) {
        console.error("QB customers query failed:", data);
        return new Response(JSON.stringify({ error: "QB query failed", details: data }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const customers = data.QueryResponse?.Customer || [];

      // Persist to qb_customers table
      for (const cust of customers) {
        const billAddr = cust.BillAddr;
        await supabase.from("qb_customers").upsert({
          qb_id: String(cust.Id),
          display_name: cust.DisplayName,
          company_name: cust.CompanyName ?? null,
          email: cust.PrimaryEmailAddr?.Address ?? null,
          phone: cust.PrimaryPhone?.FreeFormNumber ?? null,
          mobile: cust.Mobile?.FreeFormNumber ?? null,
          bill_address: billAddr ? `${billAddr.Line1 || ''}${billAddr.City ? ', ' + billAddr.City : ''}` : null,
          balance: cust.Balance ?? 0,
          raw_data: cust,
          synced_at: new Date().toISOString(),
        }, { onConflict: "qb_id" });
      }

      return new Response(JSON.stringify({ customers, count: customers.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "create_product") {
      const { name, unitPrice, purchaseCost, incomeAccountId, expenseAccountId, description, sku, itemType } = body;
      console.log("CREATE_PRODUCT request:", { name, unitPrice, purchaseCost, itemType, incomeAccountId, expenseAccountId });
      if (!name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If no incomeAccountId provided, try to find a default Income account
      let resolvedIncomeId = incomeAccountId;
      if (!resolvedIncomeId) {
        const acctQuery = encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 5");
        const acctResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${acctQuery}&minorversion=73`, { headers });
        const acctData = await acctResp.json();
        const incomeAccounts = acctData.QueryResponse?.Account || [];
        if (incomeAccounts.length > 0) {
          resolvedIncomeId = incomeAccounts[0].Id;
          console.log("Auto-selected income account:", incomeAccounts[0].Name, resolvedIncomeId);
        }
      }

      let resolvedExpenseId = expenseAccountId;
      if (!resolvedExpenseId && purchaseCost) {
        const expQuery = encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 5");
        const expResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${expQuery}&minorversion=73`, { headers });
        const expData = await expResp.json();
        const expAccounts = expData.QueryResponse?.Account || [];
        if (expAccounts.length > 0) {
          resolvedExpenseId = expAccounts[0].Id;
          console.log("Auto-selected expense account:", expAccounts[0].Name, resolvedExpenseId);
        }
      }

      const itemBody: Record<string, unknown> = {
        Name: name,
        Type: itemType || "Service",
        UnitPrice: unitPrice || 0,
      };
      if (purchaseCost !== undefined && purchaseCost !== null) itemBody.PurchaseCost = Number(purchaseCost);
      if (description) itemBody.Description = description;
      if (sku) itemBody.Sku = sku;
      if (resolvedIncomeId) itemBody.IncomeAccountRef = { value: resolvedIncomeId };
      if (resolvedExpenseId) itemBody.ExpenseAccountRef = { value: resolvedExpenseId };

      console.log("QB create item payload:", JSON.stringify(itemBody));

      const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/item?minorversion=73`, {
        method: "POST",
        headers,
        body: JSON.stringify(itemBody),
      });
      const data = await resp.json();

      if (!resp.ok) {
        console.error("QB create item failed:", JSON.stringify(data));
        return new Response(JSON.stringify({ error: "QB create failed", details: data }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("QB create item success:", data.Item?.Id, data.Item?.Name);
      return new Response(JSON.stringify({ item: data.Item, success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "update_product") {
      const { qbId, unitPrice, purchaseCost } = body;
      if (!qbId) {
        return new Response(JSON.stringify({ error: "qbId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch current item to get SyncToken (required by QB)
      const getResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/item/${qbId}?minorversion=73`, { headers });
      const getData = await getResp.json();
      if (!getResp.ok) {
        console.error("QB get item failed:", getData);
        return new Response(JSON.stringify({ error: "Failed to fetch item", details: getData }), {
          status: getResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const existing = getData.Item;
      const updateBody: Record<string, unknown> = {
        Id: existing.Id,
        SyncToken: existing.SyncToken,
        Name: existing.Name,
        sparse: true,
      };
      if (unitPrice !== undefined) updateBody.UnitPrice = Number(unitPrice);
      if (purchaseCost !== undefined) updateBody.PurchaseCost = Number(purchaseCost);

      const updateResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/item?minorversion=73`, {
        method: "POST",
        headers,
        body: JSON.stringify(updateBody),
      });
      const updateData = await updateResp.json();

      if (!updateResp.ok) {
        console.error("QB update item failed:", updateData);
        return new Response(JSON.stringify({ error: "QB update failed", details: updateData }), {
          status: updateResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update local cache
      const updated = updateData.Item;
      await supabase.from("qb_products").upsert({
        qb_id: String(updated.Id),
        name: updated.Name,
        type: updated.Type,
        unit_price: updated.UnitPrice ?? null,
        purchase_cost: updated.PurchaseCost ?? null,
        sku: updated.Sku ?? null,
        description: updated.Description ?? null,
        income_account_name: updated.IncomeAccountRef?.name ?? null,
        expense_account_name: updated.ExpenseAccountRef?.name ?? null,
        active: updated.Active ?? true,
        raw_data: updated,
        synced_at: new Date().toISOString(),
      }, { onConflict: "qb_id" });

      return new Response(JSON.stringify({ item: updated, success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "accounts") {
      const query = encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000");
      const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${query}&minorversion=73`, { headers });
      const data = await resp.json();
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "QB accounts query failed", details: data }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accounts = data.QueryResponse?.Account || [];
      return new Response(JSON.stringify({ accounts, count: accounts.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "customer_estimates") {
      const { customerId } = body;
      if (!customerId) {
        return new Response(JSON.stringify({ error: "customerId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Paginate ALL estimates (QB caps at 1000 per page)
      const allEstimates: any[] = [];
      let startPos = 1;
      const pageSize = 1000;
      let totalFetched = 0;
      console.log("QB estimate query for customerId:", customerId);
      while (true) {
        const q = encodeURIComponent(`SELECT * FROM Estimate STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
        const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=73`, { headers });
        const data = await resp.json();
        if (!resp.ok) {
          console.error("QB estimate query failed:", JSON.stringify(data));
          return new Response(JSON.stringify({ error: "QB estimate query failed", details: data }), {
            status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const page = data.QueryResponse?.Estimate || [];
        totalFetched += page.length;
        allEstimates.push(...page);
        if (page.length < pageSize) break;
        startPos += pageSize;
        if (startPos > 10000) break; // safety
      }
      console.log("QB total estimates fetched:", totalFetched);
      const targetId = String(customerId).trim();
      const filteredEstimates = allEstimates.filter((e: any) => String(e.CustomerRef?.value || '').trim() === targetId);
      console.log("Filtered estimates for customer", customerId, ":", filteredEstimates.length, "of", allEstimates.length, "total");
      // Sort newest first
      filteredEstimates.sort((a: any, b: any) => (b.TxnDate || '').localeCompare(a.TxnDate || ''));
      const estimates = filteredEstimates.map((e: any) => ({
        id: e.Id,
        doc_number: e.DocNumber || '',
        txn_date: e.TxnDate || '',
        total: e.TotalAmt || 0,
        status: e.TxnStatus || '',
        expiry_date: e.ExpirationDate || '',
        customer_name: e.CustomerRef?.name || '',
        line_count: (e.Line || []).filter((l: any) => l.DetailType === 'SalesItemLineDetail').length,
      }));
      return new Response(JSON.stringify({ estimates, count: estimates.length, total_estimates: allEstimates.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "estimate_detail") {
      const { estimateId } = body;
      if (!estimateId) {
        return new Response(JSON.stringify({ error: "estimateId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const resp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/estimate/${estimateId}?minorversion=73`, { headers });
      const data = await resp.json();
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "QB estimate fetch failed", details: data }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const estimate = data.Estimate;
      const lines = (estimate.Line || [])
        .filter((l: any) => l.DetailType === 'SalesItemLineDetail')
        .map((l: any) => ({
          description: l.Description || l.SalesItemLineDetail?.ItemRef?.name || '',
          quantity: l.SalesItemLineDetail?.Qty || 1,
          rate: l.SalesItemLineDetail?.UnitPrice || 0,
          amount: l.Amount || 0,
          item_ref: l.SalesItemLineDetail?.ItemRef?.value || '',
          item_name: l.SalesItemLineDetail?.ItemRef?.name || '',
        }));
      return new Response(JSON.stringify({
        estimate: {
          id: estimate.Id,
          doc_number: estimate.DocNumber || '',
          txn_date: estimate.TxnDate || '',
          total: estimate.TotalAmt || 0,
          customer_name: estimate.CustomerRef?.name || '',
        },
        lines,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("quickbooks-sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
