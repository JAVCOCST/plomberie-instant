# HF Space — guide de déploiement (toi, 10 min)

## 1. Crée le compte Hugging Face (si pas déjà fait)

- https://huggingface.co/join → email + mot de passe → **gratuit, pas de carte**.
- Confirme ton email.

## 2. Crée la Space

- https://huggingface.co/new-space
- **Owner** : ton username
- **Space name** : `roof-sections-v16` (ou un autre, à toi de choisir)
- **License** : MIT
- **Select the Space SDK** : **Docker** (pas Gradio, pas Streamlit)
- Choisis le **template** : **Blank**
- **Hardware** : **CPU basic (free)** — c'est le plan gratuit, suffisant pour ce
  pipeline (CPU pur, pas de GPU requis).
- **Visibility** : **Public** (pour que le Training Lab puisse l'appeler sans
  jongler avec des tokens HF, vu que tu actives le `SHARED_SECRET` en étape 5).
- Clique **Create Space**.

## 3. Uploade les fichiers de ce dossier dans ta Space

Tu as 2 options.

### Option simple (web UI)

- Sur la page de ta Space → onglet **Files**.
- Clique **Add file** → **Upload files** → drag-drop **TOUT LE CONTENU** du
  dossier `huggingface-space/` (les 10 `.py`, le `app.py`, le `Dockerfile`, le
  `requirements.txt`, le `README.md`).
- Commit message : `initial deploy v1.6`.
- **Commit changes**.

### Option git (si t'es à l'aise)

```bash
git clone https://huggingface.co/spaces/<TON_USER>/roof-sections-v16
cd roof-sections-v16
cp -R /chemin/vers/huggingface-space/* .
git add . && git commit -m "initial deploy v1.6"
git push
```

## 4. Attends le build (~3–5 min la première fois)

- Onglet **App** → tu vois le log de build (`docker build`, install des deps).
- Quand c'est fini → message **Running** en vert.
- L'URL publique sera **`https://<TON_USER>-roof-sections-v16.hf.space`**.

## 5. Active le `SHARED_SECRET` (recommandé)

- Onglet **Settings** → section **Repository secrets** → **New secret**.
- Name : `SHARED_SECRET`.
- Value : un long mot de passe random (genre `openssl rand -hex 32` ou un
  password manager). Garde-le : tu vas me le donner pour que je le mette dans
  Supabase.
- La Space va se restart automatiquement (~30 s) pour prendre le secret.

## 6. Smoke test manuel

```bash
# Health check (doit retourner ok: true)
curl https://<TON_USER>-roof-sections-v16.hf.space/health

# Prédiction (image d'exemple : remplace par un .jpg réel)
curl -X POST \
  -H "Authorization: Bearer <TON_SHARED_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
        "image_b64": "data:image/jpeg;base64,/9j/4AAQ…",
        "prior_polygon_px": [[10,10],[100,10],[100,100],[10,100]],
        "roof_type": "mixed",
        "selection_mode": "conservative"
      }' \
  https://<TON_USER>-roof-sections-v16.hf.space/roof-sections/v1.6
```

## 7. Garde la Space éveillée (free tier)

- https://uptimerobot.com/ → compte gratuit (50 monitors).
- **Add New Monitor** → Monitor Type : HTTP(s).
- URL : `https://<TON_USER>-roof-sections-v16.hf.space/health`
- Interval : **5 minutes**.
- Friendly name : `roof-sections-v16 keep-alive`.
- Save.

Résultat : la Space reste warm 24/7. Plus de cold start après inactivité.

## 8. Reviens me voir avec

- L'URL de ta Space (`https://<TON_USER>-roof-sections-v16.hf.space`).
- La valeur de `SHARED_SECRET` (je la stocke dans Supabase comme env var, jamais
  dans le code app).

Je branche tout de suite après.
