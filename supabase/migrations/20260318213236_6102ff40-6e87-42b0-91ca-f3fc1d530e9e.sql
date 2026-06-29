-- Create sequence starting at 2000
CREATE SEQUENCE IF NOT EXISTS soumissions_seq_number_seq START WITH 2000;

-- Add seq_number column with auto-increment from sequence
ALTER TABLE public.soumissions
  ADD COLUMN IF NOT EXISTS seq_number integer NOT NULL DEFAULT nextval('soumissions_seq_number_seq');

-- Backfill existing rows
UPDATE public.soumissions SET seq_number = 2000 + row_num - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_num
  FROM public.soumissions
) sub
WHERE soumissions.id = sub.id;

-- Advance sequence past existing rows
SELECT setval('soumissions_seq_number_seq', (SELECT COALESCE(MAX(seq_number), 1999) + 1 FROM public.soumissions));