# Maximum 301 — état actuel (fin Phase 1C)

**Dernier commit `main` : `f677565`. 55 tests verts · build OK · typecheck src
propre (2 erreurs pré-existantes hors-sujet dans `StepDate.tsx`).**

---

## Où on en est

| Phase | Statut |
|---|---|
| Phase 0 (contrats builder) | ✅ intégrés : product-spec + anchor schema |
| Phase 1 (couche pure) | ✅ types / catalog / ventilation |
| Phase 1B (branchement traceur) | ✅ accessories[] dans l'état + save/reload |
| **Phase 1C (robustesse/orphan)** | ✅ **fait — validée** |
| Phase 2 (placement interactif) | ⏳ en attente du « GO » |

---

## Vérification Phase 1C (les 4 points demandés)

### 1. Survie aux opérations
| Opération | Résultat |
|---|---|
| promote / reject section MVP | ✅ survit (ne touche que secs/alts/rejected) |
| reset alt | ✅ survit |
| **rerun MVP** | ✅ **corrigé** — `importV16` ne wipe plus `accessories[]` |
| save/reload multiples | ✅ round-trip pass-through (testé) |
| rename annotation | ✅ survit |

### 2. Accessory sur `S1` reste valide si…
- géométrie change légèrement → S1 reste index 0 → non orphelin ✅
- suggestions changent → S1 inchangé ✅
- RoofModel rebuild → valide tant que S1 existe (testé) ✅

### 3. `accessory_orphaned` true/false
- Champ ajouté sur `AccessoryInstance` + `anchor.orphan_state` (`reason:
  "section_not_found"`).
- Effet qui re-marque le flag quand `secs` change (sans boucle).
- Compteur d'orphelins affiché dans la barre + bandeau REVIEW.

### 4. `anchor_version`
- `"1.0.0"` sur chaque anchor (via `makeAnchor`), préservé au round-trip (testé).

---

## Fichiers de la couche accessoires
```
src/lib/roof-accessories/
  max-301.product-spec.json     contrat verbatim (7 variantes, dims/NFA officiels)
  types.ts                      AccessoryInstance + AccessoryAnchor + ProductSpec + accessory_orphaned
  catalog.ts                    lit le spec (getVariant / nfa / defaultSlopeOffsetMm)
  anchor.ts                     validateAnchor (schema v1.0.0) + makeAnchor
  resolve.ts                    sectionIdsOf / isAccessoryOrphan / resolveAccessoryOrphans
  ventilationValidation.ts      moteur paramétrable (1/300|1/150, calibration_required)
  anchor.test.ts · resolve.test.ts · ventilationValidation.test.ts
src/lib/roof-core/annotation.ts (+ .test) round-trip accessories[] (pass-through)
src/pages/AdminRoofStudio.tsx   état accessories + RoofModel↓/↑ + effet orphan + bouton « + acc »
tsconfig.app.json               resolveJsonModule: true
```

---

## ⚠️ Limite connue (Phase 2)
`section_id` = dérivé de l'index (`"S"+(i+1)`). Supprimer un pan **antérieur**
décale les index → un accessoire peut se re-mapper. Vraie robustesse = **IDs de
section stables** (open question du README Phase 0). Le flag orphelin couvre la
**disparition** ; la résolution **edge-level** viendra avec l'anchor runtime Phase 2.

---

## Bouton « + acc » (test)
Dans la barre d'outils 2D (à côté de `RoofModel↓/↑`). Sur mobile : déplie d'abord
`▾ outils`. Il **ajoute la donnée** d'un Maximum 301-16 (anchor validé) — **aucun
visuel** ni déplacement encore : c'est le scope **Phase 2**.

---

## Phase 2 (au GO) — uniquement
clic faîtière → ghost preview → anchor runtime (résolution edge→monde) →
drag contraint (parallèle ridge / amont-aval) → save/reload du placement.

**PAS** : ventilation finale · take-off · soumission · rendu 3D final détaillé ·
clipping réel du mesh · collision avancée · gizmo CAD.
