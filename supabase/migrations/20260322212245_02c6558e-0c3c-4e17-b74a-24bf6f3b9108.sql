-- Allow authenticated users to read soumissions (admin portal)
CREATE POLICY "Authenticated users can read soumissions"
ON soumissions FOR SELECT TO authenticated USING (true);