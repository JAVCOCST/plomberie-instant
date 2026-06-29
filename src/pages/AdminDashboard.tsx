import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { generateMergedPdfBase64, generateQuotePdfBase64, type BuildingData } from '@/lib/pdf-generators';
import {
  buildPdfBucketSearchTerms,
  buildPdfDisplayBase,
  buildPdfStorageObjectPaths,
  buildPdfUrlCandidates,
  getSignedQuotePdfUrl,
  matchesPdfStorageFilename,
} from '@/lib/pdf-storage';
import {
  Search, ExternalLink, ChevronLeft, ChevronRight,
  X, Download, Trash2, Archive, ArchiveRestore, ArrowUpDown, ArrowUp, ArrowDown, Filter, Phone, Mail, Calendar,
  MapPin, AlertTriangle, ArrowRightCircle, CheckSquare,
  FileText, LayoutGrid, Table as TableIcon, Paperclip,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { PROJECT_STATUSES, PROJECT_PHASES, getStatusOption } from '@/lib/project-statuses';
import {
  useProjects,
  useUpdateProjectStatus,
  useUpdateProject,
  useArchiveProject,
  useBulkArchiveProjects,
  useUnarchiveProject,
  PROJECTS_QUERY_KEY,
} from '@/hooks/useProjects';
import { mergeProjects } from '@/lib/merge-projects';
import { useQueryClient } from '@tanstack/react-query';
import { SwipeableCard } from '@/components/admin/SwipeableCard';
import { toast } from 'sonner';
import { LeadDetailBody } from '@/components/lead-detail/LeadDetailBody';

const ABANDONED_NOTES_KEY = 'abandoned_notes_json';
type StoredLeadNote = { id: string; content: string; created_at: string; source?: 'session' | 'table' };

const newLocalNoteId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const parseAbandonedNotes = (stepTimings?: Record<string, any> | null): StoredLeadNote[] => {
  const raw = stepTimings?.[ABANDONED_NOTES_KEY];
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(n => n && typeof n.content === 'string')
      .map(n => ({ id: n.id || newLocalNoteId(), content: n.content, created_at: n.created_at || new Date().toISOString(), source: 'session' as const }));
  } catch {
    return [];
  }
};

const serializeAbandonedNotes = (stepTimings: Record<string, any> | null | undefined, notes: StoredLeadNote[]) => ({
  ...(stepTimings || {}),
  [ABANDONED_NOTES_KEY]: JSON.stringify(notes.map(({ id, content, created_at }) => ({ id, content, created_at }))),
});

/* ── Notes panel for abandoned sessions.
   Les notes sont stockées dans form_sessions.step_timings tant que le lead
   n'est pas converti, puis migrées vers soumission_notes à la conversion. ── */
const AbandonedNotesPanel: React.FC<{
  session: { id: string; step_timings?: Record<string, any> | null };
  onSessionSaved: (sessionId: string, stepTimings: Record<string, any>) => void;
}> = ({ session, onSessionSaved }) => {
  const leadId = session.id;
  const sessionNotes = useMemo(() => parseAbandonedNotes(session.step_timings), [session.step_timings]);
  const [tableNotes, setTableNotes] = useState<StoredLeadNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('soumission_notes')
      .select('*').eq('soumission_id', leadId).order('created_at', { ascending: true });
    setTableNotes(((data as any) || []).map((n: StoredLeadNote) => ({ ...n, source: 'table' })));
  }, [leadId]);

  const notes = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionNotes, ...tableNotes]
      .filter(n => {
        const key = `${n.created_at}|${n.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [sessionNotes, tableNotes]);

  const persistSessionNotes = useCallback(async (nextNotes: StoredLeadNote[]) => {
    const nextTimings = serializeAbandonedNotes(session.step_timings, nextNotes);
    const { error } = await supabase.from('form_sessions').update({ step_timings: nextTimings } as any).eq('id', leadId);
    if (error) {
      console.error('save abandoned note failed', error);
      toast.error(`Échec de l'ajout: ${error.message}`);
      return false;
    }
    onSessionSaved(leadId, nextTimings);
    return true;
  }, [leadId, onSessionSaved, session.step_timings]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const ch = supabase.channel(`ab-notes-${leadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'soumission_notes', filter: `soumission_id=eq.${leadId}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [leadId, reload]);

  const addNote = async () => {
    if (!newNote.trim()) return;
    const content = newNote.trim();
    const saved = await persistSessionNotes([...sessionNotes, { id: newLocalNoteId(), content, created_at: new Date().toISOString(), source: 'session' }]);
    if (saved) setNewNote('');
  };

  const deleteNote = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note?.source === 'table') await supabase.from('soumission_notes').delete().eq('id', id);
    else await persistSessionNotes(sessionNotes.filter(n => n.id !== id));
  };

  const uploadImages = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of list) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const safeName = `notes/${leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, file, { contentType: file.type, upsert: true });
        if (!error) {
          const signed = await getSignedQuotePdfUrl(safeName);
          if (signed) urls.push(signed);
        }
      }
      if (urls.length > 0) {
        const content = `${urls.length === 1 ? 'Image jointe' : `${urls.length} images jointes`}\n${urls.join('\n')}`;
        await persistSessionNotes([...sessionNotes, { id: newLocalNoteId(), content, created_at: new Date().toISOString(), source: 'session' }]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>Aucune note. Ajoutez-en une ci-dessous.</div>
        )}
        {notes.map(n => {
          const urls = (n.content.match(/https?:\/\/\S+/g) || []);
          const text = n.content.replace(/https?:\/\/\S+/g, '').trim();
          return (
            <div key={n.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 10, position: 'relative' }}>
              <button onClick={() => deleteNote(n.id)} title="Supprimer"
                style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                <X size={13} />
              </button>
              {text && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#d1d5db', marginBottom: urls.length ? 6 : 0 }}>{text}</div>}
              {urls.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
                  {urls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ display: 'block', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <img src={u} alt={`Image ${i + 1}`} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>{new Date(n.created_at).toLocaleString('fr-CA')}</div>
            </div>
          );
        })}
      </div>
      <textarea value={newNote} onChange={e => setNewNote(e.target.value)} rows={3} placeholder="Ajouter une note…"
        style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 16, padding: '8px 10px', resize: 'vertical', marginBottom: 6, touchAction: 'manipulation' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={addNote} disabled={!newNote.trim()}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', cursor: newNote.trim() ? 'pointer' : 'not-allowed', opacity: newNote.trim() ? 1 : 0.5 }}>
          Ajouter la note
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', cursor: uploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {uploading ? 'Envoi…' : (<><Paperclip size={13} /> Image</>)}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => e.target.files && uploadImages(e.target.files)} />
      </div>
    </div>
  );
};

/* ── vCard helper ── */
const isPlaceholderEmailDash = (v?: string | null) => {
  const e = (v || '').trim().toLowerCase();
  return !e || e.includes('@soumission.local') || e === 'inconnu@converti.ca';
};
const isPlaceholderLastDash = (v?: string | null) => {
  const l = (v || '').trim().toLowerCase();
  return !l || l === 'non fourni' || l === 'inconnu';
};

const downloadVCard = (s: { first_name: string; last_name: string; phone: string; email: string; formatted_address?: string | null }) => {
  const company = s.formatted_address ? `Proprio – ${s.formatted_address}` : '';
  const displayLast = isPlaceholderLastDash(s.last_name) ? '' : s.last_name;
  const displayEmail = isPlaceholderEmailDash(s.email) ? '' : s.email;
  const displayPhone = s.phone && s.phone !== '000-000-0000' ? s.phone : '';
  const fullName = `${s.first_name} ${displayLast}`.trim();
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${displayLast};${s.first_name};;;`,
    `FN:${fullName}`,
    displayPhone ? `TEL;TYPE=CELL:${displayPhone}` : '',
    displayEmail ? `EMAIL:${displayEmail}` : '',
    company ? `ORG:${company}` : '',
    s.formatted_address ? `ADR;TYPE=HOME:;;${s.formatted_address};;;;` : '',
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.first_name}${displayLast ? '_' + displayLast : ''}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
};

const PhoneVcfButton: React.FC<{ s: { first_name: string; last_name: string; phone: string; email: string; formatted_address?: string | null } }> = ({ s }) => (
  <button
    onClick={e => { e.stopPropagation(); downloadVCard(s); }}
    title={`Ajouter ${s.first_name} — ${s.phone}`}
    aria-label={`Ajouter ${s.first_name} dans les contacts`}
    style={{
      background: 'none',
      border: 'none',
      padding: 4,
      margin: 0,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 0,
      position: 'relative',
    }}
    className="phone-vcf-glow"
  >
    <Phone
      size={18}
      strokeWidth={2.45}
      absoluteStrokeWidth
      shapeRendering="geometricPrecision"
      style={{ color: 'hsl(234 89% 74%)', display: 'block' }}
    />
  </button>
);

/* ── Types ── */
interface DynastyLine { description: string; quantity: number; unit: string; rate: number; total_displayed: number; }
interface DynastyBreakdown {
  surface_sqft: number; subtotal_base: number; contingency: number; subtotal_displayed: number;
  tps: number; tvq: number; total_final: number; slope_category: string; slope_factor: number;
  roof_type: string; perimeter_ft: number; area_sqft: number; surface_corrected: number;
  confidence: number; low_confidence: boolean; lines: DynastyLine[];
}

interface Soumission {
  id: string; seq_number: number; reference_id: string | null;
  first_name: string; last_name: string; email: string; phone: string;
  formatted_address: string | null; product_name: string | null; product_brand: string | null;
  color: string | null; coverage_type: string | null; slope: string | null;
  complexity: string | null; area_sqft: number | null; area_input: number | null;
  area_unit: string | null; subtotal: number | null; low_estimate: number | null;
  high_estimate: number | null; mobilisation: number | null; price_per_sqft: number | null;
  desired_install_date: string | null; created_at: string; contact_preference: string;
  slope_factor: number | null; complexity_factor: number | null; status: string;
  lat: number | null; lng: number | null; page_url: string | null; user_agent: string | null;
  dynasty_breakdown: DynastyBreakdown | null; form_session_id: string | null;
  roof_category: string | null; building_type: string | null; work_type: string | null;
  archived_at?: string | null;
  email_status?: string | null; email_sent_at?: string | null; email_response_at?: string | null;
}

interface FormSession {
  id: string; session_id: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; formatted_address: string | null;
  lat: number | null; lng: number | null; coverage_type: string | null; slope: string | null;
  product_name: string | null; product_brand: string | null; color: string | null;
  desired_install_date: string | null; last_step: number; total_steps: number;
  step_labels: string[]; step_timings: Record<string, string>; is_complete: boolean;
  soumission_id: string | null; created_at: string; updated_at: string;
  user_agent: string | null; page_url: string | null; archived_at?: string | null;
}

const isMissingColumnError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || (text.includes('archived_at') && (text.includes('does not exist') || text.includes('schema cache')));
};

const isArchivedSoumission = (s: Pick<Soumission, 'status' | 'archived_at'>) =>
  s.status === 'archived' || !!s.archived_at;

const isArchivedSession = (s: FormSession) =>
  !!s.archived_at || !!(s.step_timings as Record<string, string | undefined> | null | undefined)?.archived_at;

type SortKey = 'seq_number' | 'first_name' | 'formatted_address' | 'product_brand' | 'high_estimate' | 'created_at' | 'status' | 'coverage_type' | 'roof_category' | 'building_type' | 'work_type';
type SortDir = 'asc' | 'desc';
type RowSource = 'web' | 'manual' | 'abandoned' | 'archived';
type SourcedSoumission = Soumission & { _source: RowSource; _session?: FormSession; _abandonedStep?: string; _abandonedProgress?: number; };
type PdfKind = 'client' | 'internal';

/* ── Constants ── */
// Liste unique des statuts — partagée avec le Gantt et le Calendrier.
// Toute modification doit se faire dans src/lib/project-statuses.ts.
const STATUS_OPTIONS = PROJECT_STATUSES.map(s => ({
  value: s.value, label: s.label, bg: s.bg, color: s.accent, border: s.border,
}));

