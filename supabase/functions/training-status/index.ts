/**
 * training-status
 * ===============
 *
 * Poll GitHub API pour récupérer le statut courant d'un run YOLOv8-OBB,
 * met à jour la row training_runs en BD, et retourne l'état au frontend.
 *
 * Le frontend appelle cette function toutes les 30s pendant qu'un run est
 * en cours pour rafraîchir la progress bar.
 *
 * Secret requis : GITHUB_TOKEN (lecture seule suffit, scope 'Actions: Read')
 *
 * Input body :
 *   { training_run_id: string }   // l'id de la row training_runs créée par
 *                                    training-launch
 *
 * Output JSON :
 *   {
 *     status: 'dispatched' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled',
 *     github_run_id: number | null,
 *     github_run_url: string | null,
 *     started_at: string,
 *     finished_at: string | null,
 *     conclusion: string | null,
 *     duration_sec: number | null,
 *   }
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const GITHUB_REPO = "JAVCOCST/webflow-quote-builder";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  let body: { training_run_id?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const trId = body.training_run_id;
  if (!trId) {
    return new Response(JSON.stringify({ error: "training_run_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false } },
  );

  // Charge la row training_runs
  const { data: run } = await sb.from("training_runs")
    .select("*").eq("id", trId).single();
  if (!run) {
    return new Response(JSON.stringify({ error: "training_run not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Si déjà terminé (success/failure/cancelled), on renvoie le cache BD
  if (["success", "failure", "cancelled"].includes(run.status)) {
    return new Response(JSON.stringify({
      status: run.status,
      github_run_id: run.github_run_id,
      github_run_url: run.github_run_url,
      started_at: run.started_at,
      finished_at: run.finished_at,
      conclusion: run.status,
      duration_sec: run.finished_at
        ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
        : null,
      cached: true,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const ghToken = (Deno.env.get("GITHUB_TOKEN") || "").trim();
  if (!ghToken) {
    return new Response(JSON.stringify({
      error: "GITHUB_TOKEN secret manquant côté Supabase Edge Functions",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Si on a un github_run_id, on poll directement
  let ghRunId: number | null = run.github_run_id;
  let ghRunUrl: string | null = run.github_run_url;

  // Si on n'a pas encore le run_id (dispatch trop récent au lancement), on
  // tente de le retrouver dans les runs récents
  if (!ghRunId) {
    try {
      const runsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/train-yolo-obb.yml/runs?event=workflow_dispatch&per_page=10`;
      const r = await fetch(runsUrl, {
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/vnd.github+json",
        },
      });
      if (r.ok) {
        const d = await r.json();
        const startedMs = new Date(run.started_at).getTime();
        // Le run le plus proche du started_at (par created_at)
        const candidate = (d.workflow_runs || [])
          .map((x: any) => ({ ...x, _delta: Math.abs(new Date(x.created_at).getTime() - startedMs) }))
          .sort((a: any, b: any) => a._delta - b._delta)[0];
        if (candidate && candidate._delta < 120_000) {
          ghRunId = candidate.id;
          ghRunUrl = candidate.html_url;
          await sb.from("training_runs")
            .update({ github_run_id: ghRunId, github_run_url: ghRunUrl })
            .eq("id", trId);
        }
      }
    } catch (e) {
      console.warn("Failed to find run_id:", e);
    }
  }

  if (!ghRunId) {
    return new Response(JSON.stringify({
      status: run.status,
      github_run_id: null,
      github_run_url: ghRunUrl,
      started_at: run.started_at,
      finished_at: null,
      conclusion: null,
      duration_sec: null,
      message: "Run dispatched, en attente que GitHub crée le job…",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Poll l'état du run
  try {
    const runUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${ghRunId}`;
    const r = await fetch(runUrl, {
      headers: {
        "Authorization": `Bearer ${ghToken}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (!r.ok) {
      throw new Error(`GitHub API returned ${r.status}`);
    }
    const ghRun = await r.json();

    // Mapping GitHub status → notre status
    // GitHub : queued | in_progress | completed
    // GitHub conclusion (si completed) : success | failure | cancelled | timed_out | skipped
    let mapped: string;
    if (ghRun.status === "completed") {
      mapped = ghRun.conclusion === "success" ? "success"
        : ghRun.conclusion === "cancelled" ? "cancelled"
        : "failure";
    } else if (ghRun.status === "queued") {
      mapped = "queued";
    } else {
      mapped = "in_progress";
    }

    const finishedAt = ghRun.status === "completed"
      ? (ghRun.updated_at || new Date().toISOString())
      : null;

    await sb.from("training_runs").update({
      status: mapped,
      github_run_url: ghRun.html_url,
      finished_at: finishedAt,
      last_polled_at: new Date().toISOString(),
    }).eq("id", trId);

    const duration = finishedAt
      ? Math.round((new Date(finishedAt).getTime() - new Date(run.started_at).getTime()) / 1000)
      : Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000);

    return new Response(JSON.stringify({
      status: mapped,
      github_run_id: ghRunId,
      github_run_url: ghRun.html_url,
      started_at: run.started_at,
      finished_at: finishedAt,
      conclusion: ghRun.conclusion,
      duration_sec: duration,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({
      error: `Poll GitHub failed: ${e.message}`,
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
