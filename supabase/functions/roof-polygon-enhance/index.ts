const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    console.log('roof-polygon-enhance v2 (inline data URL)');
    const { image_b64, model = 'real-esrgan-x4' } = await req.json();
    if (!image_b64 || typeof image_b64 !== 'string') {
      return new Response(JSON.stringify({ error: 'image_b64 required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = Deno.env.get('REPLICATE_API_TOKEN');
    if (!token) {
      // Mock fallback : return original image, scaleFactor=1
      return new Response(JSON.stringify({
        upscaledUrl: image_b64,
        scaleFactor: 1,
        mocked: true,
        message: 'REPLICATE_API_TOKEN absent — image originale renvoyée sans amélioration.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Real-ESRGAN x4 caps input at ~2M pixels (≈1448x1448). If the incoming
    // image is already huge (e.g. user re-enhances an already upscaled
    // result), downscale it server-side before sending to Replicate.
    const MAX_INPUT_PIXELS = 2_000_000;
    let inputImage = image_b64;
    try {
      const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(image_b64);
      if (m) {
        const mime = m[1];
        const bin = atob(m[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // Decode via ImageBitmap (available in Deno edge runtime via Web APIs)
        const blob = new Blob([bytes], { type: mime });
        // @ts-ignore - createImageBitmap exists in edge runtime
        const bmp: ImageBitmap = await createImageBitmap(blob);
        const pixels = bmp.width * bmp.height;
        if (pixels > MAX_INPUT_PIXELS) {
          const ratio = Math.sqrt(MAX_INPUT_PIXELS / pixels);
          const w = Math.floor(bmp.width * ratio);
          const h = Math.floor(bmp.height * ratio);
          // @ts-ignore - OffscreenCanvas in edge runtime
          const off = new OffscreenCanvas(w, h);
          const ctx = off.getContext('2d');
          if (ctx) {
            // @ts-ignore
            ctx.drawImage(bmp, 0, 0, w, h);
            const out: Blob = await off.convertToBlob({ type: 'image/png' });
            const buf = new Uint8Array(await out.arrayBuffer());
            let s = '';
            const CHUNK = 8192;
            for (let i = 0; i < buf.length; i += CHUNK) {
              s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)));
            }
            inputImage = `data:image/png;base64,${btoa(s)}`;
            console.log(`Downscaled input ${bmp.width}x${bmp.height} (${pixels}px) → ${w}x${h} (${w*h}px)`);
          }
        }
        bmp.close?.();
      }
    } catch (e) {
      console.warn('Could not pre-resize input, sending as-is:', e);
    }

    // Use the official model endpoint (always latest version) instead of pinned hash
    const create = await fetch('https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=5',
      },
      body: JSON.stringify({
        input: { image: inputImage, scale: 4, face_enhance: false },
      }),
    });
    if (!create.ok) {
      const t = await create.text();
      console.error('Replicate create failed', create.status, t);
      throw new Error(`Replicate create failed [${create.status}]: ${t}`);
    }
    let prediction = await create.json();
    console.log('Replicate prediction created', prediction.id, prediction.status);
    const startedAt = Date.now();
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && Date.now() - startedAt < 90_000) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(prediction.urls.get, { headers: { 'Authorization': `Bearer ${token}` } });
      prediction = await poll.json();
    }
    if (prediction.status !== 'succeeded') {
      console.error('Prediction failed', prediction.status, prediction.error, prediction.logs);
      throw new Error(`Prediction status: ${prediction.status} — ${prediction.error || 'timeout'}`);
    }
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error(`Replicate output is not a URL: ${JSON.stringify(prediction.output)}`);
    }
    // Fetch the upscaled PNG and inline it as a data URL so the browser
    // never has to deal with cross-origin image loads (which break canvas
    // composition in production).
    let imageDataUrl: string | null = null;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Fetch upscaled failed: ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || 'image/png';
      // Chunked base64 encoding to avoid stack overflows on large buffers
      let bin = '';
      const CHUNK = 8192;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)));
      }
      imageDataUrl = `data:${ct};base64,${btoa(bin)}`;
      console.log('Enhance: inlined image', { contentType: ct, bytes: buf.length });
    } catch (e) {
      console.warn('Enhance: could not inline image, returning URL only', e);
    }
    return new Response(JSON.stringify({
      upscaledUrl: url,
      image_b64: imageDataUrl,
      scaleFactor: 4,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('roof-polygon-enhance error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});