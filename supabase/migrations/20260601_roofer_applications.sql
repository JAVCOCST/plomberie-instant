-- Migration : table roofer_applications + bucket storage CV
-- Module Embauche — formulaire public de recrutement couvreurs

CREATE TABLE IF NOT EXISTS public.roofer_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Identité (prénom/nom/tél en premier, email à la fin du formulaire)
  prenom text NOT NULL,
  nom text NOT NULL,
  telephone text NOT NULL,
  email text,                              -- nullable (saisi à la fin, peut être skip)

  -- Cartes professionnelles
  carte_ccq boolean NOT NULL DEFAULT false,
  carte_ccq_niveau text,                   -- 'apprenti_1' | 'apprenti_2' | 'apprenti_3' | 'compagnon' | null
  carte_asp boolean NOT NULL DEFAULT false,

  -- Spécialités (multiple)
  spec_soudeur_sbs boolean NOT NULL DEFAULT false,
  spec_couvreur_bardeaux boolean NOT NULL DEFAULT false,
  spec_toiture_tole boolean NOT NULL DEFAULT false,
  spec_autre text,                         -- texte libre si "autre" coché

  -- Métadonnées candidat
  annees_experience integer,
  disponibilite text,                      -- 'immediate' | '2_semaines' | '1_mois' | 'autre'
  references_text text,
  notes text,

  -- CV (optionnel) → Storage bucket 'roofer-cvs'
  cv_storage_path text,                    -- ex: 'roofer-cvs/uuid.pdf'
  cv_filename text,
  cv_uploaded_at timestamptz,

  -- Tracking — comme les soumissions
  source text DEFAULT 'embauche_form',     -- 'embauche_form' | 'google_ads' | 'referral'
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer_url text,
  ip_address text,
  user_agent text,

  -- Statut côté recruteur (admin)
  status text NOT NULL DEFAULT 'new',      -- 'new' | 'reviewing' | 'interviewing' | 'hired' | 'rejected' | 'archived'
  reviewed_at timestamptz,                 -- premier "ouvert" par admin (tracking comme soumissions)
  reviewed_by uuid,                        -- auth.users.id
  admin_notes text
);

CREATE INDEX IF NOT EXISTS idx_roofer_applications_created_at
  ON public.roofer_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roofer_applications_status
  ON public.roofer_applications(status);

CREATE OR REPLACE FUNCTION public.set_updated_at_roofer_applications()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roofer_applications_updated_at ON public.roofer_applications;
CREATE TRIGGER trg_roofer_applications_updated_at
  BEFORE UPDATE ON public.roofer_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_roofer_applications();

-- RLS
ALTER TABLE public.roofer_applications ENABLE ROW LEVEL SECURITY;

-- Public peut INSERT (formulaire anonyme), mais pas SELECT
CREATE POLICY "Anyone can submit an application"
  ON public.roofer_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Authentifiés (admin) peuvent tout faire
CREATE POLICY "Authenticated users can read applications"
  ON public.roofer_applications
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update applications"
  ON public.roofer_applications
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete applications"
  ON public.roofer_applications
  FOR DELETE
  TO authenticated
  USING (true);

-- Storage bucket pour les CVs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'roofer-cvs',
  'roofer-cvs',
  false,                                    -- privé : accès via signed URL seulement
  10485760,                                 -- 10 MB max
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies : anon peut UPLOAD (pour le formulaire), authentifiés peuvent READ
CREATE POLICY "Anyone can upload a CV"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'roofer-cvs');

CREATE POLICY "Authenticated users can read CVs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'roofer-cvs');

CREATE POLICY "Authenticated users can delete CVs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'roofer-cvs');
