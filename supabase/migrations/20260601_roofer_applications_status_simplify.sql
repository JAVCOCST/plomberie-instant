-- Migration : simplification des statuts (6 → 4)
-- Map les anciens statuts vers le nouveau modèle :
--   new          → new        (inchangé)
--   reviewing    → new        (à re-trier dans nouveau workflow)
--   interviewing → to_contact (entrevue = action immédiate du recruteur)
--   hired        → interesting (gardé en favori — pas un "statut final")
--   rejected     → rejected   (inchangé)
--   archived     → rejected   (archivé = sorti du pipeline = équivalent rejected)

UPDATE public.roofer_applications
SET status = CASE
  WHEN status = 'reviewing'    THEN 'new'
  WHEN status = 'interviewing' THEN 'to_contact'
  WHEN status = 'hired'        THEN 'interesting'
  WHEN status = 'archived'     THEN 'rejected'
  ELSE status
END
WHERE status IN ('reviewing', 'interviewing', 'hired', 'archived');
