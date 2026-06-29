-- Restore Marie-Josée Monette (archived by mistake)
UPDATE public.soumissions
SET status = 'to_contact'
WHERE id = 'df394f6f-8610-4397-8d17-a8497aebf493'
  AND status = 'archived';