const ROOF_CATEGORY_OPTIONS = [
  { value: 'residential', label: 'Résidentiel' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industriel' },
  { value: 'institutional', label: 'Institutionnel' },
];

const BUILDING_TYPE_OPTIONS = [
  { value: 'unifamiliale', label: 'Unifamiliale' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'triplex', label: 'Triplex' },
  { value: 'multiplex', label: 'Multiplex' },
  { value: 'condo', label: 'Condo' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Autre' },
];

const WORK_TYPE_OPTIONS = [
  { value: 'remplacement', label: 'Remplacement' },
  { value: 'reparations', label: 'Réparations' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'nouvelle_construction', label: 'Construction' },
  { value: 'autre', label: 'Autre' },
];

const COVERAGE_FR: Record<string, string> = {
  shingle_2pans: 'Bardeaux – 2 versants', shingle_4pans: 'Bardeaux – 4 versants',
  shingle_4pans_plus: 'Bardeaux – 4+ versants', membrane_elastomere: 'Membrane élastomère',
  membrane_gravier: 'Membrane gravier', tole_2pans: 'Tôle – 2 versants',
  tole_4pans: 'Tôle – 4 versants', tole_4pans_plus: 'Tôle – 4+ versants',
  shingle: 'Bardeaux', sbs: 'Membrane / SBS',
};

const SLOPE_FR: Record<string, string> = { '4-7': 'FAIBLE 4/12-5/12', '7-9': 'MOY 6/12-7/12', '9-12': 'ELEVEE 8/12-9/12', '12+': 'TRES ELEVEE 10/12-12/12' };
const COMPLEXITY_FR: Record<string, string> = { simple: 'Simple', moderate: 'Modérée', moyenne: 'Modérée', complex: 'Complexe', complexe: 'Complexe', tres_complexe: 'Très complexe' };
const STEP_LABELS_FULL = ['Prénom', 'Téléphone', 'Adresse', 'Bâtiment', 'Travaux', 'Analyse IA', 'Date', 'Client'];
const STEP_LABELS = ['Adresse', 'Bâtiment', 'Travaux', 'Analyse IA', 'Date', 'Client'];

const fmt = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const fmt2 = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });

const constructPdfUrlCandidates = (s: Soumission) => {
  const projectUrl = import.meta.env.VITE_SUPABASE_URL;
  return buildPdfUrlCandidates(projectUrl, s.seq_number, s.formatted_address);
}; // returns Promise<{ client: string[]; internal: string[] }>

