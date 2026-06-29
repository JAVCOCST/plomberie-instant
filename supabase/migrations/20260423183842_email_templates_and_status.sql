-- Templates de courriels pré-définis pour l'envoi de soumissions
CREATE TABLE IF NOT EXISTS public.quote_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read templates" ON public.quote_email_templates;
CREATE POLICY "Authenticated read templates" ON public.quote_email_templates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated manage templates" ON public.quote_email_templates;
CREATE POLICY "Authenticated manage templates" ON public.quote_email_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed quelques templates par défaut
INSERT INTO public.quote_email_templates (name, subject, body, is_default) VALUES
  (
    'Standard - Envoi de soumission',
    'Votre soumission de toiture — Toitures VB',
    'Bonjour {{client_name}},' || E'\n\n' ||
    'Vous trouverez ci-joint votre soumission pour les travaux de toiture' ||
    ' à l''adresse suivante : {{address}}.' || E'\n\n' ||
    'Montant estimé : {{total}}' || E'\n\n' ||
    'Cliquez sur les boutons ci-dessous pour accepter ou refuser cette soumission.' || E'\n\n' ||
    'Pour toute question, n''hésitez pas à nous contacter au 450-521-3227.' || E'\n\n' ||
    'Cordialement,' || E'\n' ||
    'L''équipe Toitures VB',
    true
  ),
  (
    'Suivi - Relance',
    'Suivi de votre soumission — Toitures VB',
    'Bonjour {{client_name}},' || E'\n\n' ||
    'Nous faisons suite à la soumission que nous vous avons envoyée pour' ||
    ' votre projet de toiture au {{address}}.' || E'\n\n' ||
    'Avez-vous eu la chance de la consulter ? Nous serions ravis de répondre' ||
    ' à toutes vos questions et de planifier les travaux selon votre disponibilité.' || E'\n\n' ||
    'Au plaisir de vous lire,' || E'\n' ||
    'L''équipe Toitures VB',
    false
  ),
  (
    'Court - Confirmation',
    'Soumission jointe — {{address}}',
    'Bonjour {{client_name}},' || E'\n\n' ||
    'Soumission ci-jointe pour {{total}}.' || E'\n\n' ||
    'Merci d''utiliser les boutons ci-dessous pour accepter ou refuser.' || E'\n\n' ||
    'Toitures VB',
    false
  )
ON CONFLICT DO NOTHING;

-- Colonnes pour suivre le statut email sur les soumissions
ALTER TABLE public.soumissions
  ADD COLUMN IF NOT EXISTS email_status text,        -- sent | accepted | declined | null
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_response_note text,
  ADD COLUMN IF NOT EXISTS email_recipient text,
  ADD COLUMN IF NOT EXISTS email_cc text,
  ADD COLUMN IF NOT EXISTS email_bcc text;

CREATE INDEX IF NOT EXISTS idx_soumissions_email_status ON public.soumissions(email_status);
