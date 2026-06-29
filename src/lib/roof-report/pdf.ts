/**
 * Rendu PDF du rapport via l'edge function html-to-pdf (PDFShift/Browserless).
 * Convertit le HTML, le téléverse dans Storage et renvoie { path, signedUrl }.
 */
import { supabase } from '@/integrations/supabase/client';

export interface ReportPdfResult { path: string; signedUrl: string | null }

export async function renderReportPdf(html: string, soumissionId: string | null | undefined, filename: string): Promise<ReportPdfResult> {
  const { data, error } = await supabase.functions.invoke('html-to-pdf', {
    body: { html, soumissionId: soumissionId || null, filename },
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as ReportPdfResult;
}
