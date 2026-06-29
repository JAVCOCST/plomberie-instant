-- Active learning : compute_review_priority(takeoff_id)
--
-- Formule conformément au brief Phase 4 refonte training-lab :
--   review_priority = (1 - confidence_score)
--                   + correction_weight
--                   + complexity_score
--                   + rarity_score
--
-- confidence_score : tiré du prediction_json (metadata.regularization.axis_confidence
--                    quand dispo, sinon proxy via score moyen des sections kept).
-- correction_weight : roof_model_diff.correction_weight (0 = parfait, 1 = total rewrite).
-- complexity_score  : log(n_sections_human + 1) / log(15) → [0, 1.x]
-- rarity_score      : 1 si roof_type majoritaire ∈ {tower, flat} (rare),
--                     0.5 si ∈ {gable, shed} (moyennement rare),
--                     0 si hip (common).

CREATE OR REPLACE FUNCTION public.compute_review_priority(
  p_takeoff_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row     public.training_roof_takeoffs%ROWTYPE;
  v_conf    numeric := 0.5;
  v_cw      numeric := 0.5;
  v_complex numeric := 0.5;
  v_rarity  numeric := 0.0;
  v_nsec    integer;
  v_rtype   text;
BEGIN
  SELECT * INTO v_row FROM public.training_roof_takeoffs WHERE id = p_takeoff_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 1. confidence_score
  SELECT COALESCE(
    (v_row.postprocessed_json -> 'metadata' -> 'regularization' ->> 'axis_confidence')::numeric,
    (v_row.prediction_json    -> 'metadata' -> 'regularization' ->> 'axis_confidence')::numeric,
    (v_row.roof_sections_v16  -> 'metadata' -> 'regularization' ->> 'axis_confidence')::numeric,
    0.5
  ) INTO v_conf;

  -- 2. correction_weight
  v_cw := COALESCE((v_row.roof_model_diff ->> 'correction_weight')::numeric, 0.5);

  -- 3. complexity_score (log scale sur nb de sections)
  v_nsec := COALESCE(jsonb_array_length(v_row.roof_model -> 'sections'), 0);
  v_complex := LEAST(1.0, ln(GREATEST(1, v_nsec) + 1) / ln(15));

  -- 4. rarity_score (type majoritaire)
  IF v_row.roof_model IS NOT NULL THEN
    SELECT s ->> 'roof_type' INTO v_rtype
    FROM jsonb_array_elements(v_row.roof_model -> 'sections') s
    GROUP BY s ->> 'roof_type'
    ORDER BY COUNT(*) DESC
    LIMIT 1;
    v_rarity := CASE
      WHEN v_rtype IN ('tower','flat')  THEN 1.0
      WHEN v_rtype IN ('gable','shed')  THEN 0.5
      ELSE 0.0
    END;
  END IF;

  RETURN (1.0 - v_conf) + v_cw + v_complex + v_rarity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_review_priority(uuid) TO authenticated, service_role;

-- Trigger : recompute review_priority à chaque INSERT/UPDATE des champs pertinents.
CREATE OR REPLACE FUNCTION public.touch_review_priority() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.roof_model         IS DISTINCT FROM OLD.roof_model
     OR NEW.roof_model_diff    IS DISTINCT FROM OLD.roof_model_diff
     OR NEW.prediction_json    IS DISTINCT FROM OLD.prediction_json
     OR NEW.postprocessed_json IS DISTINCT FROM OLD.postprocessed_json
  THEN
    NEW.review_priority := public.compute_review_priority(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_takeoff_review_priority ON public.training_roof_takeoffs;
CREATE TRIGGER trg_takeoff_review_priority
  BEFORE INSERT OR UPDATE ON public.training_roof_takeoffs
  FOR EACH ROW EXECUTE FUNCTION public.touch_review_priority();

-- Backfill une fois sur tous les rows existants
UPDATE public.training_roof_takeoffs
SET review_priority = public.compute_review_priority(id)
WHERE review_priority IS NULL;
