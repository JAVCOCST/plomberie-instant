---
title: Roof Sections V16
emoji: 🏠
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: roof_sections v1.6 conservative pipeline (FastAPI)
---

# roof-sections v1.6 — Hugging Face Space

FastAPI wrapper around the `extract_roof_sections` pipeline. Designed to be
called by the Toitures VB Training Lab (Supabase / React) to produce
`sections-1.6.0` JSON pre-annotations.

## Endpoints

### `GET /health`

Health check — used by uptime monitors to keep the Space warm.

```json
{ "ok": true, "schema_version": "sections-1.6.0", "ts": 1780165432 }
```

### `POST /roof-sections/v1.6`

```jsonc
// Request body
{
  "image_b64": "data:image/jpeg;base64,…",
  "prior_polygon_px": [[x1, y1], [x2, y2], …],   // ≥ 3 points
  "roof_type": "mixed",                            // 2_pans | 4_pans | mixed
  "selection_mode": "conservative"                 // default
}
```

Returns the pipeline dict (`schema_version: "sections-1.6.0"` + `sections[]`).
See `roof_sections.py:extract_roof_sections` for the full contract.

## Auth (optional)

Set `SHARED_SECRET` in **Settings → Repository secrets** to require an
`Authorization: Bearer <secret>` header on `POST /roof-sections/v1.6`.
Left empty by default — endpoint is open.

## Keep alive

HF free Spaces sleep after ~48 h of inactivity. Cold start ~30–60 s. To stay
warm, point a free [UptimeRobot](https://uptimerobot.com/) monitor at
`/health` with a 5 min interval.

## Local dev

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 7860
```