const buildSatelliteUrl = (lat: number, lng: number, zoom: number, size: string) => {
  const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite&key=${key}`;
};

const PAGE_SIZE = 25;
const getStatusConfig = (status: string) => STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];

const EMAIL_STATUS_BADGE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  sent:      { label: '✉ Envoyé',   bg: 'rgba(99,102,241,0.15)', color: '#818cf8', border: 'rgba(99,102,241,0.35)' },
  accepted:  { label: '✓ Accepté',  bg: 'rgba(34,197,94,0.18)',  color: '#4ade80', border: 'rgba(34,197,94,0.4)'  },
  declined:  { label: '✗ Refusé',   bg: 'rgba(239,68,68,0.18)',  color: '#f87171', border: 'rgba(239,68,68,0.4)'  },
};
const EmailStatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  if (!status) return null;
  const cfg = EMAIL_STATUS_BADGE[status]; if (!cfg) return null;
  return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, marginLeft: 6, whiteSpace: 'nowrap' }}>{cfg.label}</span>;
};

/* ── Step timing helper (includes intro_name & intro_phone) ── */
const computeStepDurationsFull = (timings: Record<string, string>) => {
  const durations: Record<number, number> = {};
  // Index 0 = intro_name, 1 = intro_phone
  const introKeys = ['intro_name', 'intro_phone'];
  introKeys.forEach((key, idx) => {
    const enter = timings[`${key}_enter`];
    const leave = timings[`${key}_leave`];
    if (enter && leave) {
      durations[idx] = (new Date(leave).getTime() - new Date(enter).getTime()) / 1000;
    }
  });
  // Index 2..7 = form steps 0..5 (new 6-step wizard)
  for (let i = 0; i < 6; i++) {
    const enter = timings[`step_${i}_enter`];
    const leave = timings[`step_${i}_leave`];
    if (enter && leave) {
      durations[i + 2] = (new Date(leave).getTime() - new Date(enter).getTime()) / 1000;
    }
  }
  return durations;
};

// Legacy helper for old data without intro steps
const computeStepDurations = (timings: Record<string, string>) => {
  const durations: Record<number, number> = {};
  for (let i = 0; i < 8; i++) {
    const enter = timings[`step_${i}_enter`];
    const leave = timings[`step_${i}_leave`];
    if (enter && leave) {
      durations[i] = (new Date(leave).getTime() - new Date(enter).getTime()) / 1000;
    }
  }
  return durations;
};

/* Maps a session's last_step (0-7 form index) to the full index (0-9 including intro) */
const getFullStepIndex = (session: FormSession) => {
  const timings = session.step_timings || {};
  const hasIntro = !!timings['intro_name_enter'] || !!timings['intro_phone_enter'];
  if (!hasIntro) return session.last_step; // old session without intro
  // If last_step is 0 and no step_0_enter, they're still in intro
  if (session.last_step === 0 && !timings['step_0_enter']) {
    return timings['intro_phone_enter'] ? 1 : 0; // phone or name
  }
  return session.last_step + 2; // offset by 2 intro steps
};

const getFullTotalSteps = (session: FormSession) => {
  const timings = session.step_timings || {};
  const hasIntro = !!timings['intro_name_enter'] || !!timings['intro_phone_enter'];
  return hasIntro ? 8 : Math.min(session.total_steps, 6);
};

const getFullStepLabel = (session: FormSession) => {
  const timings = session.step_timings || {};
  const hasIntro = !!timings['intro_name_enter'] || !!timings['intro_phone_enter'];
  const labels = hasIntro ? STEP_LABELS_FULL : STEP_LABELS;
  const idx = getFullStepIndex(session);
  return labels[idx] || `Étape ${idx}`;
};

const formatDuration = (secs: number) => {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
};

/* ── Main Component ── */
const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // ── Soumissions are derived from React Query (single source of truth).
  // We only keep raw appointments here (used to enrich placeholder names/emails).
  type AppointmentRow = {
    soumission_id: string | null;
    client_first_name: string;
    client_last_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    formatted_address: string | null;
    scheduled_at: string;
    notes: string | null;
  };
  const [appointmentsRaw, setAppointmentsRaw] = useState<AppointmentRow[]>([]);
  const [formSessions, setFormSessions] = useState<FormSession[]>([]);
  const [auxLoading, setAuxLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Soumission | null>(null);
  const [selectedAbandoned, setSelectedAbandoned] = useState<FormSession | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // (delete flow removed — replaced by archive)
  const [filterSource, setFilterSource] = useState<RowSource | 'all'>('all');
  const [activePdfKind, setActivePdfKind] = useState<PdfKind>('client');
  const [resolvedPdfUrls, setResolvedPdfUrls] = useState<{ client: string | null; internal: string | null } | null>(null);
  const [resolvingPdf, setResolvingPdf] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [loadingPreviewPdf, setLoadingPreviewPdf] = useState(false);
  const previewPdfObjectUrlRef = useRef<string | null>(null);

  // Column filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [filterCoverage, setFilterCoverage] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [selectedAbIds, setSelectedAbIds] = useState<Set<string>>(new Set());
  const [selectedSoumIds, setSelectedSoumIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const [converting, setConverting] = useState(false);

  // View mode (table | kanban) — kanban inspired by Pipedrive
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    if (typeof window === 'undefined') return 'table';
    return (localStorage.getItem('adminDashboardViewMode') as 'table' | 'kanban') || 'table';
  });
  useEffect(() => {
    try { localStorage.setItem('adminDashboardViewMode', viewMode); } catch {}
  }, [viewMode]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const didDragRef = useRef(false);

  // Les notes / pièces jointes sont gérées entièrement par <LeadDetailBody>
  // (lecture + Realtime + upload). Pas de logique parallèle ici.

  // ── Source of truth: React Query + Supabase Realtime ──
  // Mounts the global realtime subscription on `soumissions` (ref-counted)
  // and shares the same cache with the Gantt / Calendar / Project page.
  const { data: rqProjects, isLoading: projectsLoading } = useProjects();
  const updateProjectStatusMut = useUpdateProjectStatus();
  const updateProjectMut = useUpdateProject();
  const archiveProjectMut = useArchiveProject();
  const bulkArchiveProjectsMut = useBulkArchiveProjects();
  const unarchiveProjectMut = useUnarchiveProject();
  const queryClient = useQueryClient();

  // Aux loader: form_sessions + appointments only. Soumissions live in RQ.
  const loadAux = useCallback(async () => {
    setAuxLoading(true);
    const [sessResult, apptResult] = await Promise.all([
      (supabase.from('form_sessions').select('*') as any).order('updated_at', { ascending: false }).limit(500),
      supabase.from('appointments').select('soumission_id, client_first_name, client_last_name, client_email, client_phone, formatted_address, scheduled_at, notes'),
    ]);
    let sessData = sessResult.data;
    if (sessData) sessData = ((sessData || []) as unknown as FormSession[]).filter(s => !isArchivedSession(s)) as any;
    if (sessData) setFormSessions(sessData as unknown as FormSession[]);
    setAppointmentsRaw((apptResult.data || []) as AppointmentRow[]);
    setAuxLoading(false);
  }, []);

  useEffect(() => { loadAux(); }, [loadAux]);

  const loading = auxLoading || projectsLoading;

  // ── Derived soumissions: RQ rows filtered + enriched with appointments ──
  // Logique extraite dans `mergeProjects()` (fonction pure, testable).
  const soumissions = useMemo<Soumission[]>(
    () => mergeProjects(
      rqProjects as unknown as Parameters<typeof mergeProjects>[0],
      appointmentsRaw,
    ) as unknown as Soumission[],
    [rqProjects, appointmentsRaw],
  );

  // Optimistic project-cache patches are now centralized inside the mutation hooks
  // (`src/hooks/mutations/projectMutations.ts`). No local helpers needed here.

  // Disable global pull-to-refresh while a detail panel is open
  useEffect(() => {
    const open = !!(selected || selectedAbandoned);
    if (open) document.body.dataset.disablePullRefresh = 'true';
    else delete document.body.dataset.disablePullRefresh;
    return () => { delete document.body.dataset.disablePullRefresh; };
  }, [selected, selectedAbandoned]);

  const linkedSessionKeys = useMemo(() => {
    const keys = new Set<string>();
    soumissions.forEach(s => {
      if (s.form_session_id) keys.add(s.form_session_id);
    });
    return keys;
  }, [soumissions]);

  // Abandoned sessions (not complete, at least step 1, and not already linked to a soumission)
  const abandonedSessions = useMemo(() =>
    formSessions.filter(s =>
      !s.is_complete &&
      !s.soumission_id &&
      !linkedSessionKeys.has(s.id) &&
      !linkedSessionKeys.has(s.session_id) &&
      (s.last_step >= 1 || s.first_name || s.phone)
    )
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [formSessions, linkedSessionKeys]);

  // Unique values for filters
  const uniqueBrands = useMemo(() => Array.from(new Set(soumissions.map(s => s.product_brand).filter(Boolean) as string[])).sort(), [soumissions]);
  const uniqueCoverages = useMemo(() => Array.from(new Set(soumissions.map(s => s.coverage_type).filter(Boolean) as string[])).sort(), [soumissions]);

  // Split soumissions by source
  // Unified rows: soumissions + abandoned sessions
  const sourcedSoumissions = useMemo<SourcedSoumission[]>(() =>
    soumissions.map(s => ({ ...s, _source: (s.page_url ? 'web' : 'manual') as RowSource })),
  [soumissions]);

  // Archived soumissions: pulled directly from RQ cache (mergeProjects filters them out).
  const archivedSoumissions = useMemo<SourcedSoumission[]>(() => {
    const raw = (rqProjects || []) as unknown as Soumission[];
    return raw
      .filter(s => s.status === 'archived' || !!(s as any).archived_at)
      .map(s => ({ ...s, _source: 'archived' as RowSource }));
  }, [rqProjects]);

  const abandonedRows = useMemo<SourcedSoumission[]>(() =>
    abandonedSessions.map(s => {
      const stepLabel = getFullStepLabel(s);
      const fullIdx = getFullStepIndex(s);
      const fullTotal = getFullTotalSteps(s);
      const progress = Math.round((fullIdx / fullTotal) * 100);
      return {
        id: s.id, seq_number: 0, reference_id: null,
        first_name: s.first_name || 'Anonyme', last_name: s.last_name || '',
        email: s.email || '', phone: s.phone || '',
        formatted_address: s.formatted_address || null,
        product_name: s.product_name || null, product_brand: s.product_brand || null,
        color: s.color || null, coverage_type: s.coverage_type || null,
        slope: s.slope || null, complexity: null,
        area_sqft: null, area_input: null, area_unit: null,
        subtotal: null, low_estimate: null, high_estimate: null,
        mobilisation: null, price_per_sqft: null,
        desired_install_date: s.desired_install_date || null,
        created_at: s.updated_at, contact_preference: 'email',
        slope_factor: null, complexity_factor: null,
        status: 'abandoned', lat: s.lat || null, lng: s.lng || null,
        page_url: s.page_url || null, user_agent: s.user_agent || null,
        dynasty_breakdown: null, form_session_id: s.id,
        roof_category: null, building_type: null, work_type: (s.step_timings as any)?.work_type || null,
        _source: 'abandoned' as RowSource, _session: s,
        _abandonedStep: stepLabel, _abandonedProgress: progress,
      };
    }),
  [abandonedSessions]);

  const allRows = useMemo(
    () => filterSource === 'archived'
      ? archivedSoumissions
      : [...sourcedSoumissions, ...abandonedRows],
    [sourcedSoumissions, abandonedRows, archivedSoumissions, filterSource],
  );

  const statFilterMap: Record<string, string[]> = Object.fromEntries([
    ['Total', []],
    ...STATUS_OPTIONS.map(s => [s.label, [s.value]]),
    ['Abandonnés', ['abandoned']],
  ]);

  const [mobileStatFilter, setMobileStatFilter] = useState<string | null>(null);

  // Filtering
  const filtered = useMemo(() => {
    let list = [...allRows];
    if (filterSource === 'web') list = list.filter(s => s._source === 'web');
    else if (filterSource === 'manual') list = list.filter(s => s._source === 'manual');
    else if (filterSource === 'abandoned') list = list.filter(s => s._source === 'abandoned');
    else if (filterSource === 'archived') list = list.filter(s => s._source === 'archived');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
        (s.formatted_address || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.reference_id || '').toLowerCase().includes(q) ||
        String(s.seq_number).includes(q)
      );
    }
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterBrand !== 'all') list = list.filter(s => s.product_brand === filterBrand);
    if (filterCoverage !== 'all') list = list.filter(s => s.coverage_type === filterCoverage);
    if (filterDateFrom) list = list.filter(s => s.created_at >= filterDateFrom);
    if (filterDateTo) list = list.filter(s => s.created_at <= filterDateTo + 'T23:59:59');
    if (isMobile && mobileStatFilter && statFilterMap[mobileStatFilter]?.length > 0) {
      const allowedStatuses = statFilterMap[mobileStatFilter];
      list = list.filter(s => allowedStatuses.includes(s.status));
    }
    return list;
  }, [allRows, filterSource, search, filterStatus, filterBrand, filterCoverage, filterDateFrom, filterDateTo, isMobile, mobileStatFilter]);

  // Sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let aVal: any = (a as any)[sortKey]; let bVal: any = (b as any)[sortKey];
      if (sortKey === 'first_name') { aVal = `${a.first_name} ${a.last_name}`; bVal = `${b.first_name} ${b.last_name}`; }
      if (aVal == null) return 1; if (bVal == null) return -1;
      if (typeof aVal === 'string') { const cmp = aVal.localeCompare(bVal, 'fr'); return sortDir === 'asc' ? cmp : -cmp; }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  };

  

  const updateField = async (id: string, field: string, value: string) => {
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, [field]: value } as Soumission : null);
    // Shared mutation handles RQ cache (optimistic) + Supabase write.
    try {
      await updateProjectMut.mutateAsync({ id, patch: { [field]: value } as any });
    } catch {
      // Realtime + onSettled will reconcile.
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status: newStatus } : null);
    try {
      await updateProjectStatusMut.mutateAsync({ id, status: newStatus as any });
    } catch {
      // Optimistic rollback handled in the hook.
    }
  };

  const archiveSoumission = async (id: string) => {
    if (selected?.id === id) setSelected(null);
    try {
      await archiveProjectMut.mutateAsync(id);
    } catch {
      toast.error('Archivage impossible');
    }
  };

  const archiveSession = async (id: string) => {
    const ts = new Date().toISOString();
    const session = formSessions.find(s => s.id === id);
    const { error } = await (supabase.from('form_sessions') as any).update({ archived_at: ts }).eq('id', id);
    if (isMissingColumnError(error) && session) {
      await supabase.from('form_sessions').update({ step_timings: { ...(session.step_timings || {}), archived_at: ts } } as any).eq('id', id);
    }
    setFormSessions(prev => prev.filter(s => s.id !== id));
    if (selectedAbandoned?.id === id) setSelectedAbandoned(null);
  };

  const bulkArchive = useCallback(async () => {
    if (archiving) return;
    const soumIds = Array.from(selectedSoumIds);
    const sessIds = Array.from(selectedAbIds);
    if (soumIds.length === 0 && sessIds.length === 0) return;
    setArchiving(true);
    try {
      const ts = new Date().toISOString();
      const ops: Promise<unknown>[] = [];
      if (soumIds.length) ops.push(bulkArchiveProjectsMut.mutateAsync(soumIds));
      if (sessIds.length) ops.push((supabase.from('form_sessions') as any).update({ archived_at: ts }).in('id', sessIds));
      const results = await Promise.allSettled(ops);
      // Soumissions branch: handled centrally by useBulkArchiveProjects (cache + fallback inside).
      // form_sessions branch: keep legacy fallback (not part of projects mutation layer).
      const sessRes = sessIds.length ? results[soumIds.length ? 1 : 0] : null;
      const sessErr = sessRes && sessRes.status === 'fulfilled'
        ? (sessRes.value as { error?: unknown })?.error
        : (sessRes as PromiseRejectedResult | null)?.reason;
      const sessMissingArchive = sessIds.length ? isMissingColumnError(sessErr) : false;
      if (sessMissingArchive) {
        await Promise.all(sessIds.map(id => {
          const session = formSessions.find(s => s.id === id);
          return supabase.from('form_sessions').update({ step_timings: { ...(session?.step_timings || {}), archived_at: ts } } as any).eq('id', id);
        }));
      }
      if (sessIds.length) setFormSessions(prev => prev.filter(s => !selectedAbIds.has(s.id)));
      if (selected && selectedSoumIds.has(selected.id)) setSelected(null);
      if (selectedAbandoned && selectedAbIds.has(selectedAbandoned.id)) setSelectedAbandoned(null);
      setSelectedSoumIds(new Set());
      setSelectedAbIds(new Set());
    } finally {
      setArchiving(false);
    }
  }, [archiving, selectedSoumIds, selectedAbIds, selected, selectedAbandoned, formSessions, bulkArchiveProjectsMut]);

  /* ── Single-item archive (used by mobile swipe) ── */
  const archiveSingleSoum = useCallback(async (id: string) => {
    const original = soumissions.find(s => s.id === id);
    if (!original) return;
    if (selected?.id === id) setSelected(null);
    try {
      await archiveProjectMut.mutateAsync(id);
    } catch {
      toast.error('Archivage impossible');
      return;
    }
    toast.success('Soumission archivée', {
      action: {
        label: 'Annuler',
        onClick: async () => {
          try {
            await unarchiveProjectMut.mutateAsync({ id, originalStatus: original.status });
          } catch {
            toast.error('Annulation impossible');
          }
        },
      },
      duration: 5000,
    });
  }, [soumissions, selected, archiveProjectMut, unarchiveProjectMut]);

  /* ── Unarchive a soumission (restore from "Archivés" tab) ── */
  const unarchiveSoum = useCallback(async (id: string) => {
    try {
      await unarchiveProjectMut.mutateAsync({ id, originalStatus: 'to_contact' });
      toast.success('Soumission restaurée');
      if (selected?.id === id) setSelected(null);
    } catch {
      toast.error('Restauration impossible');
    }
  }, [unarchiveProjectMut, selected]);

  const archiveSingleSession = useCallback(async (id: string) => {
    const original = formSessions.find(s => s.id === id);
    if (!original) return;
    setFormSessions(prev => prev.filter(s => s.id !== id));
    if (selectedAbandoned?.id === id) setSelectedAbandoned(null);
    const ts = new Date().toISOString();
    const { error } = await (supabase.from('form_sessions') as any).update({ archived_at: ts }).eq('id', id);
    if (error) {
      const fallback = isMissingColumnError(error) ? await supabase.from('form_sessions').update({
        step_timings: { ...(original.step_timings || {}), archived_at: ts },
      } as any).eq('id', id) : { error };
      if (fallback.error) {
        setFormSessions(prev => [original, ...prev]);
        toast.error('Archivage impossible');
        return;
      }
    }
    toast.success('Lead abandonné archivé', {
      action: {
        label: 'Annuler',
        onClick: async () => {
          const undo = await (supabase.from('form_sessions') as any).update({ archived_at: null }).eq('id', id);
          if (isMissingColumnError(undo.error)) {
            const timings = { ...(original.step_timings || {}) };
            delete (timings as Record<string, unknown>).archived_at;
            await supabase.from('form_sessions').update({ step_timings: timings } as any).eq('id', id);
          }
          setFormSessions(prev => [original, ...prev]);
        },
      },
      duration: 5000,
    });
  }, [formSessions, selectedAbandoned]);

  /* ── Convert single abandoned via swipe (direct, no selection) ── */
  const convertSingleAbandoned = useCallback(async (id: string) => {
    convertAbandonedToSoumissionsRef.current?.(new Set([id]));
  }, []);
  const convertAbandonedToSoumissionsRef = useRef<((override?: Set<string>) => void) | null>(null);

  const toggleSoumSelection = useCallback((id: string) => {
    setSelectedSoumIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const updateSessionTimingsField = async (sessionId: string, field: string, value: string) => {
    const session = formSessions.find(s => s.id === sessionId);
    if (!session) return;
    const newTimings = { ...(session.step_timings || {}), [field]: value };
    await supabase.from('form_sessions').update({ step_timings: newTimings } as any).eq('id', sessionId);
    setFormSessions(prev => prev.map(s => s.id === sessionId ? { ...s, step_timings: newTimings } as FormSession : s));
    if (selectedAbandoned?.id === sessionId) setSelectedAbandoned(prev => prev ? { ...prev, step_timings: newTimings } as FormSession : null);
  };

  const convertAbandonedToSoumissions = useCallback(async (idsOverride?: Set<string>) => {
    const ids = idsOverride ?? selectedAbIds;
    if (ids.size === 0 || converting) return;

    setConverting(true);

    try {
      const toConvert = abandonedSessions.filter(s => ids.has(s.id));
      const convertedIds = new Set<string>();
      const linkedSoumissionIds = new Map<string, string>();
      const createdSoumissions: Soumission[] = [];
      const existingSoumissionsBySessionKey = new Map<string, Soumission>();

      soumissions.forEach(s => {
        if (s.form_session_id) existingSoumissionsBySessionKey.set(s.form_session_id, s);
      });

      // ── Load appointments for enrichment matching ──
      const { data: allAppointments } = await supabase.from('appointments').select('client_first_name, client_last_name, client_email, client_phone, scheduled_at, notes');
      const apptList = (allAppointments || []) as { client_first_name: string; client_last_name: string | null; client_email: string | null; client_phone: string | null; scheduled_at: string; notes: string | null }[];

      // Parse appointment names: "30 min with Toitures (Annie Guay)" → { first: "annie", last: "guay", email, scheduled_at }
      const parsedAppts = apptList.map(a => {
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
        // Extract phones from notes for matching
        const notesPhones = ((a.notes || '').match(/\d[\d\s\-().]{6,}\d/g) || []).map(m => m.replace(/\D/g, ''));
        const normalizedPhone = (a.client_phone || '').replace(/\D/g, '');
        return { first, last, email: a.client_email, scheduledAt: new Date(a.scheduled_at).getTime(), notesPhones, normalizedPhone };
      }).filter(a => a.email && a.first);

      // Match function: finds best appointment for a session by first name + date proximity or phone
      const findCalendarMatch = (session: FormSession) => {
        const sessionFirst = (session.first_name || '').toLowerCase().trim();
        if (!sessionFirst || sessionFirst === 'anonyme') return null;
        const sessionTime = new Date(session.created_at).getTime();
        const sessionPhone = (session.phone || '').replace(/\D/g, '');

        // Try phone match first (in appointment phone or notes)
        if (sessionPhone && sessionPhone.length >= 7) {
          const phoneMatch = parsedAppts.find(a =>
            (a.normalizedPhone === sessionPhone) ||
            a.notesPhones.includes(sessionPhone)
          );
          if (phoneMatch) return phoneMatch;
        }

        // Find appointments matching first name, within 30 days
        const candidates = parsedAppts.filter(a => {
          if (a.first !== sessionFirst) return false;
          const daysDiff = Math.abs(a.scheduledAt - sessionTime) / (1000 * 60 * 60 * 24);
          return daysDiff <= 30;
        });

        if (candidates.length === 0) return null;
        // Pick the closest in time
        candidates.sort((a, b) => Math.abs(a.scheduledAt - sessionTime) - Math.abs(b.scheduledAt - sessionTime));
        return candidates[0];
      };

      for (const s of toConvert) {
        let installDate: string | null = null;
        if (s.desired_install_date) {
          const d = new Date(s.desired_install_date);
          if (!isNaN(d.getTime())) installDate = d.toISOString().split('T')[0];
        }

        // ── Enrich from Google Calendar match ──
        const calMatch = findCalendarMatch(s);

        const rawFirstName = (s.first_name ?? '').trim();
        const rawLastName = (s.last_name ?? '').trim();

        // Use calendar data if available and session is missing it
        const enrichedFirstName = rawFirstName || (calMatch ? calMatch.first.charAt(0).toUpperCase() + calMatch.first.slice(1) : '') || 'Anonyme';
        const enrichedLastName = rawLastName || (calMatch?.last ? calMatch.last.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '');
        const firstName = enrichedFirstName;
        const lastName = enrichedLastName || 'Non fourni';
        const normalizedEmail = (s.email ?? '').trim().toLowerCase() || (calMatch?.email ?? '') || `converti+${s.id}@soumission.local`;
        const normalizedPhone = (s.phone ?? '').trim() || '000-000-0000';

        let soumission = existingSoumissionsBySessionKey.get(s.id) || existingSoumissionsBySessionKey.get(s.session_id) || null;

        if (!soumission) {
          const payload: any = {
            first_name: firstName,
            last_name: lastName,
            email: normalizedEmail,
            phone: normalizedPhone,
            formatted_address: s.formatted_address || null,
            lat: s.lat,
            lng: s.lng,
            coverage_type: s.coverage_type || null,
            slope: s.slope || null,
            product_name: s.product_name || null,
            product_brand: s.product_brand || null,
            color: s.color || null,
            desired_install_date: installDate,
            page_url: s.page_url || null,
            user_agent: s.user_agent || null,
            form_session_id: s.id,
            status: 'new',
            contact_preference: 'email',
          };

          const { data, error } = await supabase.from('soumissions').insert(payload).select().single();
          if (error || !data) {
            console.error('Conversion error for session', s.id, error);
            continue;
          }

          soumission = data as unknown as Soumission;
          createdSoumissions.push(soumission);
          if (soumission.form_session_id) existingSoumissionsBySessionKey.set(soumission.form_session_id, soumission);
        }

        convertedIds.add(s.id);
        linkedSoumissionIds.set(s.id, soumission.id);

        // ── Migrer les notes (et images jointes) attachées à la session
        // abandonnée vers la nouvelle soumission, pour qu'elles ne soient
        // pas perdues lors de la conversion.
        const storedNotes = parseAbandonedNotes(s.step_timings);
        let storedNotesMigrated = storedNotes.length === 0;
        if (storedNotes.length > 0) {
          const { error: noteInsertError } = await supabase.from('soumission_notes').insert(
            storedNotes.map(n => ({ soumission_id: soumission.id, content: n.content, created_at: n.created_at })) as any
          );
          if (noteInsertError) {
            console.error('Stored note migration failed for session', s.id, noteInsertError);
            toast.error(`Notes non migrées: ${noteInsertError.message}`);
          } else {
            storedNotesMigrated = true;
          }
        }
        if (soumission.id !== s.id) {
          try {
            await supabase.from('soumission_notes')
              .update({ soumission_id: soumission.id } as any)
              .eq('soumission_id', s.id);
          } catch (e) {
            console.warn('Note migration failed for session', s.id, e);
          }
        }

        const cleanedTimings = { ...(s.step_timings || {}) } as Record<string, any>;
        if (storedNotesMigrated) delete cleanedTimings[ABANDONED_NOTES_KEY];
        const updatePayload = { is_complete: true, soumission_id: soumission.id, step_timings: cleanedTimings } as any;
        const { data: updatedById, error: updateByIdError } = await supabase
          .from('form_sessions')
          .update(updatePayload)
          .eq('id', s.id)
          .select('id');

        if (updateByIdError || !updatedById?.length) {
          const { error: updateBySessionIdError } = await supabase
            .from('form_sessions')
            .update(updatePayload)
            .eq('session_id', s.session_id);

          if (updateByIdError || updateBySessionIdError) {
            console.error('Form session update error for session', s.id, updateBySessionIdError || updateByIdError);
          }
        }
      }

      if (convertedIds.size > 0) {
        if (createdSoumissions.length > 0) {
          queryClient.setQueryData<Soumission[]>(PROJECTS_QUERY_KEY, (old = []) => {
            const list = old || [];
            const seen = new Set(list.map(s => s.id));
            return [...createdSoumissions.filter(s => !seen.has(s.id)), ...list];
          });
        }

        if (selectedAbandoned && convertedIds.has(selectedAbandoned.id)) {
          setSelectedAbandoned(null);
        }

        setFormSessions(prev =>
          prev.map(fs =>
            convertedIds.has(fs.id)
              ? { ...fs, is_complete: true, soumission_id: linkedSoumissionIds.get(fs.id) ?? fs.soumission_id }
              : fs
          )
        );

        if (!idsOverride) setSelectedAbIds(new Set());
        await loadAux();
        queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      }
    } finally {
      setConverting(false);
    }
  }, [selectedAbIds, converting, abandonedSessions, selectedAbandoned, loadAux, soumissions, queryClient]);

  // Keep a ref to the latest convert function so swipe handlers can invoke it
  // after updating the selection state without triggering re-renders.
  useEffect(() => {
    convertAbandonedToSoumissionsRef.current = convertAbandonedToSoumissions;
  }, [convertAbandonedToSoumissions]);

  const toggleAbSelection = useCallback((id: string) => {
    setSelectedAbIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAllAb = useCallback(() => {
    if (selectedAbIds.size === abandonedSessions.length) {
      setSelectedAbIds(new Set());
    } else {
      setSelectedAbIds(new Set(abandonedSessions.map(s => s.id)));
    }
  }, [selectedAbIds.size, abandonedSessions]);

  const createMissingPdfs = useCallback(async (submission: Soumission) => {
    const db = submission.dynasty_breakdown;
    if (!db || !Array.isArray(db.lines) || db.lines.length === 0) return null;

    const toNum = (value: unknown, fallback = 0) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    const quoteForPdf = {
      area_sqft: toNum(db.area_sqft, toNum(submission.area_sqft)),
      perimeter_ft: toNum(db.perimeter_ft),
      slope_category: (db.slope_category || 'legere') as any,
      roof_type: (db.roof_type || '4pans') as any,
      confidence: toNum(db.confidence, 0.5),
      slope_factor: toNum(db.slope_factor, 1),
      surface_corrected: toNum(db.surface_corrected, toNum(db.surface_sqft, toNum(submission.area_sqft))),
      surface_displayed: toNum(db.surface_sqft, toNum(db.surface_corrected, toNum(submission.area_sqft))),
      length_faitiere: 0,
      length_hanches: 0,
      length_noues: 0,
      lines: db.lines.map((line) => ({
        description: line.description,
        quantity: toNum(line.quantity),
        unit: line.unit,
        rate: toNum(line.rate),
        total_base: toNum(line.total_displayed),
        ratio: 0,
        total_displayed: toNum(line.total_displayed),
      })),
      subtotal_base: toNum(db.subtotal_base, toNum(submission.subtotal)),
      contingency: toNum(db.contingency),
      subtotal_displayed: toNum(db.subtotal_displayed, toNum(submission.subtotal)),
      tps: toNum(db.tps),
      tvq: toNum(db.tvq),
      total_final: toNum(db.total_final, toNum(submission.high_estimate)),
      low_confidence: Boolean(db.low_confidence),
    } as any;

    const buildingCtx: BuildingData = {
      geojson: null,
      lotGeojson: null,
      superficie: null,
      perimetre: null,
      largeur: null,
      profondeur: null,
      noLot: null,
      slopeCategory: quoteForPdf.slope_category,
      roofType: quoteForPdf.roof_type,
      confidence: quoteForPdf.confidence,
      productName: submission.product_name || '',
      productBrand: submission.product_brand || '',
      colorName: submission.color || '',
      coverageType: submission.coverage_type || '',
      satImageDataUrl: null,
    };

    const referenceId = buildPdfDisplayBase(submission.seq_number, submission.formatted_address);
    const { clientPath, internalPath } = buildPdfStorageObjectPaths(submission.seq_number, submission.formatted_address);

    const pdfCtx = {
      clientName: `${submission.first_name} ${submission.last_name}`.trim(),
      address: submission.formatted_address || '—',
      product: submission.product_name || '—',
      color: submission.color || '—',
      date: submission.desired_install_date || '—',
      quote: quoteForPdf,
      building: buildingCtx,
      pdfFilenameBase: referenceId,
      referenceId,
    };

    const [mergedB64, clientB64] = await Promise.all([
      generateMergedPdfBase64(pdfCtx),
      generateQuotePdfBase64(pdfCtx),
    ]);

    const toBlob = (b64: string) => {
      const bytes = atob(b64);
      const array = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
      return new Blob([array], { type: 'application/pdf' });
    };

    const [internalUpload, clientUpload] = await Promise.all([
      supabase.storage.from('quote-pdfs').upload(internalPath, toBlob(mergedB64), { contentType: 'application/pdf', upsert: true }),
      supabase.storage.from('quote-pdfs').upload(clientPath, toBlob(clientB64), { contentType: 'application/pdf', upsert: true }),
    ]);

    if (internalUpload.error && clientUpload.error) return null;

    const [clientUrl, internalUrl] = await Promise.all([
      getSignedQuotePdfUrl(clientPath),
      getSignedQuotePdfUrl(internalPath),
    ]);
    if (!clientUrl || !internalUrl) return null;
    return { client: clientUrl, internal: internalUrl };
  }, []);

  const resolvePdfCandidate = useCallback(async (candidates: string[]) => {
    for (const url of candidates) {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) return url;
      } catch {
        // try next candidate
      }

      try {
        const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (response.ok || response.status === 206) return url;
      } catch {
        // try next candidate
      }
    }

    return null;
  }, []);

  const searchBucketForPdf = useCallback(async (submission: Soumission, kind: PdfKind) => {
    const searchTerms = buildPdfBucketSearchTerms(submission.seq_number, submission.formatted_address);

    for (const searchTerm of searchTerms) {
      for (let offset = 0; offset < 300; offset += 100) {
        try {
          const { data, error } = await supabase.storage.from('quote-pdfs').list('', {
            limit: 100,
            offset,
            search: searchTerm,
          });

          if (error || !data?.length) break;

          const match = data.find((item) =>
            matchesPdfStorageFilename(item.name, submission.seq_number, submission.formatted_address, kind),
          );

          if (match?.name) {
            return await getSignedQuotePdfUrl(match.name);
          }

          if (data.length < 100) break;
        } catch {
          break;
        }
      }
    }

    return null;
  }, []);

  const resolvePdfUrlsForSubmission = useCallback(async (submission: Soumission) => {
    const candidates = await constructPdfUrlCandidates(submission);
    const [existingClient, existingInternal] = await Promise.all([
      resolvePdfCandidate(candidates.client),
      resolvePdfCandidate(candidates.internal),
    ]);

    const [resolvedClient, resolvedInternal] = await Promise.all([
      existingClient ? Promise.resolve(existingClient) : searchBucketForPdf(submission, 'client'),
      existingInternal ? Promise.resolve(existingInternal) : searchBucketForPdf(submission, 'internal'),
    ]);

    if (!resolvedClient || !resolvedInternal) {
      const regenerated = await createMissingPdfs(submission);
      if (regenerated) {
        return {
          client: resolvedClient ?? regenerated.client,
          internal: resolvedInternal ?? regenerated.internal,
        };
      }
    }

    if (!resolvedClient && !resolvedInternal) {
      return null;
    }

    return {
      client: resolvedClient,
      internal: resolvedInternal,
    };
  }, [createMissingPdfs, resolvePdfCandidate, searchBucketForPdf]);

  const revokePreviewPdfUrl = useCallback(() => {
    if (previewPdfObjectUrlRef.current) {
      URL.revokeObjectURL(previewPdfObjectUrlRef.current);
      previewPdfObjectUrlRef.current = null;
    }
  }, []);

  const openPdfForSubmission = useCallback(async (submission: Soumission, kind: PdfKind) => {
    const urls = await resolvePdfUrlsForSubmission(submission);
    const targetUrl = urls?.[kind];
    if (!targetUrl) return;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }, [resolvePdfUrlsForSubmission]);

  const selectedPdfUrls = selected ? resolvedPdfUrls : null;
  const activePdfUrl = selectedPdfUrls ? selectedPdfUrls[activePdfKind] : null;
  const pdfUnavailable = !resolvingPdf && selected && !selectedPdfUrls?.client && !selectedPdfUrls?.internal;

  useEffect(() => {
    if (!selectedPdfUrls || selectedPdfUrls[activePdfKind]) return;

    const fallbackKind = activePdfKind === 'client' ? 'internal' : 'client';
    if (selectedPdfUrls[fallbackKind]) {
      setActivePdfKind(fallbackKind);
    }
  }, [activePdfKind, selectedPdfUrls]);

  useEffect(() => {
    if (!selected) {
      setResolvedPdfUrls(null);
      setResolvingPdf(false);
      return;
    }

    let active = true;
    setResolvingPdf(true);

    resolvePdfUrlsForSubmission(selected)
      .then((urls) => {
        if (!active) return;
        setResolvedPdfUrls(urls);
      })
      .finally(() => {
        if (active) setResolvingPdf(false);
      });

    return () => {
      active = false;
    };
  }, [selected, resolvePdfUrlsForSubmission]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (!activePdfUrl) {
      revokePreviewPdfUrl();
      setPreviewPdfUrl(null);
      setLoadingPreviewPdf(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    revokePreviewPdfUrl();
    setPreviewPdfUrl(null);
    setLoadingPreviewPdf(true);

    fetch(activePdfUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('preview_pdf_fetch_failed');
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        previewPdfObjectUrlRef.current = objectUrl;
        setPreviewPdfUrl(objectUrl);
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setPreviewPdfUrl(null);
      })
      .finally(() => {
        if (active) setLoadingPreviewPdf(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activePdfUrl, revokePreviewPdfUrl]);

  useEffect(() => {
    return () => {
      revokePreviewPdfUrl();
    };
  }, [revokePreviewPdfUrl]);

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };
  const formatShortDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' }); }
    catch { return d; }
  };

  const activeFiltersCount = [filterStatus !== 'all', filterBrand !== 'all', filterCoverage !== 'all', filterDateFrom, filterDateTo].filter(Boolean).length;
  const clearFilters = () => { setFilterStatus('all'); setFilterBrand('all'); setFilterCoverage('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearch(''); setPage(0); };

  const handleStatClick = (label: string) => {
    if (!isMobile) return;
    if (label === 'Abandonnés') {
      setFilterSource('abandoned');
      setMobileStatFilter('Abandonnés');
      setFilterStatus('all');
      setPage(0);
      return;
    }
    if (filterSource === 'abandoned') setFilterSource('all');
    if (mobileStatFilter === label) {
      setMobileStatFilter(null);
      setFilterStatus('all');
    } else {
      setMobileStatFilter(label);
      const statuses = statFilterMap[label];
      if (!statuses || statuses.length === 0) {
        setFilterStatus('all');
      } else if (statuses.length === 1) {
        setFilterStatus(statuses[0]);
      } else {
        setFilterStatus('all');
      }
    }
    setPage(0);
  };

  // Find linked form session for a soumission
  const getLinkedSession = useCallback((s: Soumission) => {
    if (!s.form_session_id) return null;
    return formSessions.find(fs => fs.id === s.form_session_id || fs.session_id === s.form_session_id) || null;
  }, [formSessions]);

  // Stats — one count per status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STATUS_OPTIONS.forEach(s => { counts[s.value] = 0; });
    soumissions.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
    return counts;
  }, [soumissions]);

  return (
    <div style={{ color: '#e5e7eb', fontFamily: "'Segoe UI', Roboto, Arial, sans-serif" }}>

      {/* Stats */}
      <div style={{ padding: isMobile ? '12px 12px 0' : '16px 24px 0', display: 'flex', gap: isMobile ? 6 : 10, flexWrap: 'wrap', overflowX: 'auto' }}>
        {[
          { label: 'Total', value: soumissions.length, color: '#e5e7eb' },
          ...STATUS_OPTIONS.map(s => ({ label: s.label, value: statusCounts[s.value], color: s.color })),
          { label: 'Abandonnés', value: abandonedSessions.length, color: '#f87171' },
          ...(!isMobile ? [{ label: 'Moy. estimation', value: fmt(soumissions.filter(s => s.high_estimate).reduce((sum, s) => sum + (s.high_estimate || 0), 0) / (soumissions.filter(s => s.high_estimate).length || 1)), color: '#34d399' }] : []),
        ].map(st => {
          const isActive = isMobile && mobileStatFilter === st.label;
          return (
          <div key={st.label} onClick={() => handleStatClick(st.label)} style={{
            flex: isMobile ? '1 1 calc(50% - 6px)' : '1 1 110px', background: isActive ? 'rgba(99,102,241,0.15)' : 'rgba(20,20,40,0.6)', borderRadius: 10,
            padding: isMobile ? '8px 10px' : '10px 14px', border: `1px solid ${isActive ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.05)'}`,
            cursor: isMobile ? 'pointer' : 'default', transition: 'all 0.15s',
          }}>
            <div style={{ fontSize: isMobile ? 12 : 13, color: '#9ca3af', marginBottom: 2, fontWeight: 600 }}>{st.label}</div>
            <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: st.color }}>{st.value}</div>
          </div>
          );
        })}
      </div>

      {/* Source filter pills */}
      <div style={{ padding: isMobile ? '10px 12px 0' : '14px 24px 0', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {([
          { value: 'all' as const, label: 'Tous', color: '#e5e7eb' },
          { value: 'web' as const, label: `Web (${soumissions.filter(s => !!s.page_url).length})`, color: '#4ade80' },
          { value: 'manual' as const, label: `Manuel (${soumissions.filter(s => !s.page_url).length})`, color: '#fbbf24' },
          { value: 'abandoned' as const, label: `Abandonnés (${abandonedSessions.length})`, color: '#f87171' },
          { value: 'archived' as const, label: `Archivés (${archivedSoumissions.length})`, color: '#9ca3af' },
        ]).map(opt => (
          <button key={opt.value} onClick={() => { setFilterSource(opt.value); setPage(0); }}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: filterSource === opt.value ? 'rgba(255,255,255,0.06)' : 'transparent',
              color: filterSource === opt.value ? opt.color : '#9ca3af',
              borderBottom: filterSource === opt.value ? `2px solid ${opt.color}` : '2px solid transparent',
            }}>{opt.label}</button>
        ))}
      </div>

      {/* Search + Filters */}
      {!isMobile && (
        <div style={{ padding: '12px 24px 0' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 400 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#4b5563' }} />
              <Input placeholder="Rechercher…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                style={{ paddingLeft: 36, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: 10, height: 38, fontSize: 13 }} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}
              style={{ color: activeFiltersCount > 0 ? '#a5b4fc' : '#6b7280', gap: 6, fontSize: 12, background: showFilters ? 'rgba(99,102,241,0.1)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
              <Filter size={14} /> Filtres {activeFiltersCount > 0 && <span style={{ background: '#6366f1', color: '#fff', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{activeFiltersCount}</span>}
            </Button>
            {activeFiltersCount > 0 && <Button variant="ghost" size="sm" onClick={clearFilters} style={{ color: '#f87171', fontSize: 12, gap: 4 }}><X size={12} /> Réinitialiser</Button>}
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setViewMode('table')} title="Vue tableau"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px',
                  border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: viewMode === 'table' ? 'rgba(99,102,241,0.18)' : 'transparent',
                  color: viewMode === 'table' ? '#a5b4fc' : '#9ca3af',
                }}>
                <TableIcon size={13} /> Tableau
              </button>
              <button onClick={() => setViewMode('kanban')} title="Vue Kanban"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px',
                  border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: viewMode === 'kanban' ? 'rgba(99,102,241,0.18)' : 'transparent',
                  color: viewMode === 'kanban' ? '#a5b4fc' : '#9ca3af',
                }}>
                <LayoutGrid size={13} /> Kanban
              </button>
            </div>
          </div>
          {showFilters && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', padding: '14px 16px', background: 'rgba(20,20,40,0.5)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <FilterSelect label="Statut" value={filterStatus} onChange={v => { setFilterStatus(v); setPage(0); }}
                options={[{ value: 'all', label: 'Tous' }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label })), { value: 'abandoned', label: 'Abandonné' }]} />
              <FilterSelect label="Marque" value={filterBrand} onChange={v => { setFilterBrand(v); setPage(0); }}
                options={[{ value: 'all', label: 'Toutes' }, ...uniqueBrands.map(b => ({ value: b, label: b }))]} />
              <FilterSelect label="Couverture" value={filterCoverage} onChange={v => { setFilterCoverage(v); setPage(0); }}
                options={[{ value: 'all', label: 'Toutes' }, ...uniqueCoverages.map(c => ({ value: c, label: COVERAGE_FR[c] || c }))]} />
              <div>
                <label style={filterLabelStyle}>Date de</label>
                <input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(0); }} style={dateInputStyle} />
              </div>
              <div>
                <label style={filterLabelStyle}>Date à</label>
                <input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(0); }} style={dateInputStyle} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile search */}
      {isMobile && (
        <div style={{ padding: '10px 12px 0' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#4b5563' }} />
            <Input placeholder="Rechercher…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              style={{ paddingLeft: 36, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: 10, height: 38, fontSize: 13 }} />
          </div>
          {mobileStatFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600 }}>Filtre : {mobileStatFilter}</span>
              <button onClick={() => { setMobileStatFilter(null); setFilterStatus('all'); setFilterSource('all'); setPage(0); }}
                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}>
                <X size={12} /> Effacer
              </button>
              <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: isMobile ? '10px 12px 16px' : '12px 24px 24px', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#4b5563' }}>Chargement…</div>
        ) : (
          <>
            {/* Bulk action bar — archive (and convert for abandoned) */}
            {(selectedAbIds.size > 0 || selectedSoumIds.size > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '10px 16px', background: 'rgba(99,102,241,0.1)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.25)', flexWrap: 'wrap' }}>
                <CheckSquare size={16} style={{ color: '#a5b4fc' }} />
                <span style={{ fontSize: 13, color: '#d1d5db', fontWeight: 600 }}>
                  {selectedSoumIds.size + selectedAbIds.size} sélectionné{(selectedSoumIds.size + selectedAbIds.size) > 1 ? 's' : ''}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedAbIds.size > 0 && (
                    <button onClick={() => convertAbandonedToSoumissions()} disabled={converting || archiving}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (converting || archiving) ? 'wait' : 'pointer', opacity: (converting || archiving) ? 0.6 : 1 }}>
                      <ArrowRightCircle size={15} />
                      {converting ? 'Conversion…' : 'Convertir'}
                    </button>
                  )}
                  <button onClick={bulkArchive} disabled={archiving || converting}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#1a1a2e', fontSize: 13, fontWeight: 700, cursor: (archiving || converting) ? 'wait' : 'pointer', opacity: (archiving || converting) ? 0.6 : 1 }}>
                    <Archive size={15} />
                    {archiving ? 'Archivage…' : 'Archiver'}
                  </button>
                  <button onClick={() => { setSelectedAbIds(new Set()); setSelectedSoumIds(new Set()); }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
                </div>
              </div>
            )}

            {isMobile ? (
              /* ── Mobile card view (unified) ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paged.map((s) => {
                  const isAbandoned = s._source === 'abandoned';
                  const st = isAbandoned ? null : getStatusConfig(s.status);
                  const isNew = !isAbandoned && s.status === 'new';
                  const checked = isAbandoned ? selectedAbIds.has(s.id) : selectedSoumIds.has(s.id);
                  const bulkSelectActive = selectedSoumIds.size > 0 || selectedAbIds.size > 0;
                  const cardInner = (
                    <div
                      onClick={() => {
                        if (isAbandoned && s._session) { setSelectedAbandoned(s._session); setSelected(null); }
                        else { setSelected(s as Soumission); setSelectedAbandoned(null); setActivePdfKind('client'); setResolvedPdfUrls(null); }
                      }}
                      style={{
                        background: checked ? 'rgba(99,102,241,0.08)' : isNew ? st!.bg : 'rgba(15,15,30,0.6)', borderRadius: 12, padding: '12px 14px',
                        border: `1px solid ${checked ? 'rgba(99,102,241,0.3)' : isNew ? st!.border : 'rgba(255,255,255,0.05)'}`,
                        borderLeft: `3px solid ${isAbandoned ? '#f87171' : isNew ? st!.color : 'rgba(255,255,255,0.05)'}`,
                        cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}>
                      {/* Selection checkbox (works for both abandoned and submitted) */}
                      <div onClick={e => { e.stopPropagation(); isAbandoned ? toggleAbSelection(s.id) : toggleSoumSelection(s.id); }} style={{ paddingTop: 2, flexShrink: 0 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? '#6366f1' : 'rgba(255,255,255,0.15)'}`, background: checked ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{s.first_name}{s.last_name && s.last_name !== 'Non fourni' ? ` ${s.last_name}` : ''}</div>
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.formatted_address || '—'}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!isAbandoned && s.form_session_id && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', textTransform: 'uppercase' as const }}>Converti</span>}
                            {!isAbandoned && <span style={{ color: '#a5b4fc', fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>#{s.seq_number}</span>}
                            {s._source === 'abandoned' ? (
                              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', textTransform: 'uppercase' as const }}>Abandonné</span>
                            ) : s._source === 'manual' ? (
                              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)', textTransform: 'uppercase' as const }}>Manuel</span>
                            ) : (
                              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', textTransform: 'uppercase' as const }}>Web</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                          {isAbandoned ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>{s._abandonedStep}</span>
                              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', maxWidth: 100 }}>
                                <div style={{ width: `${s._abandonedProgress || 0}%`, height: '100%', borderRadius: 3, background: (s._abandonedProgress || 0) > 60 ? '#fbbf24' : '#f87171' }} />
                              </div>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>{s._abandonedProgress}%</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                              <StatusBadge status={s.status} onChange={v => updateStatus(s.id, v)} />
                              {s.work_type && (
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)', textTransform: 'uppercase' as const, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
                                  {WORK_TYPE_OPTIONS.find(o => o.value === s.work_type)?.label || s.work_type}
                                </span>
                              )}
                              {s.coverage_type && (
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)', textTransform: 'uppercase' as const, letterSpacing: 0.3, whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {COVERAGE_FR[s.coverage_type] || s.coverage_type}
                                </span>
                              )}
                              <EmailStatusBadge status={s.email_status} />
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {!isAbandoned && s.high_estimate && <span style={{ fontWeight: 700, color: '#34d399', fontFamily: 'monospace', fontSize: 13 }}>{fmt(s.high_estimate)}</span>}
                            <span style={{ fontSize: 11, color: '#6b7280' }}>{formatShortDate(s.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <SwipeableCard
                      key={s.id}
                      disabled={bulkSelectActive}
                      rightAction={s._source === 'archived' ? {
                        icon: ArchiveRestore,
                        label: 'Restaurer',
                        color: '#34d399',
                        textColor: '#0f172a',
                        onTrigger: () => unarchiveSoum(s.id),
                      } : {
                        icon: Archive,
                        label: 'Archiver',
                        color: '#f59e0b',
                        textColor: '#1a1a2e',
                        onTrigger: () => isAbandoned ? archiveSingleSession(s.id) : archiveSingleSoum(s.id),
                      }}
                      leftAction={isAbandoned ? {
                        icon: ArrowRightCircle,
                        label: 'Convertir',
                        color: '#6366f1',
                        textColor: '#fff',
                        onTrigger: () => convertSingleAbandoned(s.id),
                      } : undefined}
                    >
                      {cardInner}
                    </SwipeableCard>
                  );
                })}
                {paged.length === 0 && <div style={{ padding: 48, textAlign: 'center', color: '#4b5563' }}>Aucun résultat</div>}
              </div>
            ) : viewMode === 'kanban' ? (
              /* ── Kanban view — colonnes regroupées par PROJECT_PHASES ── */
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
                {PROJECT_PHASES.map(phase => {
                  const phaseItems = filtered.filter(
                    s => s._source !== 'abandoned' && phase.statuses.includes(s.status as any),
                  );
                  const totalEst = phaseItems.reduce((sum, s) => sum + (s.high_estimate || 0), 0);
                  const dropKey = `phase:${phase.key}`;
                  // Default landing status when dropped on the column body (first sub-status).
                  const defaultStatus = phase.statuses[0];
                  return (
                    <div key={phase.key}
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== dropKey) setDragOverCol(dropKey); }}
                      onDragLeave={e => { if (e.currentTarget === e.target) setDragOverCol(null); }}
                      onDrop={e => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData('text/plain');
                        if (id) {
                          const current = soumissions.find(x => x.id === id);
                          if (current && !phase.statuses.includes(current.status as any)) {
                            updateStatus(id, defaultStatus);
                          }
                        }
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                      style={{
                        flex: '0 0 280px', display: 'flex', flexDirection: 'column',
                        background: dragOverCol?.startsWith(`phase:${phase.key}`) ? 'rgba(99,102,241,0.10)' : 'rgba(15,15,30,0.6)',
                        borderRadius: 12,
                        border: `1px solid ${dragOverCol?.startsWith(`phase:${phase.key}`) ? '#6366f1' : 'rgba(255,255,255,0.06)'}`,
                        maxHeight: 'calc(100vh - 320px)',
                        transition: 'background 0.15s, border-color 0.15s',
                      }}>
                      {/* Phase header — sobre, style Linear */}
                      <div style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: '12px 12px 0 0',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', textTransform: 'uppercase', letterSpacing: 0.8 }}>{phase.label}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 99 }}>{phaseItems.length}</div>
                        </div>
                        {totalEst > 0 && (
                          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, fontFamily: 'monospace' }}>{fmt(totalEst)}</div>
                        )}
                      </div>
                      {/* Sub-status groups */}
                      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {phase.statuses.map(subStatus => {
                          const opt = getStatusOption(subStatus);
                          const subItems = phaseItems.filter(s => s.status === subStatus);
                          const subDropKey = `phase:${phase.key}:${subStatus}`;
                          const showSubHeader = phase.statuses.length > 1;
                          return (
                            <div key={subStatus}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragOverCol !== subDropKey) setDragOverCol(subDropKey); }}
                              onDrop={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const id = e.dataTransfer.getData('text/plain');
                                if (id) {
                                  const current = soumissions.find(x => x.id === id);
                                  if (current && current.status !== subStatus) updateStatus(id, subStatus);
                                }
                                setDraggingId(null);
                                setDragOverCol(null);
                              }}
                              style={{
                                display: 'flex', flexDirection: 'column', gap: 6,
                                padding: dragOverCol === subDropKey ? 4 : 0,
                                borderRadius: 8,
                                background: dragOverCol === subDropKey ? 'rgba(99,102,241,0.08)' : 'transparent',
                                transition: 'background 0.15s, padding 0.15s',
                              }}>
                              {showSubHeader && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: 99, background: opt.accent }} />
                                    <span style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6 }}>{opt.label}</span>
                                  </div>
                                  <span style={{ fontSize: 10, color: '#6b7280' }}>{subItems.length}</span>
                                </div>
                              )}
                              {subItems.map(s => (
                                <div key={s.id}
                                  draggable
                                  onDragStart={e => {
                                    e.dataTransfer.setData('text/plain', s.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                    setDraggingId(s.id);
                                    didDragRef.current = true;
                                  }}
                                  onDragEnd={() => {
                                    setDraggingId(null);
                                    setDragOverCol(null);
                                    setTimeout(() => { didDragRef.current = false; }, 50);
                                  }}
                                  onClick={() => {
                                    if (didDragRef.current) return;
                                    setSelected(s as Soumission); setSelectedAbandoned(null); setActivePdfKind('client'); setResolvedPdfUrls(null);
                                  }}
                                  style={{
                                    background: 'rgba(25,25,50,0.85)', borderRadius: 8,
                                    padding: '10px 12px', cursor: draggingId === s.id ? 'grabbing' : 'grab',
                                    userSelect: 'none' as const,
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    borderLeft: `3px solid ${opt.accent}`,
                                    opacity: draggingId === s.id ? 0.4 : 1,
                                    transition: 'opacity 0.15s, transform 0.15s, background 0.15s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(35,35,70,0.95)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(25,25,50,0.85)'; }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                    <div style={{ fontWeight: 700, color: '#fff', fontSize: 13, lineHeight: 1.3 }}>
                                      {s.first_name}{s.last_name && s.last_name !== 'Non fourni' ? ` ${s.last_name}` : ''}
                                    </div>
                                    <span style={{ color: '#a5b4fc', fontWeight: 700, fontFamily: 'monospace', fontSize: 11, flexShrink: 0, marginLeft: 6 }}>#{s.seq_number}</span>
                                  </div>
                                  {s.formatted_address && (
                                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 4, lineHeight: 1.3 }}>
                                      <MapPin size={10} style={{ marginTop: 2, flexShrink: 0, color: '#6b7280' }} />
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{s.formatted_address}</span>
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                                    {s.work_type && (
                                      <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>
                                        {WORK_TYPE_OPTIONS.find(o => o.value === s.work_type)?.label || s.work_type}
                                      </span>
                                    )}
                                    {s.coverage_type && (
                                      <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.12)', color: '#c084fc', textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>
                                        {COVERAGE_FR[s.coverage_type] || s.coverage_type}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                    {s.high_estimate ? (
                                      <span style={{ fontWeight: 700, color: '#34d399', fontFamily: 'monospace', fontSize: 12 }}>{fmt(s.high_estimate)}</span>
                                    ) : <span />}
                                    <span style={{ fontSize: 10, color: '#6b7280' }}>{formatShortDate(s.created_at)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {phaseItems.length === 0 && (
                          <div style={{ padding: 20, textAlign: 'center', color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>—</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ── Desktop table (unified) ── */
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(15,15,30,0.6)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'rgba(25,25,50,0.9)' }}>
                      <SortTh col="seq_number" label="#" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={70} />
                      <SortTh col="status" label="Statut" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={140} />
                      <SortTh col="first_name" label="Client" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortTh col="first_name" label="Téléphone" sortKey={sortKey} sortDir={sortDir} onClick={() => {}} w={110} />
                      <SortTh col="formatted_address" label="Adresse" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortTh col="roof_category" label="Catégorie" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={100} />
                      <SortTh col="building_type" label="Bâtiment" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={100} />
                      <SortTh col="work_type" label="Travaux" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={100} />
                      <SortTh col="high_estimate" label="Estimation" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={100} />
                      <SortTh col="created_at" label="Date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} w={90} />
                      <th style={thStyle({ w: 100 })}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((s, i) => {
                      const isAbandoned = s._source === 'abandoned';
                      const st = isAbandoned ? null : getStatusConfig(s.status);
                      const isNew = !isAbandoned && s.status === 'new';
                      const rowBg = isAbandoned ? 'rgba(239,68,68,0.03)' : isNew ? st!.bg : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)');
                       const checked = isAbandoned ? selectedAbIds.has(s.id) : selectedSoumIds.has(s.id);
                      return (
                        <tr key={s.id} onClick={() => {
                          if (isAbandoned && s._session) { setSelectedAbandoned(s._session); setSelected(null); }
                          else { setSelected(s as Soumission); setSelectedAbandoned(null); setActivePdfKind('client'); setResolvedPdfUrls(null); }
                        }}
                          style={{ cursor: 'pointer', background: checked ? 'rgba(99,102,241,0.06)' : rowBg, borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s', borderLeft: isAbandoned ? '3px solid #f87171' : isNew ? `3px solid ${st!.color}` : '3px solid transparent' }}
                          onMouseEnter={e => (e.currentTarget.style.background = isAbandoned ? 'rgba(239,68,68,0.08)' : isNew ? 'rgba(59,130,246,0.22)' : 'rgba(99,102,241,0.06)')}
                          onMouseLeave={e => (e.currentTarget.style.background = checked ? 'rgba(99,102,241,0.06)' : rowBg)}>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div onClick={e => { e.stopPropagation(); isAbandoned ? toggleAbSelection(s.id) : toggleSoumSelection(s.id); }} style={{ cursor: 'pointer' }}>
                                <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${checked ? '#6366f1' : 'rgba(255,255,255,0.15)'}`, background: checked ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                                  {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                                </div>
                              </div>
                              <div>
                                {!isAbandoned && <span style={{ color: '#a5b4fc', fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{s.seq_number}</span>}
                                {s._source === 'abandoned' ? (
                                  <span style={{ display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', textTransform: 'uppercase' as const }}>Abandonné</span>
                                ) : s._source === 'manual' ? (
                                  <span style={{ display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, marginTop: 2, padding: '1px 4px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)', textTransform: 'uppercase' as const }}>Manuel</span>
                                ) : (
                                  <span style={{ display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, marginTop: 2, padding: '1px 4px', borderRadius: 3, background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', textTransform: 'uppercase' as const }}>Web</span>
                                )}
                                {!isAbandoned && s.form_session_id && (
                                  <span style={{ display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, marginTop: 2, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', textTransform: 'uppercase' as const }}>Converti</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            {isAbandoned ? (
                              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                                {s._abandonedStep}
                              </span>
                            ) : (
                              <StatusBadge status={s.status} onChange={v => updateStatus(s.id, v)} />
                            )}
                            <EmailStatusBadge status={s.email_status} />
                          </td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, input, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{s.first_name}{s.last_name && s.last_name !== 'Non fourni' ? ` ${s.last_name}` : ''}</div>
                            {!isAbandoned ? (
                              <InlineFieldEdit value={isPlaceholderEmailDash(s.email) ? '' : s.email} type="email" placeholder="—" onChange={v => updateField(s.id, 'email', v)} />
                            ) : (
                              <div style={{ fontSize: 11, color: '#6b7280' }}>{isPlaceholderEmailDash(s.email) ? '—' : s.email}</div>
                            )}
                          </td>
                          <td style={{ ...tdStyle }} onClick={e => { if ((e.target as HTMLElement).closest('button, input, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            {!isAbandoned ? (
                              <InlineFieldEdit value={s.phone && s.phone !== '000-000-0000' ? s.phone : ''} type="tel" placeholder="—" onChange={v => updateField(s.id, 'phone', v)} />
                            ) : (s.phone && s.phone !== '000-000-0000' ? <span style={{ fontSize: 11, color: '#6b7280' }}>{s.phone}</span> : <span style={{ color: '#4b5563' }}>—</span>)}
                          </td>
                          <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ca3af' }}>{s.formatted_address || '—'}</td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            {isAbandoned
                              ? <InlineCellSelect value={(s._session?.step_timings as any)?.roof_category || ''} options={ROOF_CATEGORY_OPTIONS} placeholder="—" onChange={v => updateSessionTimingsField(s.id, 'roof_category', v)} />
                              : <InlineCellSelect value={s.roof_category || ''} options={ROOF_CATEGORY_OPTIONS} placeholder="—" onChange={v => updateField(s.id, 'roof_category', v)} />}
                          </td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            {isAbandoned
                              ? <InlineCellSelect value={(s._session?.step_timings as any)?.building_type || ''} options={BUILDING_TYPE_OPTIONS} placeholder="—" onChange={v => updateSessionTimingsField(s.id, 'building_type', v)} />
                              : <InlineCellSelect value={s.building_type || ''} options={BUILDING_TYPE_OPTIONS} placeholder="—" onChange={v => updateField(s.id, 'building_type', v)} />}
                          </td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, select, [data-inline-edit]')) e.stopPropagation(); }}>
                            {isAbandoned ? (
                              <InlineCellSelect value={(s._session?.step_timings as any)?.work_type || ''} options={WORK_TYPE_OPTIONS} placeholder="—" onChange={v => updateSessionTimingsField(s.id, 'work_type', v)} />
                            ) : (
                              <InlineCellSelect value={s.work_type || ''} options={WORK_TYPE_OPTIONS} placeholder="—" onChange={v => updateField(s.id, 'work_type', v)} />
                            )}
                          </td>
                          <td style={tdStyle}>
                            {isAbandoned ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', maxWidth: 60 }}>
                                  <div style={{ width: `${s._abandonedProgress || 0}%`, height: '100%', borderRadius: 3, background: (s._abandonedProgress || 0) > 60 ? '#fbbf24' : '#f87171' }} />
                                </div>
                                <span style={{ fontSize: 11, color: '#6b7280' }}>{s._abandonedProgress}%</span>
                              </div>
                            ) : s.low_estimate && s.high_estimate ? (
                              <span style={{ fontWeight: 700, color: '#34d399', fontFamily: 'monospace', fontSize: 13 }}>{fmt(s.high_estimate)}</span>
                            ) : <span style={{ color: '#4b5563' }}>—</span>}
                          </td>
                          <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>{formatShortDate(s.created_at)}</td>
                          <td style={tdStyle} onClick={e => { if ((e.target as HTMLElement).closest('button, [data-inline-edit]')) e.stopPropagation(); }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {!isAbandoned && (
                                <>
                                  <ActionBtn onClick={() => void openPdfForSubmission(s as Soumission, 'client')} title="PDF Client" bg="rgba(99,102,241,0.12)" color="#818cf8"><Download size={12} /></ActionBtn>
                                  <ActionBtn onClick={() => void openPdfForSubmission(s as Soumission, 'internal')} title="PDF Complet" bg="rgba(245,158,11,0.12)" color="#fbbf24"><ExternalLink size={12} /></ActionBtn>
                                </>
                              )}
                              {s._source === 'archived' ? (
                                <button onClick={(e) => { e.stopPropagation(); unarchiveSoum(s.id); }} title="Désarchiver"
                                  style={{ width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                                  <ArchiveRestore size={12} />
                                </button>
                              ) : (
                                <button onClick={(e) => { e.stopPropagation(); isAbandoned ? archiveSession(s.id) : archiveSoumission(s.id); }} title="Archiver"
                                  style={{ width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
                                  <Archive size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {paged.length === 0 && <tr><td colSpan={11} style={{ padding: 48, textAlign: 'center', color: '#4b5563' }}>Aucun résultat</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ color: '#6b7280' }}><ChevronLeft size={16} /></Button>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Page {page + 1} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ color: '#6b7280' }}><ChevronRight size={16} /></Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation modal removed — replaced by Archive action */}

      {/* ── Detail drawer: completed soumission ── */}
      {selected && (
        <DetailDrawer
          onClose={() => setSelected(null)}
        >
          {/* Header */}
          <DrawerHeader>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff', lineHeight: 1.2, wordBreak: 'break-word' }}>{selected.first_name}{selected.last_name && selected.last_name !== 'Non fourni' ? ` ${selected.last_name}` : ''}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>#{selected.seq_number}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => navigate(`/admin/quote?id=${selected.id}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }} title="Modifier la soumission"><ArrowRightCircle size={16} /> Modifier la soumission</button>
              {selected.status === 'archived' || (selected as any).archived_at ? (
                <IconBtn onClick={() => unarchiveSoum(selected.id)} bg="rgba(52,211,153,0.12)" color="#34d399" title="Désarchiver"><ArchiveRestore size={15} /></IconBtn>
              ) : (
                <IconBtn onClick={() => archiveSoumission(selected.id)} bg="rgba(245,158,11,0.12)" color="#fbbf24" title="Archiver"><Archive size={15} /></IconBtn>
              )}
              <IconBtn onClick={() => setSelected(null)} bg="rgba(255,255,255,0.05)" color="#6b7280"><X size={16} /></IconBtn>
            </div>
          </DrawerHeader>

          <div style={{
            padding: 20,
            paddingBottom: 'calc(140px + env(safe-area-inset-bottom))',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y',
            flex: '1 1 auto',
            minHeight: 0,
          }}>
            <LeadDetailBody
              leadId={selected.id}
              mode="admin"
              onNavigateToQuote={() => setSelected(null)}
            />
          </div>
        </DetailDrawer>
      )}

      {/* ── Detail drawer: abandoned session ── */}
      {selectedAbandoned && (
        <DetailDrawer onClose={() => setSelectedAbandoned(null)}>
          <DrawerHeader>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>
                <AlertTriangle size={16} style={{ color: '#f87171', marginRight: 6, verticalAlign: -2 }} />
                {selectedAbandoned.first_name || 'Anonyme'} {selectedAbandoned.last_name || ''}
              </h2>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                Abandonné à: {getFullStepLabel(selectedAbandoned)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <IconBtn onClick={() => { archiveSession(selectedAbandoned.id); setSelectedAbandoned(null); }} bg="rgba(245,158,11,0.12)" color="#fbbf24" title="Archiver"><Archive size={15} /></IconBtn>
              <IconBtn onClick={() => setSelectedAbandoned(null)} bg="rgba(255,255,255,0.05)" color="#6b7280"><X size={16} /></IconBtn>
            </div>
          </DrawerHeader>

          <div style={{
            padding: 20,
            paddingBottom: 'calc(140px + env(safe-area-inset-bottom))',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y',
            flex: '1 1 auto',
            minHeight: 0,
          }}>
            {/* Satellite */}
            {selectedAbandoned.lat && selectedAbandoned.lng && (
              <DetailSection title="Images satellite">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[18, 19, 20].map(zoom => (
                    <div key={zoom}
                      onClick={() => setLightboxUrl(buildSatelliteUrl(selectedAbandoned.lat!, selectedAbandoned.lng!, zoom, '1280x960'))}
                      style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', cursor: 'zoom-in' }}>
                      <img src={buildSatelliteUrl(selectedAbandoned.lat!, selectedAbandoned.lng!, zoom, '400x300')} alt={`z${zoom}`}
                        style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} loading="lazy" />
                      <span style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px', fontSize: 9, color: '#9ca3af' }}>z{zoom}</span>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {/* Progression + Timings merged */}
            {(() => {
              const timings = selectedAbandoned.step_timings || {};
              const hasIntro = !!timings['intro_name_enter'] || !!timings['intro_phone_enter'];
              const labels = hasIntro ? STEP_LABELS_FULL : STEP_LABELS;
              const fullIdx = getFullStepIndex(selectedAbandoned);
              const durations = computeStepDurationsFull(timings);
              const totalTime = Object.values(durations).reduce((a, b) => a + b, 0);
              return (
                <DetailSection title="Progression du formulaire">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {labels.map((label, i) => {
                      const reached = i <= fullIdx;
                      const isLast = i === fullIdx;
                      const dur = durations[i];
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700,
                            background: isLast ? 'rgba(239,68,68,0.2)' : reached ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                            color: isLast ? '#f87171' : reached ? '#4ade80' : '#4b5563',
                            border: `1.5px solid ${isLast ? 'rgba(239,68,68,0.3)' : reached ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
                          }}>
                            {isLast ? '✕' : reached ? '✓' : i + 1}
                          </div>
                          <span style={{ fontSize: 12, color: reached ? '#d1d5db' : '#4b5563', fontWeight: isLast ? 600 : 400 }}>{label}</span>
                          {dur !== undefined && <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginLeft: 'auto' }}>{formatDuration(dur)}</span>}
                          {isLast && dur === undefined && <span style={{ fontSize: 10, color: '#f87171', marginLeft: 'auto' }}>Abandonné ici</span>}
                        </div>
                      );
                    })}
                  </div>
                  {totalTime > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Temps total</span>
                      <span style={{ fontSize: 12, color: '#a5b4fc', fontFamily: 'monospace', fontWeight: 600 }}>{formatDuration(totalTime)}</span>
                    </div>
                  )}
                </DetailSection>
              );
            })()}

            {/* Réponses partielles */}
            <DetailSection title="Réponses collectées">
              <DetailRow label="Adresse" value={selectedAbandoned.formatted_address || '—'} icon={<MapPin size={12} />} />
              <DetailRow label="Courriel" value={selectedAbandoned.email || '—'} link={selectedAbandoned.email ? `mailto:${selectedAbandoned.email}` : undefined} icon={<Mail size={12} />} />
              <DetailRow label="Téléphone" value={selectedAbandoned.phone || '—'} link={selectedAbandoned.phone ? `tel:${selectedAbandoned.phone}` : undefined} icon={<Phone size={12} />} />
              <EditableDetailSelect label="Travaux" value={(selectedAbandoned.step_timings as any)?.work_type || ''} field="work_type" id={selectedAbandoned.id}
                options={WORK_TYPE_OPTIONS} onUpdate={(id, field, val) => updateSessionTimingsField(id, field, val)} />
              <EditableDetailSelect label="Catégorie" value={(selectedAbandoned.step_timings as any)?.roof_category || ''} field="roof_category" id={selectedAbandoned.id}
                options={ROOF_CATEGORY_OPTIONS} onUpdate={(id, field, val) => updateSessionTimingsField(id, field, val)} />
              <EditableDetailSelect label="Bâtiment" value={(selectedAbandoned.step_timings as any)?.building_type || ''} field="building_type" id={selectedAbandoned.id}
                options={BUILDING_TYPE_OPTIONS} onUpdate={(id, field, val) => updateSessionTimingsField(id, field, val)} />
              <DetailRow label="Couverture" value={selectedAbandoned.coverage_type ? (COVERAGE_FR[selectedAbandoned.coverage_type] || selectedAbandoned.coverage_type) : '—'} />
              <DetailRow label="Pente" value={selectedAbandoned.slope ? (SLOPE_FR[selectedAbandoned.slope] || selectedAbandoned.slope) : '—'} />
              <DetailRow label="Marque" value={selectedAbandoned.product_brand || '—'} />
              <DetailRow label="Produit" value={selectedAbandoned.product_name || '—'} />
              <DetailRow label="Couleur" value={selectedAbandoned.color || '—'} />
              <DetailRow label="Date souhaitée" value={selectedAbandoned.desired_install_date || '—'} />
            </DetailSection>

            {/* Conversation Marie-Ève */}
            {(() => {
              const transcript = selectedAbandoned.step_timings?.chat_transcript as string | undefined;
              const workType = selectedAbandoned.step_timings?.work_type as string | undefined;
              if (!transcript) return null;
              const lines = transcript.split('\n\n').filter(Boolean);
              const modeLabel = workType === 'reparations' ? 'Réparation' : workType === 'inspection' ? 'Inspection' : workType === 'nouvelle_construction' ? 'Construction' : 'Échange';
              return (
                <DetailSection title={`💬 Conversation ${modeLabel}`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lines.map((line, i) => {
                      const isClient = line.startsWith('👤');
                      const content = line.replace(/^(👤 Client|🤖 Marie-Ève):\s*/, '');
                      return (
                        <div key={i} style={{
                          alignSelf: isClient ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          padding: '10px 14px',
                          borderRadius: isClient ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                          background: isClient ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${isClient ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)'}`,
                          fontSize: 12, lineHeight: '1.5', color: '#d1d5db',
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: isClient ? '#818cf8' : '#4ade80', display: 'block', marginBottom: 4 }}>
                            {isClient ? '👤 Client' : '🤖 Marie-Ève'}
                          </span>
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </DetailSection>
              );
            })()}

            {/* Construction plans & project details */}
            {(() => {
              const timings = selectedAbandoned.step_timings || {};
              const planUrlsRaw = (timings as any).construction_plan_urls;
              const projectDetails = (timings as any).project_details as string | undefined;
              let planUrls: string[] = [];
              try { if (planUrlsRaw) planUrls = JSON.parse(planUrlsRaw); } catch {}
              if (!planUrls.length && !projectDetails) return null;
              return (
                <DetailSection title="📐 Plans & détails du projet">
                  {projectDetails && (
                    <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, fontSize: 12, color: '#d1d5db', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: planUrls.length > 0 ? 10 : 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#818cf8', display: 'block', marginBottom: 4 }}>📝 Détails du projet</span>
                      {projectDetails}
                    </div>
                  )}
                  {planUrls.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {planUrls.map((url, i) => {
                        const isPdf = url.toLowerCase().endsWith('.pdf');
                        return (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 80, height: 80, borderRadius: 10, overflow: 'hidden',
                              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)',
                              textDecoration: 'none', color: '#818cf8', fontSize: 10, fontWeight: 600,
                            }}>
                            {isPdf ? (
                              <div style={{ textAlign: 'center' }}>
                                <FileText size={24} style={{ marginBottom: 4 }} />
                                <div>Plan {i + 1}</div>
                              </div>
                            ) : (
                              <img src={url} alt={`Plan ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </DetailSection>
              );
            })()}


            <DetailSection title="Métadonnées">
              <DetailRow label="Créé le" value={formatDate(selectedAbandoned.created_at)} />
              <DetailRow label="Dernière activité" value={formatDate(selectedAbandoned.updated_at)} />
              <DetailRow label="ID session" value={selectedAbandoned.session_id} mono />
            </DetailSection>

            <DetailSection title="Notes & Images">
              <AbandonedNotesPanel
                session={selectedAbandoned}
                onSessionSaved={(sessionId, stepTimings) => {
                  setFormSessions(prev => prev.map(fs => fs.id === sessionId ? { ...fs, step_timings: stepTimings } : fs));
                  setSelectedAbandoned(prev => prev?.id === sessionId ? { ...prev, step_timings: stepTimings } : prev);
                }}
              />
            </DetailSection>
          </div>
        </DetailDrawer>
      )}

      {/* Satellite Lightbox */}
      {lightboxUrl && (
        <div onClick={() => setLightboxUrl(null)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'zoom-out',
        }}>
          <img src={lightboxUrl} alt="Satellite agrandie"
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, border: '2px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} />
          <button onClick={() => setLightboxUrl(null)} style={{
            position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none',
            borderRadius: '50%', width: 40, height: 40, color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
      )}
    </div>
  );
};

const DetailDrawer: React.FC<{ onClose: () => void; children: React.ReactNode; previewPane?: React.ReactNode }> = ({ onClose, children, previewPane }) => {
  const mobile = window.innerWidth < 768;

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: mobile ? 'column' : 'row', justifyContent: mobile ? 'flex-start' : 'flex-end' }}>
        {previewPane && !mobile && (
          <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
            {previewPane}
          </div>
        )}
        <div style={{
          position: 'relative',
          width: mobile ? '100%' : 600,
          maxWidth: mobile ? '100%' : '100vw',
          background: '#0f0f1e',
          borderLeft: mobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column',
          boxShadow: mobile ? 'none' : '-20px 0 60px rgba(0,0,0,0.5)',
          height: '100%',
          overflow: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

const DrawerHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'sticky', top: 0, background: 'rgba(15,15,30,0.98)', backdropFilter: 'blur(16px)', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
    {children}
  </div>
);

const IconBtn: React.FC<{ onClick: () => void; bg: string; color: string; title?: string; children: React.ReactNode }> = ({ onClick, bg, color, title, children }) => (
  <button onClick={onClick} title={title} style={{ background: bg, border: 'none', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color }}>{children}</button>
);

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string; color?: string }> = ({ active, onClick, label, color }) => (
  <button onClick={onClick} style={{
    padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600,
    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
    color: active ? (color || '#a5b4fc') : '#9ca3af',
    borderBottom: active ? `2px solid ${color || '#6366f1'}` : '2px solid transparent',
  }}>{label}</button>
);

const StatusBadge: React.FC<{ status: string; onChange: (v: string) => void }> = ({ status, onChange }) => {
  const [open, setOpen] = useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const cfg = getStatusConfig(status);

  const openMenu = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const menuW = 180;
      const idealH = STATUS_OPTIONS.length * 40 + 16;
      let left = r.left;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      if (left < 8) left = 8;

      // Available space below and above the badge
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      let top: number;
      let maxHeight: number;
      if (spaceBelow >= idealH || spaceBelow >= spaceAbove) {
        // Place below, cap height to available space
        top = r.bottom + 4;
        maxHeight = Math.max(120, spaceBelow - 4);
      } else {
        // Place above, cap height to available space — anchor bottom to badge top
        maxHeight = Math.max(120, spaceAbove - 4);
        const h = Math.min(idealH, maxHeight);
        top = r.top - h - 4;
      }
      setCoords({ top, left, width: menuW, maxHeight });
    }
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        // Stop the parent SwipeableCard (framer-motion drag) from grabbing the pointer.
        onPointerDown={(e) => { e.stopPropagation(); }}
        onTouchStart={(e) => { e.stopPropagation(); }}
        style={{ padding: '8px 12px', minHeight: 36, borderRadius: 8, fontSize: 12, fontWeight: 700, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, cursor: 'pointer', whiteSpace: 'nowrap', touchAction: 'manipulation', display: 'inline-flex', alignItems: 'center' }}>
        {cfg.label}
      </button>
      {open && coords && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'transparent' }} onClick={() => setOpen(false)} />
          <div role="menu" style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight, overflowY: 'auto', zIndex: 10051, background: '#1a1a2e', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            {STATUS_OPTIONS.map(opt => (
              <button key={opt.value} onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', border: 'none', background: opt.value === status ? opt.bg : 'transparent', color: opt.value === status ? opt.color : '#d1d5db', fontSize: 13, fontWeight: opt.value === status ? 600 : 500, cursor: 'pointer', textAlign: 'left', touchAction: 'manipulation' }}
                onMouseEnter={e => { if (opt.value !== status) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (opt.value !== status) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: opt.color, marginRight: 10, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{opt.label}</span>
                {opt.value === status && <span style={{ marginLeft: 8, fontSize: 13 }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const SortTh: React.FC<{ col: SortKey; label: string; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void; w?: number }> = ({ col, label, sortKey, sortDir, onClick, w }) => (
  <th style={thStyle({ w })} onClick={() => onClick(col)}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
      {label}
      {sortKey === col ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} style={{ opacity: 0.3 }} />}
    </div>
  </th>
);

const FilterSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> = ({ label, value, onChange, options }) => (
  <div>
    <label style={filterLabelStyle}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: 'rgba(255,255,255,0.06)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, minWidth: 130, cursor: 'pointer', outline: 'none' }}>
      {options.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a2e' }}>{o.label}</option>)}
    </select>
  </div>
);

const InlineCellSelect: React.FC<{ value: string; options: { value: string; label: string }[]; placeholder: string; onChange: (v: string) => void }> = ({ value, options, placeholder, onChange }) => {
  const current = options.find(o => o.value === value);
  return (
    <select data-inline-edit value={value} onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
      style={{
        background: 'transparent', color: current ? '#d1d5db' : '#4b5563', border: 'none',
        fontSize: 11, cursor: 'pointer', outline: 'none', padding: '2px 0', maxWidth: 100,
        WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none',
        borderBottom: '1px dashed rgba(255,255,255,0.1)',
      }}>
      <option value="" style={{ background: '#1a1a2e', color: '#6b7280' }}>{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a2e', color: '#d1d5db' }}>{o.label}</option>)}
    </select>
  );
};

const InlineFieldEdit: React.FC<{ value: string; onChange: (v: string) => void; type?: string; placeholder?: string }> = ({ value, onChange, type = 'text', placeholder = '—' }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { setDraft(value); }, [value]);
  React.useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) onChange(trimmed);
  };

  if (!editing) {
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Cliquer pour modifier"
        style={{ fontSize: 11, color: '#6b7280', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.1)', display: 'inline-block', minWidth: 60, padding: '1px 0' }}
      >
        {value || placeholder}
      </div>
    );
  }

  return (
    <input
      onClick={e => e.stopPropagation()}
      ref={inputRef}
      type={type}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
      style={{
        fontSize: 11, color: '#d1d5db', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 4, padding: '2px 6px', outline: 'none', width: '100%', maxWidth: 180,
      }}
    />
  );
};

const ActionBtn: React.FC<{ onClick: () => void; title: string; bg: string; color: string; children: React.ReactNode }> = ({ onClick, title, bg, color, children }) => (
  <button type="button" onClick={onClick} title={title}
    style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color, border: 'none', cursor: 'pointer' }}>
    {children}
  </button>
);

const DetailSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <h3 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#4b5563', margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{title}</h3>
    {children}
  </div>
);

const DetailRow: React.FC<{ label: string; value: string; link?: string; bold?: boolean; mono?: boolean; icon?: React.ReactNode }> = ({ label, value, link, bold, mono, icon }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
    <span style={{ color: '#6b7280', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{label}</span>
    {link ? (
      <a href={link} target={link.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
        style={{ color: '#a5b4fc', fontSize: 13, fontWeight: bold ? 700 : 500, textDecoration: 'none', fontFamily: mono ? 'monospace' : undefined }}>{value}</a>
    ) : (
      <span style={{ color: bold ? '#34d399' : '#d1d5db', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 500, fontFamily: mono ? 'monospace' : undefined, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', wordBreak: 'break-word', textAlign: 'right' }}>{value}</span>
    )}
  </div>
);

const EditableDetailSelect: React.FC<{
  label: string;
  value: string;
  field: string;
  id: string;
  options: { value: string; label: string }[];
  onUpdate: (id: string, field: string, value: string) => Promise<void>;
}> = ({ label, value, field, id, options, onUpdate }) => {
  const displayLabel = options.find(o => o.value === value)?.label || value || '—';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
      <span style={{ color: '#6b7280', fontSize: 12 }}>{label}</span>
      <select
        value={value}
        onChange={e => onUpdate(id, field, e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.06)',
          color: '#d1d5db',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '3px 8px',
          fontSize: 12,
          outline: 'none',
          cursor: 'pointer',
          maxWidth: 220,
          textAlign: 'right',
          appearance: 'auto' as any,
          colorScheme: 'dark',
        }}
      >
        {!value && <option value="">—</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
};

const EditableDetailInput: React.FC<{
  label: string;
  value: string;
  field: string;
  id: string;
  type?: string;
  onUpdate: (id: string, field: string, value: string) => Promise<void>;
}> = ({ label, value, field, id, type = 'text', onUpdate }) => {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => { setLocal(value); }, [value]);
  const commit = () => {
    if (local !== value) {
      const val = type === 'number' ? String(parseFloat(local) || 0) : local;
      onUpdate(id, field, val);
    }
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
      <span style={{ color: '#6b7280', fontSize: 12 }}>{label}</span>
      <input
        type={type}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        style={{
          background: 'rgba(255,255,255,0.06)',
          color: '#d1d5db',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '3px 8px',
          fontSize: 12,
          outline: 'none',
          maxWidth: 160,
          textAlign: 'right',
          colorScheme: 'dark',
        }}
      />
    </div>
  );
};

/* ── Styles ── */
const thStyle = ({ w }: { w?: number }): React.CSSProperties => ({
  padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.05)', width: w, minWidth: w,
});
const tdStyle: React.CSSProperties = { padding: '9px 12px' };
const dateInputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none', colorScheme: 'dark' };
const filterLabelStyle: React.CSSProperties = { fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };
const pdfSidebarBtnStyle = (active: boolean): React.CSSProperties => ({
  width: '100%',
  border: `1px solid ${active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.12)'}`,
  background: active ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.03)',
  color: active ? '#c7d2fe' : '#d1d5db',
  borderRadius: 9,
  padding: '9px 10px',
  fontSize: 12,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  cursor: 'pointer',
});

const pdfPreviewTabStyle = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.14)'}`,
  background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
  color: active ? '#c7d2fe' : '#d1d5db',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
});

export default AdminDashboard;
