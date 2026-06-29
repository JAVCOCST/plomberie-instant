# Training Lab — état v1.6 (au 2026-05-30)

Snapshot factuel du pipeline MVP `roof_sections v1.6` → annotation humaine →
export pour entraînement. Tous les pointeurs sont au format `fichier:ligne`
pour navigation directe.

## TL;DR

Le pipeline **complet est branché et fonctionnel** : ingestion v1.6 →
préannotation → correction humaine dans le tracer → revue → export ZIP. Les
14 tests d'adapter sont verts. Ce qui manque relève du **polish opérationnel**
(scoring automatique, transitions auto, KPIs de revue), pas de la plomberie.

---

## Ce qui est fait et vert

### 1. Couche canonique (types + adapter)

| Pièce | Fichier | État |
|---|---|---|
| Type `RoofModel` canonique | `src/lib/roof-core/types.ts` | OK |
| Adapter MVP v1.6 → `RoofModel` | `src/lib/roof-core/adapters/fromRoofSectionsV16.ts` | OK — schema-aligned (`97ca982`) |
| Tests adapter | `…/fromRoofSectionsV16.test.ts` | **14/14 verts** |

Contrat respecté à la lettre (en-tête de `fromRoofSectionsV16.ts`) :
- `selection_status === "kept"` → section ACTIVE (vérité géométrique).
- `"alternative"` → fantôme, **HORS géométrie**, pas d'auto-promotion.
- `"rejected"` → debug only.
- `relationship_type` / `parent_id` / `pair_relations` / `n_rejected_as_gutter`
  → metadata pure, n'influencent JAMAIS l'activation.
- `sections[0]` (S1) = toujours actif (main).
- `points` déjà en pixels image → aucune projection.
- `pitch` déjà en X/12 (défaut 7).

### 2. Wiring lab → tracer → DB

- `AdminTrainingLab.tsx:163-178` : si `row.roof_sections_v16` présent →
  `fromRoofSectionsV16(...)` → `initialModel` pour le tracer.
- `AdminTrainingLab.tsx:186` : au save depuis le tracer →
  `roof_model` (truth corrigée) + `dataset_status: 'validated'`.
- `roof_sections_v16` d'origine **jamais touché** — on garde l'input MVP
  pour ré-évaluer en cas de changement de modèle.

### 3. Transitions de `dataset_status`

8 statuts définis (`training-lab.ts:4-12`) : `draft`, `needs_review`,
`calibration_issue`, `corrected`, `validated`, `ready_for_training`,
`exported`, `rejected`.

Transitions câblées :

| Action | Transition | Pointeur |
|---|---|---|
| Création row | → `draft` (auto) | `training-lab.ts:500` |
| Save annotation depuis le tracer | → `validated` (auto) | `AdminTrainingLab.tsx:186` |
| Bouton « Prêt pour entraînement » | → `ready_for_training` (manuel) | `AdminTrainingLab.tsx:237` |
| Export ZIP réussi | → `exported` (auto) + `export_batch_id` posé | `AdminTrainingLab.tsx:291` |
| Dropdown direct (override) | → n'importe lequel | `AdminTrainingLab.tsx:622-627` |

### 4. Export batch ZIP

Implémenté de bout en bout dans `training-lab.ts:344-423` (JSZip) :
- Un dossier par dataset (référence), contenant :
  - `roof_sections_v16.json` (input MVP)
  - `roof_model.json` (truth humaine)
  - `image.png` (capture)
  - `notes.md` (adresse + statut + score + tags + notes humaines)
- `manifest.json` racine avec liste des datasets et leur readiness.
- `quality_summary.csv` (référence, score, statut).

Pré-vol export (`training-lab.ts:284-289`) refuse si :
- `quality_score == null`
- `dataset_status !== 'ready_for_training'`

### 5. Calibration

`CalibrationEditor.tsx` (16 KB) + champs DB (`calibration_offset_px/m`,
`rotation_deg`, `scale`, `confidence`, `notes`). Statut `calibration_issue`
filtrable. Pas vérifié en détail dans cette passe — à auditer si suspect.

### 6. Misc récent

- `7cdf055` : images Google referrer-restricted (no-referrer header).
- `facb2e8` : training-lab utilisé comme **shell autour de AdminRoofStudio**
  (le tracer reste la seule UI d'annotation, le lab orchestre).
- `ad45bc9` : annotations re-ouvrables (save / rename / load).

---

## Ce qui n'est PAS fait

### Pas critique mais utile

- **`quality_score` est 100 % manuel** (input dans `AdminTrainingLab.tsx:642`).
  Pas de calcul automatique (ex. IoU geom v1.6 vs roof_model corrigé,
  nombre d'edits humains, complétude des champs `_no`, etc.). Bloquant pour
  l'export tant que l'opérateur ne saisit pas un chiffre.
- **Aucune transition auto `draft → needs_review`**. La row reste en `draft`
  jusqu'à intervention manuelle (dropdown) ou save tracer (qui saute direct
  à `validated`). Le statut `needs_review` est donc rarement atteint en
  pratique.
- **`corrected` jamais utilisé en sortie automatique** — on saute de
  `draft`/`needs_review` à `validated`. Soit on retire le statut, soit on
  câble une étape intermédiaire (ex. validation par un 2e relecteur).
- **Pas de KPI de revue** dans le dashboard (combien en `needs_review`,
  délai moyen, etc.).

### Polish / suite logique

- **Diff visuel v1.6 vs roof_model corrigé** pour audit rapide des
  corrections fréquentes (nourrir le retraining de l'amont).
- **Bulk-action toolbar** : exporter / marquer / tagger N datasets d'un
  coup (le filtrage existe déjà côté `training-lab.ts:247-259`).
- **Re-run adapter** sur tous les `roof_sections_v16` quand le schema bouge
  (le `_orig` est gardé, donc faisable sans re-fetch). Pas de bouton.

---

## Décisions de design importantes (pour ne pas casser)

1. `roof_sections_v16` est **immutable** côté lab. Seul `roof_model` change.
2. Le tracer (`AdminRoofStudio`) reste la **seule** UI d'annotation —
   pas de mini-éditeur dans le lab.
3. Les `points` v1.6 sont en pixels image, **pas** en lat/lng — aucune
   projection nécessaire à l'import.
4. `S1` est toujours actif, peu importe son `selection_status` — règle
   contractuelle, ne pas la dégrader « pour cohérence ».

---

## Prochaines pistes (à arbitrer)

Par ordre de ROI estimé :

1. **Auto-score qualité** (déverrouille l'export sans saisie manuelle).
2. **Transition `draft → needs_review` à la création** (rend les statuts
   filtrables utiles dès l'arrivée).
3. **Diff v1.6 vs corrigé** dans la fiche dataset (boucle de feedback amont).
4. **Bulk export** depuis le tableau de bord.
5. **Audit `CalibrationEditor`** — pas regardé en détail cette passe.
