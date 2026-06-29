-- Create a public bucket for quote PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdfs', 'quote-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to upload PDFs (anonymous inserts for the quote form)
CREATE POLICY "Anyone can upload quote PDFs"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'quote-pdfs');

-- Allow anyone to read (public bucket)
CREATE POLICY "Anyone can read quote PDFs"
ON storage.objects
FOR SELECT
USING (bucket_id = 'quote-pdfs');