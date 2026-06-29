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
      lines,
      intro_lines,
      footer_lines,
      customer_id,
      customer_name,
      customer_email,
      address,
      memo,
      doc_number,
      attachments,
      txn_date,
      expiration_date,
      custom_fields,
    } = body as {
      lines: any[];
      intro_lines?: string[];
      footer_lines?: string[];
      customer_id?: string;
      customer_name?: string;
      customer_email?: string;
      address?: string;
      memo?: string;
      doc_number?: string;
      attachments?: { name: string; url: string }[];
      txn_date?: string;
      expiration_date?: string;
      custom_fields?: { contract_type?: string; project_address?: string; project_no?: string };
    };

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return new Response(JSON.stringify({ error: "lines array required" }), {
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

    // Resolve TPS/TVQ TaxCode for Quebec (required by QBO CA)
    let taxCodeRef: string | null = null;
    try {
      const taxQuery = encodeURIComponent(
        "SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 200"
      );
      const taxResp = await fetch(
        `${QB_API_BASE}/v3/company/${realmId}/query?query=${taxQuery}&minorversion=73`,
        { headers }
      );
      const taxData = await taxResp.json();
      const codes: any[] = taxData.QueryResponse?.TaxCode ?? [];
      // Prefer a combined GST/QST (TPS/TVQ) code; fallback to anything matching TPS or TVQ
      const preferred =
        codes.find((c) => /tps.*tvq|gst.*qst/i.test(c.Name || "")) ||
        codes.find((c) => /tps|gst/i.test(c.Name || "") && /tvq|qst/i.test(c.Name || "")) ||
        codes.find((c) => /tps|gst|tvq|qst/i.test(c.Name || "")) ||
        codes.find((c) => c.Name && !/exempt|zero|hors/i.test(c.Name));
      if (preferred) {
        taxCodeRef = String(preferred.Id);
        console.log("Resolved TaxCode for estimate:", preferred.Name, "->", taxCodeRef);
      } else {
        console.warn("No suitable TaxCode found in QBO. Available:", codes.map((c) => c.Name));
      }
    } catch (taxErr) {
      console.error("Failed to fetch TaxCodes:", taxErr);
    }

    // Resolve or create customer
    let customerRef = "1"; // fallback to first customer
    if (customer_id) {
      customerRef = customer_id;
    } else if (customer_name) {
      // Search for existing customer by name
      const searchQuery = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${customer_name.replace(/'/g, "\\'")}'`);
      const searchResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${searchQuery}&minorversion=73`, { headers });
      const searchData = await searchResp.json();
      const existing = searchData.QueryResponse?.Customer?.[0];
      if (existing) {
        customerRef = existing.Id;
        console.log("Found existing QB customer:", existing.DisplayName, existing.Id);
      } else {
        // Create new customer
        const newCust: Record<string, unknown> = { DisplayName: customer_name };
        if (customer_email) newCust.PrimaryEmailAddr = { Address: customer_email };
        if (address) newCust.ShipAddr = { Line1: address };

        const createResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/customer?minorversion=73`, {
          method: "POST", headers, body: JSON.stringify(newCust),
        });
        const createData = await createResp.json();
        if (createResp.ok && createData.Customer) {
          customerRef = createData.Customer.Id;
          console.log("Created new QB customer:", createData.Customer.DisplayName, createData.Customer.Id);
        } else {
          console.error("Failed to create customer:", createData);
        }
      }
    }

    // ── Build QB Estimate lines reproducing the PDF layout ──
    // 1) Description-only intro lines (product, warranty, surface, etc.)
    // 2) **MAIN D'OEUVRE** header + labor items + SubTotal
    // 3) **MATÉRIAUX** header + material items + SubTotal
    // 4) Description-only footer lines (exclusions)
    const qbLines: any[] = [];
    const descLine = (text: string) => ({
      DetailType: "DescriptionOnly",
      Description: text,
    });
    const itemLine = (line: any) => {
      const detail: Record<string, unknown> = {
        Qty: Number(line.quantity) || 1,
        UnitPrice: Number(line.rate) || Number(line.total) || 0,
      };
      if (line.qb_product_id) detail.ItemRef = { value: line.qb_product_id };
      if (taxCodeRef) detail.TaxCodeRef = { value: taxCodeRef };
      return {
        Amount: Number(line.total) || (Number(line.quantity) * Number(line.rate)) || 0,
        DetailType: "SalesItemLineDetail",
        Description: line.description || "",
        SalesItemLineDetail: detail,
      };
    };
    const subTotalLine = () => ({
      DetailType: "SubTotalLineDetail",
      SubTotalLineDetail: {},
    });

    // Soumission header line (client + adresse)
    if (customer_name || address) {
      qbLines.push(descLine(
        `Soumission - ${customer_name || ""}${address ? ` - ${address}` : ""}`.trim()
      ));
    }
    // Intro descriptive lines
    for (const t of (intro_lines || [])) {
      if (t && t.trim()) qbLines.push(descLine(t));
    }

    // Split items by section
    const labor = (lines || []).filter((l: any) => l.section === "labor");
    const material = (lines || []).filter((l: any) => l.section === "material");
    const other = (lines || []).filter((l: any) => l.section !== "labor" && l.section !== "material");

    if (labor.length > 0) {
      qbLines.push(descLine("**MAIN D'OEUVRE**"));
      for (const l of labor) qbLines.push(itemLine(l));
      qbLines.push(subTotalLine());
    }
    if (material.length > 0) {
      qbLines.push(descLine("**MATÉRIAUX**"));
      for (const l of material) qbLines.push(itemLine(l));
      qbLines.push(subTotalLine());
    }
    if (other.length > 0) {
      for (const l of other) qbLines.push(itemLine(l));
    }

    // Footer (exclusions)
    for (const t of (footer_lines || [])) {
      if (t && t.trim()) qbLines.push(descLine(t));
    }

    // Assign LineNum/Id sequentially
    qbLines.forEach((ln, i) => {
      ln.Id = String(i + 1);
      ln.LineNum = i + 1;
    });

    const estimate = {
      CustomerRef: { value: customerRef },
      Line: qbLines,
      GlobalTaxCalculation: "TaxExcluded",
      CustomerMemo: memo ? { value: memo } : undefined,
      BillEmail: customer_email ? { Address: customer_email } : undefined,
      ShipAddr: address ? { Line1: address } : undefined,
      ...(doc_number ? { DocNumber: String(doc_number).slice(0, 21) } : {}),
      ...(txn_date ? { TxnDate: txn_date } : {}),
      ...(expiration_date ? { ExpirationDate: expiration_date } : {}),
      ...(custom_fields ? {
        CustomField: [
          custom_fields.contract_type ? { DefinitionId: "1", Name: "TYPE DE CONTRAT", Type: "StringType", StringValue: String(custom_fields.contract_type).slice(0, 31) } : null,
          custom_fields.project_address ? { DefinitionId: "2", Name: "PROJET", Type: "StringType", StringValue: String(custom_fields.project_address).slice(0, 31) } : null,
          custom_fields.project_no ? { DefinitionId: "3", Name: "NO. PROJET", Type: "StringType", StringValue: String(custom_fields.project_no).slice(0, 31) } : null,
        ].filter(Boolean),
      } : {}),
    } as Record<string, unknown>;

    console.log("Creating QB estimate with", qbLines.length, "lines for customer", customerRef);

    const qbResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/estimate?minorversion=73`, {
      method: "POST", headers, body: JSON.stringify(estimate),
    });
    const qbData = await qbResp.json();

    if (!qbResp.ok) {
      console.error("QB create estimate failed:", JSON.stringify(qbData));
      return new Response(JSON.stringify({ error: "QB estimate creation failed", details: qbData }), {
        status: qbResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qbEstimateId = qbData.Estimate?.Id;
    const qbEstimateNumber = qbData.Estimate?.DocNumber;
    console.log("QB Estimate created:", qbEstimateId, "DocNumber:", qbEstimateNumber);

    // ── Upload attachments to QBO via Attachable API ──
    const attachmentResults: { name: string; ok: boolean; error?: string }[] = [];
    if (Array.isArray(attachments) && attachments.length > 0 && qbEstimateId) {
      for (const att of attachments) {
        try {
          const fileResp = await fetch(att.url);
          if (!fileResp.ok) {
            attachmentResults.push({ name: att.name, ok: false, error: `download ${fileResp.status}` });
            continue;
          }
          const fileBuf = await fileResp.arrayBuffer();
          const fileBlob = new Blob([fileBuf], { type: "application/pdf" });

          const meta = {
            AttachableRef: [{
              EntityRef: { type: "Estimate", value: String(qbEstimateId) },
              IncludeOnSend: true,
            }],
            FileName: att.name,
            ContentType: "application/pdf",
          };

          const form = new FormData();
          form.append(
            "file_metadata_0",
            new Blob([JSON.stringify(meta)], { type: "application/json" }),
            "metadata.json",
          );
          form.append("file_content_0", fileBlob, att.name);

          const upResp = await fetch(
            `${QB_API_BASE}/v3/company/${realmId}/upload?minorversion=73`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/json",
              },
              body: form,
            },
          );
          const upData = await upResp.json();
          if (!upResp.ok) {
            console.error("QB attachment upload failed:", att.name, JSON.stringify(upData));
            attachmentResults.push({ name: att.name, ok: false, error: JSON.stringify(upData).slice(0, 200) });
          } else {
            console.log("QB attachment uploaded:", att.name);
            attachmentResults.push({ name: att.name, ok: true });
          }
        } catch (e) {
          console.error("Attachment error:", att.name, e);
          attachmentResults.push({ name: att.name, ok: false, error: String(e).slice(0, 200) });
        }
      }
    }

    // Fetch the PDF from QuickBooks
    let pdfBase64: string | null = null;
    try {
      const pdfResp = await fetch(`${QB_API_BASE}/v3/company/${realmId}/estimate/${qbEstimateId}/pdf?minorversion=73`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/pdf",
        },
      });

      if (pdfResp.ok) {
        const pdfBuffer = await pdfResp.arrayBuffer();
        // Convert to base64 for transfer
        const uint8 = new Uint8Array(pdfBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        pdfBase64 = btoa(binary);
        console.log("QB PDF retrieved, size:", pdfBuffer.byteLength);

        // Store PDF in Supabase Storage
        const fileName = `qb_estimate_${qbEstimateId}_${Date.now()}.pdf`;
        const { error: uploadErr } = await supabase.storage
          .from("quote-pdfs")
          .upload(fileName, pdfBuffer, { contentType: "application/pdf", upsert: true });

        if (uploadErr) {
          console.error("Failed to upload QB PDF to storage:", uploadErr);
        } else {
          // Bucket is private — generate a 7-day signed URL for QBO consumers.
          const { data: signed } = await supabase.storage
            .from("quote-pdfs")
            .createSignedUrl(fileName, 7 * 24 * 60 * 60);
          const signedUrl = signed?.signedUrl ?? null;
          console.log("QB PDF stored, signed URL ready:", !!signedUrl);

          return new Response(JSON.stringify({
            success: true,
            qb_estimate_id: qbEstimateId,
            qb_estimate_number: qbEstimateNumber,
            pdf_url: signedUrl,
            attachments: attachmentResults,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } else {
        console.error("Failed to fetch QB PDF:", pdfResp.status);
      }
    } catch (pdfErr) {
      console.error("Error fetching QB PDF:", pdfErr);
    }

    // Fallback response without PDF URL
    return new Response(JSON.stringify({
      success: true,
      qb_estimate_id: qbEstimateId,
      qb_estimate_number: qbEstimateNumber,
      pdf_base64: pdfBase64,
      attachments: attachmentResults,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("quickbooks-push-invoice error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
