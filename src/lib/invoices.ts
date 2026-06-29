/**
 * Factures fournisseur — OCR (edge function `invoice-ocr`, Mistral/Gemini) +
 * persistance (table project_invoices) pour calculer le coûtant matériaux réel
 * d'un projet.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  is_material: boolean;
}

export interface ExtractedInvoice {
  supplier: string;
  invoice_number: string;
  invoice_date: string;
  currency: string;
  lines: InvoiceLine[];
  material_total: number;
  grand_total: number;
  engine: string;
}

export interface ProjectInvoice extends ExtractedInvoice {
  id: string;
  soumission_id: string | null;
  file_path: string | null;
  created_at: string;
}

/** Encode un fichier en base64 (sans le préfixe data:), par chunks. */
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** OCR + extraction structurée d'une facture (sans persistance).
 *  Passe une URL signée si dispo (évite un gros corps de requête), sinon base64. */
export async function ocrInvoiceFile(file: File, fileUrl?: string | null): Promise<ExtractedInvoice> {
  const mime = file.type || 'application/pdf';
  const body = fileUrl ? { file_url: fileUrl, mime } : { file_base64: await fileToBase64(file), mime };
  const { data, error } = await supabase.functions.invoke('invoice-ocr', { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as ExtractedInvoice;
}

/** Pipeline complet : upload (obligatoire) → URL publique → OCR → persistance.
 *  Le fichier est toujours téléversé d'abord et l'OCR se fait via l'URL : le
 *  corps de la requête reste minuscule (plus de « Failed to send a request »). */
export async function processInvoiceFile(soumissionId: string, file: File): Promise<ProjectInvoice> {
  const safe = file.name.replace(/[^\w.\-]/g, '_');
  const path = `invoices/${soumissionId}/${Date.now()}_${safe}`;
  const { error: upErr } = await supabase.storage.from('quote-pdfs').upload(path, file, { contentType: file.type || 'application/pdf', upsert: true });
  if (upErr) throw new Error(`Upload échoué : ${upErr.message}`);

  // quote-pdfs est public → URL publique directe (lisible par le moteur OCR).
  const { data: pub } = supabase.storage.from('quote-pdfs').getPublicUrl(path);
  const fileUrl = pub?.publicUrl ?? null;

  const ex = await ocrInvoiceFile(file, fileUrl);
  return saveProjectInvoice(soumissionId, ex, path);
}

/** Insère une facture extraite en base. */
export async function saveProjectInvoice(soumissionId: string, ex: ExtractedInvoice, filePath: string | null): Promise<ProjectInvoice> {
  const { data, error } = await db.from('project_invoices').insert({
    soumission_id: soumissionId,
    file_path: filePath,
    supplier: ex.supplier,
    invoice_number: ex.invoice_number,
    invoice_date: ex.invoice_date || null,
    currency: ex.currency,
    material_total: ex.material_total,
    grand_total: ex.grand_total,
    lines: ex.lines,
    raw: ex,
    engine: ex.engine,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as ProjectInvoice;
}

export async function loadProjectInvoices(soumissionId: string): Promise<ProjectInvoice[]> {
  const { data, error } = await db.from('project_invoices').select('*').eq('soumission_id', soumissionId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as ProjectInvoice[];
}

export async function deleteProjectInvoice(id: string): Promise<void> {
  const { error } = await db.from('project_invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
