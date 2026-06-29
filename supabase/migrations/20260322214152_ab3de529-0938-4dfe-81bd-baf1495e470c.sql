
-- Add status column to soumissions
ALTER TABLE public.soumissions 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

-- Allow authenticated users to update and delete soumissions
CREATE POLICY "Authenticated users can update soumissions"
ON public.soumissions FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete soumissions"
ON public.soumissions FOR DELETE
TO authenticated
USING (true);
