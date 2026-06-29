import { supabase } from '@/integrations/supabase/client';

export const STORAGE_BUCKET = 'quote-pdfs';

/** Default signed-URL TTL for quote PDFs (15 minutes — admin-session preview). */
export const QUOTE_PDF_SIGNED_URL_TTL = 15 * 60;

/** Long TTL for URLs persisted in DB (notes, dynasty_breakdown, email attachments).
 *  Bucket is private + paths use UUIDs, so a long signed URL is equivalent to a
 *  capability link. 7 days is a safe upper bound for downstream consumers. */
export const QUOTE_PDF_LONG_TTL = 7 * 24 * 60 * 60;

/**
 * Create a short-lived signed URL for a private `quote-pdfs` object.
 * Returns `null` if the object cannot be signed (missing, RLS denied, etc.).
 * Replaces every legacy `getPublicUrl()` usage now that the bucket is private.
 */
export async function getSignedQuotePdfUrl(
  path: string,
  expiresIn = QUOTE_PDF_SIGNED_URL_TTL,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    if (error) console.warn('[pdf-storage] createSignedUrl failed', { path, error });
    return null;
  }
  return data.signedUrl;
}

const stripDiacritics = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getStreetAndCity = (formattedAddress?: string | null) => {
  const addrParts = (formattedAddress || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return addrParts.slice(0, 2).join(', ').toUpperCase();
};

export const buildPdfDisplayBase = (seqNumber: number, formattedAddress?: string | null) => {
  const streetAndCity = getStreetAndCity(formattedAddress);
  return `VB_${seqNumber}_${streetAndCity}`
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const toPdfStorageBase = (displayBase: string) =>
  stripDiacritics(displayBase.toUpperCase())
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const getPdfAddressFragments = (formattedAddress?: string | null) => {
  const streetAndCity = getStreetAndCity(formattedAddress);

  return Array.from(
    new Set(
      [
        toPdfStorageBase(streetAndCity),
        stripDiacritics(streetAndCity.toUpperCase())
          .replace(/[/\\?%*:|"<>]/g, '')
          .replace(/[^A-Z0-9_-]+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, ''),
      ].filter(Boolean),
    ),
  );
};

export const buildPdfBucketSearchTerms = (seqNumber: number, formattedAddress?: string | null) =>
  Array.from(new Set([`VB_${seqNumber}_`, ...getPdfAddressFragments(formattedAddress)].filter(Boolean)));

export const matchesPdfStorageFilename = (
  filename: string,
  seqNumber: number,
  formattedAddress?: string | null,
  kind: 'client' | 'internal' = 'client',
) => {
  const normalizedFilename = toPdfStorageBase(filename);

  if (kind === 'client') {
    if (!normalizedFilename.endsWith('_PDF') || normalizedFilename.endsWith('_COMPLET_PDF')) {
      return false;
    }
  } else if (!normalizedFilename.endsWith('_COMPLET_PDF')) {
    return false;
  }

  const expectedSuffix = kind === 'internal' ? '_COMPLET_PDF' : '_PDF';
  const patterns = [
    new RegExp(`^VB_${seqNumber}_.+${escapeRegExp(expectedSuffix)}$`),
    ...getPdfAddressFragments(formattedAddress).map(
      (fragment) => new RegExp(`^VB_[0-9]+_.*${escapeRegExp(fragment)}${escapeRegExp(expectedSuffix)}$`),
    ),
  ];

  return patterns.some((pattern) => pattern.test(normalizedFilename));
};

export const buildPdfStorageObjectPaths = (seqNumber: number, formattedAddress?: string | null) => {
  const displayBase = buildPdfDisplayBase(seqNumber, formattedAddress);
  const storageBase = toPdfStorageBase(displayBase);

  return {
    base: storageBase,
    clientPath: `${storageBase}.pdf`,
    internalPath: `${storageBase}_COMPLET.pdf`,
  };
};

/**
 * Resolve signed URLs for the candidate object paths of a quote PDF.
 * `projectUrl` is no longer used (private bucket → no public URL form),
 * but the parameter is kept so existing call-sites compile.
 */
export const buildPdfUrlCandidates = async (
  _projectUrl: string,
  seqNumber: number,
  formattedAddress?: string | null,
): Promise<{ client: string[]; internal: string[] }> => {
  const displayBase = buildPdfDisplayBase(seqNumber, formattedAddress);
  const safeBase = toPdfStorageBase(displayBase);
  const legacyBase = displayBase.replace(/\s/g, '_');

  const bases = Array.from(new Set([safeBase, legacyBase].filter(Boolean)));
  const sign = async (filename: string) => getSignedQuotePdfUrl(filename);

  const client = (await Promise.all(bases.map((b) => sign(`${b}.pdf`)))).filter((u): u is string => !!u);
  const internal = (await Promise.all(bases.map((b) => sign(`${b}_COMPLET.pdf`)))).filter((u): u is string => !!u);
  return { client, internal };
};
