/**
 * merge-projects — Fonction pure utilisée par AdminDashboard pour enrichir
 * les soumissions (issues de React Query / Supabase Realtime) avec les noms
 * et emails trouvés dans les rendez-vous Google Calendar (`appointments`).
 *
 * Aucune dépendance React : 100% testable en isolation.
 */

export interface MergeAppointmentRow {
  soumission_id: string | null;
  client_first_name: string;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  formatted_address: string | null;
  scheduled_at: string;
  notes: string | null;
}

export interface MergeSoumission {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  formatted_address: string | null;
  created_at: string;
  status: string;
  archived_at?: string | null;
  [k: string]: unknown;
}

const isPlaceholderEmail = (v?: string | null) => {
  const e = (v || '').trim().toLowerCase();
  return !e || e.includes('@soumission.local') || e === 'inconnu@converti.ca';
};

const isPlaceholderLast = (v?: string | null) => {
  const l = (v || '').trim().toLowerCase();
  return !l || l === 'non fourni' || l === 'inconnu';
};

const toTitle = (v: string) =>
  v.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const isArchived = (s: Pick<MergeSoumission, 'status' | 'archived_at'>) =>
  s.status === 'archived' || !!s.archived_at;

/**
 * Retire les soumissions archivées et enrichit les noms/emails placeholders
 * via les rendez-vous Google Calendar associés.
 */
export function mergeProjects<T extends MergeSoumission>(
  rqProjects: T[] | null | undefined,
  appointmentsRaw: MergeAppointmentRow[],
): T[] {
  const raw = (rqProjects || []).filter(s => !isArchived(s));

  const parsedAppts = appointmentsRaw.map(a => {
    const parenthesisMatch = a.client_first_name?.match(/\(([^)]+)\)/);
    let first = '', last = '';
    if (parenthesisMatch) {
      const parts = parenthesisMatch[1].trim().split(/\s+/);
      first = (parts[0] || '').toLowerCase();
      last = parts.slice(1).join(' ').toLowerCase();
    } else {
      first = (a.client_first_name || '').toLowerCase().trim();
      last = (a.client_last_name || '').toLowerCase().trim();
    }
    const notesPhones = ((a.notes || '').match(/\d[\d\s\-().]{6,}\d/g) || [])
      .map(m => m.replace(/\D/g, ''));
    return {
      first,
      last,
      email: (a.client_email || '').trim().toLowerCase(),
      normalizedPhone: (a.client_phone || '').replace(/\D/g, ''),
      notesPhones,
      normalizedAddress: (a.formatted_address || '').trim().toLowerCase(),
      scheduledAt: new Date(a.scheduled_at).getTime(),
      soumission_id: a.soumission_id,
    };
  });

  return raw.map(s => {
    const needsEnrichment = isPlaceholderLast(s.last_name) || isPlaceholderEmail(s.email);
    if (!needsEnrichment) return s;

    const sPhone = (s.phone || '').replace(/\D/g, '');
    const sFirst = (s.first_name || '').toLowerCase().trim();
    const sAddress = (s.formatted_address || '').trim().toLowerCase();
    const sTime = new Date(s.created_at).getTime();

    let match = parsedAppts.find(a => a.soumission_id === s.id);
    if (!match && sPhone && sPhone.length >= 7) {
      match = parsedAppts.find(a => a.normalizedPhone === sPhone || a.notesPhones.includes(sPhone));
    }
    if (!match && sAddress) {
      match = parsedAppts.find(a => a.normalizedAddress === sAddress
        && Math.abs(a.scheduledAt - sTime) / 86400000 <= 60);
    }
    if (!match && sFirst && sFirst !== 'anonyme') {
      const candidates = parsedAppts
        .filter(a => a.first === sFirst && Math.abs(a.scheduledAt - sTime) / 86400000 <= 30);
      candidates.sort((a, b) => Math.abs(a.scheduledAt - sTime) - Math.abs(b.scheduledAt - sTime));
      match = candidates[0];
    }
    if (!match) return s;

    return {
      ...s,
      last_name: isPlaceholderLast(s.last_name) && match.last ? toTitle(match.last) : s.last_name,
      email: isPlaceholderEmail(s.email) && match.email && !match.email.includes('@soumission.local')
        ? match.email
        : s.email,
    };
  });
}