/**
 * training-launch
 * ===============
 *
 * Lance un entraînement YOLOv8-OBB côté GitHub Actions sans que l'utilisateur
 * aie à sortir du portail. Étapes :
 *   1. POST /repos/.../actions/workflows/train-yolo-obb.yml/dispatches
 *   2. Crée une row training_runs (status='dispatched')
 *   3. Retourne l'URL du run pour que le frontend puisse linker
 *
 * Le polling de l'état (in_progress / success / failure) est fait par une
 * 2e edge function `training-status` que le frontend appelle toutes les 30s.
 *
 * Secret requis (Supabase Edge Functions Secrets) :
 *   GITHUB_TOKEN — fine-grained PAT avec "Actions: Write" sur le repo
 *
 * Input body :
 *   {
 *     batch_id?: string       // optionnel — pour lier le run à un batch
 *     epochs?: number          // default 150
 *     imgsz?: number           // default 640
 *     model?: string           // default 'yolov8n-obb.pt'
 *   }
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const GITHUB_REPO = "JAVCOCST/webflow-quote-builder";
const WORKFLOW_FILE = "train-yolo-obb.yml";

interface LaunchPayload {
  batch_id?: string;
  epochs?: number;
  imgsz?: number;
  model?: string;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  let body: LaunchPayload = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const ghToken = (Deno.env.get("GITHUB_TOKEN") || "").trim();
  if (!ghToken) {
    return new Response(JSON.stringify({
      error: "GITHUB_TOKEN secret manquant. Crée un fine-grained PAT avec 'Actions: Write' sur le repo et ajoute-le dans Supabase Edge Functions Secrets.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const inputs: Record<string, string> = {
    epochs: String(body.epochs || 150),
    imgsz: String(body.imgsz || 640),
    model: body.model || "yolov8n-obb.pt",
  };

  // 1. Dispatch workflow via GitHub API
  const dispatchUrl =
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const dispatchResp = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs,
    }),
  });

  if (!dispatchResp.ok && dispatchResp.status !== 204) {
    const errBody = await dispatchResp.text().catch(() => "");
    return new Response(JSON.stringify({
      error: `GitHub workflow_dispatch failed (${dispatchResp.status}): ${errBody.slice(0, 300)}`,
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. GitHub workflow_dispatch retourne 204 No Content — pas de run_id direct.
  // On poll /actions/runs?event=workflow_dispatch pour trouver le run qui vient
  // d'être créé (le plus récent, dans les ~5 dernières secondes).
  await new Promise((r) => setTimeout(r, 2000)); // attente pour que GitHub crée la row

  let githubRunId: number | null = null;
  let githubRunUrl: string | null = null;
  try {
    const runsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`;
    const runsResp = await fetch(runsUrl, {
      headers: {
        "Authorization": `Bearer ${ghToken}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (runsResp.ok) {
      const runsData = await runsResp.json();
      const runs = Array.isArray(runsData.workflow_runs) ? runsData.workflow_runs : [];
      // Le plus récent (< 30s)
      const nowMs = Date.now();
      const recent = runs.find((r: any) => {
        const created = new Date(r.created_at).getTime();
        return nowMs - created < 30_000;
      });
      if (recent) {
        githubRunId = recent.id;
        githubRunUrl = recent.html_url;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch run_id:", e);
  }

  // 3. Crée la row training_runs
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false } },
  );

  const { data: runRow } = await sb
    .from("training_runs")
    .insert({
      batch_id: body.batch_id || null,
      github_run_id: githubRunId,
      github_run_url: githubRunUrl ||
        `https://github.com/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}`,
      status: "dispatched",
      workflow_inputs: inputs,
    })
    .select("id")
    .single();

  return new Response(JSON.stringify({
    ok: true,
    training_run_id: runRow?.id,
    github_run_id: githubRunId,
    github_run_url: githubRunUrl,
    message: githubRunId
      ? "Entraînement lancé — suivi en cours dans le portail"
      : "Workflow dispatch envoyé à GitHub, mais run_id pas encore trouvé. Va sur l'onglet Actions de ton repo pour voir le run.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
