/**
 * vCard helpers — shared between AdminContacts, AdminDashboard and the
 * project detail modal so a single, consistent .vcf is produced everywhere.
 * Optionally embeds a PHOTO (base64) when a contact image URL is provided.
 */

export interface VCardContact {
  first_name: string;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  formatted_address?: string | null;
  /** Public URL of the contact photo (e.g. Street View capture). */
  photo_url?: string | null;
}

const isPlaceholderEmail = (v?: string | null) => {
  const e = (v || '').trim().toLowerCase();
  return !e || e.includes('@soumission.local') || e === 'inconnu@converti.ca';
};
const isPlaceholderLast = (v?: string | null) => {
  const l = (v || '').trim().toLowerCase();
  return !l || l === 'non fourni' || l === 'inconnu';
};

/** Fetch an image and return { base64, mime }. Returns null if it fails. */
export async function fetchPhotoBase64(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { b64: btoa(bin), mime };
  } catch {
    return null;
  }
}

/** Build a vCard 3.0 string. If `photo` is provided, embeds it via PHOTO;ENCODING=b. */
export function buildVCard(c: VCardContact, photo?: { b64: string; mime: string } | null): string {
  const last = isPlaceholderLast(c.last_name) ? '' : (c.last_name || '');
  const email = isPlaceholderEmail(c.email) ? '' : (c.email || '');
  const phone = c.phone && c.phone !== '000-000-0000' ? c.phone : '';
  const addr = c.formatted_address || '';
  const fullName = `${c.first_name} ${last}`.trim();
  const company = addr ? `Proprio – ${addr}` : '';

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${last};${c.first_name};;;`,
    `FN:${fullName}`,
    phone ? `TEL;TYPE=CELL:${phone}` : '',
    email ? `EMAIL:${email}` : '',
    company ? `ORG:${company}` : '',
    addr ? `ADR;TYPE=HOME:;;${addr};;;;` : '',
  ];

  if (photo?.b64) {
    // Format used by iOS Contacts; subtype after slash (e.g. JPEG, PNG)
    const subtype = (photo.mime.split('/')[1] || 'jpeg').toUpperCase();
    // Fold long base64 lines per RFC 2425 (75 chars + CRLF + space)
    const folded = photo.b64.match(/.{1,74}/g)?.join('\r\n ') || photo.b64;
    lines.push(`PHOTO;ENCODING=b;TYPE=${subtype}:${folded}`);
  }

  lines.push('END:VCARD');
  return lines.filter(Boolean).join('\r\n');
}

/** Trigger a .vcf download in the browser. */
export async function downloadContactVCard(c: VCardContact) {
  let photo: { b64: string; mime: string } | null = null;
  if (c.photo_url) photo = await fetchPhotoBase64(c.photo_url);
  const vcf = buildVCard(c, photo);
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const last = isPlaceholderLast(c.last_name) ? '' : (c.last_name || '');
  a.download = `${c.first_name}${last ? '_' + last : ''}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
}