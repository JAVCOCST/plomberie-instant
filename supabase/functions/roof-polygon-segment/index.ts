const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SAM2_VERSION = 'fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83';
const GROUNDED_SAM_VERSION = 'ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c';
const SAM_POINT_VERSION = '0fae4c357d9bdd3822a1c8d6cd949e2b78fab3c860f4ef9df1e01a171fe84906';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type SegmentPoint = { point: [number, number] | number[]; positive?: boolean };
const isSegmentPoint = (p: unknown): p is SegmentPoint => {
  if (!p || typeof p !== 'object') return false;
  const point = (p as { point?: unknown }).point;
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
};

async function createReplicatePrediction(token: string, version: string, input: Record<string, unknown>) {
  let lastBody = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const create = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=10',
      },
      body: JSON.stringify({ version, input }),
    });
    if (create.ok) return await create.json();
    lastBody = await create.text();
    if (create.status !== 429 || attempt === 3) {
      console.error('Replicate create failed', create.status, lastBody);
      throw new Error(`Replicate create failed [${create.status}]: ${lastBody}`);
    }
    const retryAfter = Number(create.headers.get('retry-after')) || Number(lastBody.match(/"retry_after"\s*:\s*(\d+)/)?.[1]) || 3;
    console.warn('Replicate throttled, retrying', { attempt: attempt + 1, retryAfter });
    await sleep((retryAfter + 1) * 1000);
  }
  throw new Error(`Replicate create failed: ${lastBody || 'rate limited'}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const { image_b64, mode, points, box, prompt } = body || {};
    if (!image_b64 || !mode) {
      return new Response(JSON.stringify({ error: 'image_b64 and mode required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = Deno.env.get('REPLICATE_API_TOKEN');

    if (!token) {
      // Mock fallback: build a polygon from inputs (so the UI is fully demoable without IA)
      let polygon: number[][] = [];
      if (mode === 'box' && Array.isArray(box) && box.length === 4) {
        const [x1, y1, x2, y2] = box;
        polygon = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      } else if (mode === 'click' && Array.isArray(points) && points.length > 0) {
        const positives = points.filter(isSegmentPoint).filter((p) => p.positive).map((p) => p.point);
        const cx = positives.reduce((a: number, p: number[]) => a + p[0], 0) / positives.length;
        const cy = positives.reduce((a: number, p: number[]) => a + p[1], 0) / positives.length;
        const r = 80;
        polygon = Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        });
      } else {
        polygon = [[100, 100], [300, 100], [300, 250], [100, 250]];
      }
      return new Response(JSON.stringify({
        polygon,
        mocked: true,
        message: 'REPLICATE_API_TOKEN absent — polygone synthétique renvoyé.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let input: Record<string, unknown> = {};
    let version = SAM2_VERSION;
    if (mode === 'text') {
      version = GROUNDED_SAM_VERSION;
      input = { image: image_b64, mask_prompt: prompt || 'roof', adjustment_factor: 0 };
    } else if (mode === 'click' && Array.isArray(points) && points.length > 0) {
      const validPoints = points.filter(isSegmentPoint);
      const positives = validPoints
        .filter((p) => p.positive !== false)
        .map((p) => [Math.round(Number(p.point[0])), Math.round(Number(p.point[1]))]);
      const negatives = validPoints
        .filter((p) => p.positive === false)
        .map((p) => [Math.round(Number(p.point[0])), Math.round(Number(p.point[1]))]);
      if (positives.length === 0) {
        return new Response(JSON.stringify({ error: 'click mode requires at least one positive point' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      version = SAM_POINT_VERSION;
      // Modèle accepte input_points (JSON 2D array) + labels optionnels (1=fg, 0=bg).
      // On envoie une liste unique tous-points + labels alignés.
      const allPts = [...positives, ...negatives];
      const labels = [
        ...positives.map(() => 1),
        ...negatives.map(() => 0),
      ];
      input = {
        image: image_b64,
        input_points: JSON.stringify(allPts),
        input_labels: JSON.stringify(labels),
      };
    } else {
      input = { image: image_b64, use_m2m: true };
    }

    let prediction = await createReplicatePrediction(token, version, input);
    console.log('Replicate prediction created', prediction.id, prediction.status);
    const startedAt = Date.now();
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && Date.now() - startedAt < 90_000) {
      await sleep(1500);
      const poll = await fetch(prediction.urls.get, { headers: { 'Authorization': `Bearer ${token}` } });
      prediction = await poll.json();
    }
    if (prediction.status !== 'succeeded') {
      console.error('Prediction failed', prediction.status, prediction.error, prediction.logs);
      throw new Error(`Prediction status: ${prediction.status} — ${prediction.error || 'timeout'}`);
    }

    const out = prediction.output;
    const individualMaskUrls = Array.isArray(out?.individual_masks) ? out.individual_masks : [];
    const maskUrl = Array.isArray(out) ? out[0] : out?.combined_mask || out?.mask || individualMaskUrls[0] || out;
    // Fetch mask & convert to base64 so client can decode it
    let maskBase64: string | null = null;
    if (typeof maskUrl === 'string' && maskUrl.startsWith('http')) {
      const r = await fetch(maskUrl);
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      maskBase64 = `data:image/png;base64,${btoa(bin)}`;
    }
    return new Response(JSON.stringify({ maskUrl, individualMaskUrls, maskBase64, polygon: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('roof-polygon-segment error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});