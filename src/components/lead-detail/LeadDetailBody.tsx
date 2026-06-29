/**
 * LeadDetailBody — vue détaillée unifiée d'une soumission.
 *
 * Affiche EXACTEMENT les mêmes informations dans tous les contextes
 * (Tableau de bord admin, Suivi des projets / Gantt, Calendrier).
 *
 * Synchronisation bidirectionnelle :
 *   - Lecture : passe par le cache React Query partagé `PROJECTS_QUERY_KEY`
 *     (alimenté par `useProjects` + Realtime global sur `soumissions`).
 *     Tout changement fait depuis n'importe quel autre vue est reflété
 *     instantanément ici.
 *   - Écriture : passe par les mêmes mutations (`useUpdateProject`,
 *     `useUpdateProjectStatus`) qui invalident le cache → toutes les vues
 *     ouvertes sont mises à jour.
 *   - Notes : abonnement Realtime dédié sur `soumission_notes` filtré par
 *     `soumission_id`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Phone, Mail, MapPin, MessageSquare, Plus, Loader2, Paperclip, Trash2,
  FileText, Users, Package, UserPlus, ExternalLink, Calculator, ArrowRightCircle,
} from 'lucide-react';
import { useProject, useUpdateProject, useUpdateProjectStatus } from '@/hooks/useProjects';
import { PROJECT_STATUSES } from '@/lib/project-statuses';
import { ProjectCloseout } from '@/components/ProjectCloseout';
import {
  ROOF_CATEGORY_OPTIONS, BUILDING_TYPE_OPTIONS, WORK_TYPE_OPTIONS, COMPLEXITY_OPTIONS,
  BRAND_OPTIONS, COVERAGE_FR, SLOPE_FR, PRODUCTS_BY_BRAND, COLORS_BY_PRODUCT,
} from '@/lib/soumissionFieldOptions';
import { downloadContactVCard } from '@/lib/vcard';
import { getSignedQuotePdfUrl } from '@/lib/pdf-storage';
import { toast } from 'sonner';

const db = supabase as any;

/* ── Constants partagées (mêmes valeurs que AdminDashboard) ── */
const STATUS_OPTIONS = PROJECT_STATUSES.map(s => ({ value: s.value, label: s.label }));

const isPlaceholderEmailDash = (v?: string | null) => {
  const e = (v || '').trim().toLowerCase();
  return !e || e.includes('@soumission.local') || e === 'inconnu@converti.ca';
};

const fmt = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const fmt2 = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });

const buildSatelliteUrl = (lat: number, lng: number, zoom: number, size: string) => {
  const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite&key=${key}`;
};

const formatDate = (s?: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

/* ── Hook: notes avec Realtime ── */
interface SoumissionNote { id: string; soumission_id: string; content: string; created_at: string; }

function useLeadNotes(leadId: string | null | undefined) {
  const [notes, setNotes] = useState<SoumissionNote[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!leadId) { setNotes([]); return; }
    setLoading(true);
    const { data } = await db.from('soumission_notes')
      .select('*').eq('soumission_id', leadId).order('created_at', { ascending: true });
    setNotes((data as SoumissionNote[]) || []);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime: tout changement sur les notes de ce lead (insert/update/delete)
  // recharge la liste — même si l'écriture vient d'une autre fenêtre.
  useEffect(() => {
    if (!leadId) return;
    const channel = supabase
      .channel(`lead-notes-${leadId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'soumission_notes',
        filter: `soumission_id=eq.${leadId}`,
      }, () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId, reload]);

  return { notes, loading, reload, setNotes };
}

/* ── Composants UI partagés ── */
const Section: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <h3 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#4b5563', margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: React.ReactNode; link?: string; bold?: boolean; mono?: boolean; icon?: React.ReactNode }> = ({ label, value, link, bold, mono, icon }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', gap: 10 }}>
    <span style={{ color: '#6b7280', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>{icon}{label}</span>
    {link ? (
      <a href={link} target={link.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
        style={{ color: '#a5b4fc', fontSize: 13, fontWeight: bold ? 700 : 500, textDecoration: 'none', fontFamily: mono ? 'monospace' : undefined, textAlign: 'right', wordBreak: 'break-word' }}>{value}</a>
    ) : (
      <span style={{ color: bold ? '#34d399' : '#d1d5db', fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 500, fontFamily: mono ? 'monospace' : undefined, maxWidth: 320, wordBreak: 'break-word', textAlign: 'right' }}>{value}</span>
    )}
  </div>
);

const SelectRow: React.FC<{
  label: string; value: string; readOnly?: boolean;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange, readOnly }) => {
  if (readOnly) {
    return <Row label={label} value={options.find(o => o.value === value)?.label || value || '—'} />;
  }
  // Si la valeur stockée ne correspond à AUCUNE option (ex. legacy "aucune",
  // "Membrane élastomère" en clair, etc.) on l'ajoute comme option supplémentaire
  // pour que le <select> reflète exactement la donnée réelle au lieu de
  // retomber silencieusement sur la 1ère option et de mentir à l'admin.
  const matched = !!value && options.some(o => o.value === value);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
      <span style={{ color: '#6b7280', fontSize: 12 }}>{label}</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ background: 'rgba(255,255,255,0.06)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', fontSize: 12, outline: 'none', cursor: 'pointer', maxWidth: 220, textAlign: 'right', appearance: 'auto' as any, colorScheme: 'dark' }}>
        <option value="">—</option>
        {!matched && value && <option value={value}>{value}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
};

const InputRow: React.FC<{
  label: string; value: string; type?: string; readOnly?: boolean;
  onCommit: (v: string) => void;
}> = ({ label, value, type = 'text', onCommit, readOnly }) => {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  if (readOnly) return <Row label={label} value={value || '—'} />;
  const commit = () => {
    if (local !== value) {
      const v = type === 'number' ? String(parseFloat(local) || 0) : local;
      onCommit(v);
    }
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
      <span style={{ color: '#6b7280', fontSize: 12 }}>{label}</span>
      <input type={type} value={local} onChange={e => setLocal(e.target.value)} onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        style={{ background: 'rgba(255,255,255,0.06)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', fontSize: 12, outline: 'none', maxWidth: 160, textAlign: 'right', colorScheme: 'dark' }} />
    </div>
  );
};

/* ── Props ── */
export interface LeadDetailBodyProps {
  /** ID de la soumission. Si null, on n'affiche que les sections externes (équipe etc.). */
  leadId: string | null;
  /**
   * - `admin` : toutes les sections, tous les champs éditables.
   * - `field` : mêmes sections affichées (read-only sur les champs de la
   *   soumission), avec en plus le bouton .vcf et la section équipe Dispatch.
   *   Les notes restent ajoutables/supprimables (utile sur le terrain).
   */
  mode: 'admin' | 'field';
  /** Noms des employés assignés via Dispatch (affichés en mode `field`). */
  assignedNames?: string[];
  /** Callback fermeture (pour activer le bouton "Modifier la soumission"). */
  onNavigateToQuote?: () => void;
}

/* ── Composant principal ── */
export const LeadDetailBody: React.FC<LeadDetailBodyProps> = ({
  leadId, mode, assignedNames, onNavigateToQuote,
}) => {
  const lead = useProject(leadId);
  const updateMut = useUpdateProject();
  const updateStatusMut = useUpdateProjectStatus();
  const { notes, loading: loadingNotes } = useLeadNotes(leadId);
  const navigate = useNavigate();

  const [newNote, setNewNote] = useState('');
  const [uploadingNoteImages, setUploadingNoteImages] = useState(false);
  const [savingVcf, setSavingVcf] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [galleryLightbox, setGalleryLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const noteFileInputRef = useRef<HTMLInputElement>(null);
  const notesEndRef = useRef<HTMLDivElement>(null);

  const readOnly = mode === 'field';

  const updateField = useCallback((field: string, value: string) => {
    if (!leadId) return;
    updateMut.mutate({ id: leadId, patch: { [field]: value } as any });
  }, [leadId, updateMut]);

  const updateStatus = useCallback((newStatus: string) => {
    if (!leadId) return;
    updateStatusMut.mutate({ id: leadId, status: newStatus as any });
  }, [leadId, updateStatusMut]);

  const addNote = useCallback(async () => {
    if (!leadId || !newNote.trim()) return;
    const { error } = await db.from('soumission_notes').insert({ soumission_id: leadId, content: newNote.trim() });
    if (error) {
      console.error('addNote failed', error);
      toast.error(`Échec de l'ajout: ${error.message}`);
      return;
    }
    setNewNote('');
    setTimeout(() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    // Realtime se charge du refresh
  }, [leadId, newNote]);

  const deleteNote = useCallback(async (noteId: string) => {
    await db.from('soumission_notes').delete().eq('id', noteId);
  }, []);

  const uploadNoteImages = useCallback(async (files: FileList | File[]) => {
    if (!leadId) return;
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) return;
    setUploadingNoteImages(true);
    try {
      const urls: string[] = [];
      for (const file of list) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const safeName = `notes/${leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, file, { contentType: file.type, upsert: true });
        if (!error) {
          const __signed = await getSignedQuotePdfUrl(safeName);
          const urlData = { publicUrl: __signed || '' };
          if (urlData?.publicUrl) urls.push(urlData.publicUrl);
        }
      }
      if (urls.length > 0) {
        const content = `${urls.length === 1 ? 'Image jointe' : `${urls.length} images jointes`}\n${urls.join('\n')}`;
        const { error } = await db.from('soumission_notes').insert({ soumission_id: leadId, content });
        if (error) {
          console.error('upload note image insert failed', error);
          toast.error(`Image non sauvegardée: ${error.message}`);
        }
      }
    } finally {
      setUploadingNoteImages(false);
      if (noteFileInputRef.current) noteFileInputRef.current.value = '';
    }
  }, [leadId]);

  /* ── Données dérivées ── */
  const dyn = (lead?.dynasty_breakdown as any) || null;
  const contactPhotoUrl: string | null = (dyn?.contact_photo_url as string | null) || null;

  const bundleLines = useMemo(() => {
    const out: { description: string; quantity: number; unit: string }[] = [];
    let total = 0;
    if (dyn?.lines && Array.isArray(dyn.lines)) {
      dyn.lines.forEach((l: any) => {
        const u = String(l.unit || '').toLowerCase();
        if (u.includes('paquet') || u.includes('bundle')) {
          out.push({ description: l.description, quantity: Number(l.quantity) || 0, unit: l.unit });
          total += Number(l.quantity) || 0;
        }
      });
    }
    return { lines: out, total };
  }, [dyn]);

  const planUrls = useMemo(() => {
    const urls: string[] = [];
    notes.filter(n => n.content.startsWith('📐 Plans de construction')).forEach(n => {
      const m = n.content.match(/https?:\/\/[^\s]+/g);
      if (m) urls.push(...m);
    });
    return urls;
  }, [notes]);

  const projectDetailNotes = useMemo(
    () => notes.filter(n => n.content.startsWith('📝 Détails du projet')),
    [notes],
  );

  const handleDownloadVcf = useCallback(async () => {
    if (!lead) return;
    setSavingVcf(true);
    try {
      await downloadContactVCard({
        first_name: lead.first_name || 'Contact',
        last_name: lead.last_name || '',
        phone: lead.phone || '',
        email: lead.email || '',
        formatted_address: lead.formatted_address || '',
        photo_url: contactPhotoUrl,
      });
    } finally {
      setSavingVcf(false);
    }
  }, [lead, contactPhotoUrl]);

  /* ── Rendu ── */
  if (!leadId) {
    return (
      <div style={{ padding: 30, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        Aucune soumission liée à ce projet.
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={{ padding: 30, display: 'flex', justifyContent: 'center' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#9ca3af' }} />
      </div>
    );
  }

  return (
    <>
      {/* Accès direct à la soumission en cours (module de soumission) — admin */}
      {!readOnly && leadId && (
        <button
          onClick={() => { navigate(`/admin/quote?id=${leadId}`); onNavigateToQuote?.(); }}
          style={{
            width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 10, marginBottom: 14, cursor: 'pointer',
            border: '1px solid rgba(99,102,241,0.4)',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.22))',
            color: '#c7d2fe', fontSize: 14, fontWeight: 700,
          }}>
          <ArrowRightCircle size={17} /> Ouvrir la soumission
        </button>
      )}

      {/* Vue satellite */}
      {lead.lat && lead.lng && (
        <Section title="Images satellite">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[18, 19, 20].map(zoom => (
              <div key={zoom}
                onClick={() => setLightboxUrl(buildSatelliteUrl(lead.lat!, lead.lng!, zoom, '1280x960'))}
                style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', cursor: 'zoom-in' }}>
                <img src={buildSatelliteUrl(lead.lat!, lead.lng!, zoom, '400x300')}
                  alt={`Satellite zoom ${zoom}`}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} loading="lazy" />
                <span style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px', fontSize: 9, color: '#9ca3af' }}>z{zoom}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Statut — éditable dans les deux modes */}
      <Section title="Statut">
        <SelectRow label="" value={lead.status}
          options={STATUS_OPTIONS}
          onChange={updateStatus} />
      </Section>

      {/* Photo de contact (Street View) — utile sur le terrain */}
      {contactPhotoUrl && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <img src={contactPhotoUrl} alt={`${lead.first_name} ${lead.last_name || ''}`}
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover',
              border: '2px solid rgba(99,102,241,0.4)', boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }} />
        </div>
      )}

      {/* Réponses du client */}
      <Section title="Réponses du client">
        <Row label="Prénom" value={lead.first_name || '—'} />
        <Row label="Nom" value={lead.last_name && lead.last_name !== 'Non fourni' ? lead.last_name : '—'} />
        <Row label="Téléphone" value={lead.phone || '—'} link={lead.phone ? `tel:${lead.phone}` : undefined} icon={<Phone size={12} />} />
        <Row label="Courriel" value={isPlaceholderEmailDash(lead.email) ? '—' : lead.email}
          link={!isPlaceholderEmailDash(lead.email) ? `mailto:${lead.email}` : undefined} icon={<Mail size={12} />} />
        <Row label="Adresse" value={lead.formatted_address || '—'} icon={<MapPin size={12} />} />
        <SelectRow label="Catégorie" value={lead.roof_category || ''}
          options={ROOF_CATEGORY_OPTIONS} readOnly={readOnly}
          onChange={v => updateField('roof_category', v)} />
        <SelectRow label="Bâtiment" value={lead.building_type || ''}
          options={BUILDING_TYPE_OPTIONS} readOnly={readOnly}
          onChange={v => updateField('building_type', v)} />
        <SelectRow label="Travaux" value={lead.work_type || ''}
          options={WORK_TYPE_OPTIONS} readOnly={readOnly}
          onChange={v => updateField('work_type', v)} />
        <Row label="Préférence contact" value={lead.contact_preference === 'sms' ? 'SMS' : lead.contact_preference === 'email' ? 'Courriel' : (lead.contact_preference || '—')} />

        {/* .vcf + Modifier la soumission */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button onClick={handleDownloadVcf} disabled={savingVcf}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)', cursor: savingVcf ? 'default' : 'pointer' }}>
            {savingVcf ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            Télécharger la fiche (.vcf)
          </button>
        </div>
      </Section>

      {/* Notes de suivi (édition autorisée dans tous les modes) */}
      <Section title="Notes de suivi">
        {loadingNotes ? (
          <div style={{ color: '#6b7280', fontSize: 12, padding: '8px 0' }}>Chargement…</div>
        ) : (
          <>
            {notes.length === 0 && (
              <div style={{ color: '#4b5563', fontSize: 12, padding: '8px 0', fontStyle: 'italic' }}>Aucune note pour le moment</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: notes.length > 0 ? 10 : 0 }}>
              {notes
                .filter(n => !n.content.startsWith('📐 Plans de construction') && !n.content.startsWith('📝 Détails du projet'))
                .map(note => {
                  const isConversation = note.content.startsWith('📋 Conversation');
                  if (isConversation) {
                    const lines = note.content.split('\n').filter(l => l.trim());
                    const title = lines[0];
                    const msgs = lines.slice(1);
                    return (
                      <div key={note.id} style={{ background: 'rgba(99,102,241,0.05)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(99,102,241,0.15)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MessageSquare size={13} /> {title.replace('📋 ', '')}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {msgs.map((msg, i) => {
                            const isClient = msg.startsWith('👤');
                            const text = msg.replace(/^(👤 Client|🤖 Marie-Ève):\s*/, '');
                            return (
                              <div key={i} style={{
                                alignSelf: isClient ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                                background: isClient ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)',
                                borderRadius: isClient ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                                padding: '8px 12px', fontSize: 12, color: '#d1d5db', lineHeight: 1.5,
                              }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: isClient ? '#818cf8' : '#34d399', marginBottom: 3 }}>
                                  {isClient ? '👤 Client' : '🤖 Marie-Ève'}
                                </div>
                                {text}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <span style={{ fontSize: 10, color: '#4b5563' }}>
                            {new Date(note.created_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button onClick={() => deleteNote(note.id)}
                            style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', padding: 2 }}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  }
                  // Note normale (texte + images optionnelles)
                  const imgUrls = (note.content.match(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|heic|heif)(?:\?\S*)?/gi) || []);
                  const textOnly = note.content.replace(/https?:\/\/\S+/g, '').trim();
                  return (
                    <div key={note.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      {textOnly && (
                        <div style={{ fontSize: 13, color: '#d1d5db', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{textOnly}</div>
                      )}
                      {imgUrls.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6, marginTop: textOnly ? 8 : 0 }}>
                          {imgUrls.map((url, i) => (
                            <button key={i} type="button" onClick={() => setGalleryLightbox({ images: imgUrls, index: i })}
                              style={{ display: 'block', borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', aspectRatio: '1', border: 'none', padding: 0, cursor: 'pointer' }}>
                              <img src={url} alt="Pièce jointe" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )}
                      {!textOnly && imgUrls.length === 0 && (
                        <div style={{ fontSize: 13, color: '#d1d5db', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{note.content}</div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: '#4b5563' }}>
                          {new Date(note.created_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button onClick={() => deleteNote(note.id)}
                          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', padding: 2 }}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              <div ref={notesEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={noteFileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={e => { if (e.target.files && e.target.files.length > 0) uploadNoteImages(e.target.files); }} />
              <button type="button" onClick={() => noteFileInputRef.current?.click()} disabled={uploadingNoteImages}
                title="Joindre des images"
                style={{ width: 38, height: 38, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                  cursor: uploadingNoteImages ? 'default' : 'pointer',
                  background: 'rgba(255,255,255,0.04)', color: '#a5b4fc',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end' }}>
                {uploadingNoteImages ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              </button>
              <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }}
                placeholder="Ajouter une note… (Entrée pour envoyer)" rows={2}
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '8px 12px', color: '#d1d5db', fontSize: 13, resize: 'vertical',
                  outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, minHeight: 40 }} />
              <button onClick={addNote} disabled={!newNote.trim()}
                style={{ width: 38, height: 38, borderRadius: 8, border: 'none', cursor: newNote.trim() ? 'pointer' : 'default',
                  background: newNote.trim() ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                  color: newNote.trim() ? '#a5b4fc' : '#4b5563',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end' }}>
                <Plus size={15} />
              </button>
            </div>
          </>
        )}
      </Section>

      {/* Plans de construction */}
      {planUrls.length > 0 && (
        <Section title="Plans de construction">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
            {planUrls.map((url, i) => {
              const isPdf = url.toLowerCase().endsWith('.pdf');
              return (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 6, padding: 12, borderRadius: 10,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    textDecoration: 'none', color: '#a5b4fc', fontSize: 11, height: 100 }}>
                  {isPdf ? <FileText size={28} style={{ opacity: 0.7 }} /> : (
                    <img src={url} alt={`Plan ${i + 1}`} style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 6 }} />
                  )}
                  <span>Plan {i + 1}</span>
                </a>
              );
            })}
          </div>
        </Section>
      )}

      {/* Détails du projet (nouvelle construction) */}
      {projectDetailNotes.length > 0 && (
        <Section title="📝 Détails du projet">
          {projectDetailNotes.map(n => (
            <div key={n.id} style={{ fontSize: 13, color: '#d1d5db', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
              {n.content.replace(/^📝 Détails du projet \(nouvelle construction\):\n\n?/, '')}
            </div>
          ))}
        </Section>
      )}

      {/* Détails de la soumission */}
      <Section title="Détails de la soumission">
        <SelectRow label="Couverture" value={lead.coverage_type || ''}
          options={Object.entries(COVERAGE_FR).map(([k, v]) => ({ value: k, label: v }))}
          readOnly={readOnly} onChange={v => updateField('coverage_type', v)} />
        <SelectRow label="Pente" value={lead.slope || ''}
          options={Object.entries(SLOPE_FR).map(([k, v]) => ({ value: k, label: v }))}
          readOnly={readOnly} onChange={v => updateField('slope', v)} />
        <SelectRow label="Complexité" value={lead.complexity || ''}
          options={COMPLEXITY_OPTIONS} readOnly={readOnly} onChange={v => updateField('complexity', v)} />
        <SelectRow label="Marque" value={lead.product_brand || ''}
          options={BRAND_OPTIONS}
          readOnly={readOnly} onChange={v => updateField('product_brand', v)} />
        <SelectRow label="Produit" value={lead.product_name || ''}
          options={(PRODUCTS_BY_BRAND[lead.product_brand || ''] || Object.values(PRODUCTS_BY_BRAND).flat()).map(n => ({ value: n, label: n }))}
          readOnly={readOnly} onChange={v => updateField('product_name', v)} />
        <SelectRow label="Couleur" value={lead.color || ''}
          options={(COLORS_BY_PRODUCT[lead.product_name || ''] || []).map(c => ({ value: c, label: c }))}
          readOnly={readOnly} onChange={v => updateField('color', v)} />
        <InputRow label="Superficie (pi²)" value={lead.area_sqft ? String(Math.round(lead.area_sqft)) : ''}
          type="number" readOnly={readOnly} onCommit={v => updateField('area_sqft', v)} />
        <Row label="Saisie originale" value={lead.area_input && lead.area_unit ? `${lead.area_input} ${lead.area_unit}` : '—'} />
        <InputRow label="Date souhaitée" value={lead.desired_install_date || ''}
          type="date" readOnly={readOnly} onCommit={v => updateField('desired_install_date', v)} />
        <Row label="Estimation" value={`${lead.low_estimate ? fmt(lead.low_estimate) : '—'} – ${lead.high_estimate ? fmt(lead.high_estimate) : '—'}`} />
        <Row label="Prix/pi²" value={lead.price_per_sqft ? fmt2(lead.price_per_sqft) : '—'} />
      </Section>

      {/* Matériaux / paquets de bardeaux */}
      {bundleLines.lines.length > 0 && (
        <Section title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Package size={13} /> Matériaux ({bundleLines.total} paquets)</span>}>
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {bundleLines.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <td style={{ padding: '8px 10px', color: '#d1d5db' }}>{l.description}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#34d399', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {l.quantity} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 11 }}>{l.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Équipe assignée (Dispatch) — seulement si fournie par le parent */}
      {assignedNames !== undefined && (
        <Section title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Users size={13} /> Équipe assignée</span>}>
          {assignedNames.length === 0 ? (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.06)', color: '#6b7280', fontSize: 11, textAlign: 'center' }}>
              Aucun employé assigné. Utilisez le tableau Dispatch pour assigner.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {assignedNames.map(n => (
                <span key={n} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                  background: 'rgba(99,102,241,0.18)', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.3)' }}>{n}</span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Détail du calcul Dynasty */}
      {dyn && Array.isArray(dyn.lines) && dyn.lines.length > 0 && (
        <Section title="Détail du calcul">
          <div style={{ background: 'rgba(99,102,241,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 10, border: '1px solid rgba(99,102,241,0.15)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#34d399', textAlign: 'center' }}>{fmt(dyn.total_final)}</div>
            <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 2 }}>TPS + TVQ incluses</div>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', lineHeight: 1.8, marginBottom: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
            <div>Surface brute: <b style={{ color: '#d1d5db' }}>{dyn.area_sqft?.toFixed(0)} pi²</b> | Périmètre: <b style={{ color: '#d1d5db' }}>{dyn.perimeter_ft?.toFixed(0)} pi</b></div>
            <div>Pente: <b style={{ color: '#d1d5db' }}>{dyn.slope_category}</b> (×{dyn.slope_factor}) | Type: <b style={{ color: '#d1d5db' }}>{dyn.roof_type}</b> ({(dyn.confidence * 100).toFixed(0)}%)</div>
            <div>Surface corrigée: <b style={{ color: '#d1d5db' }}>{dyn.surface_corrected?.toFixed(0)} pi²</b> → affichée: <b style={{ color: '#d1d5db' }}>{dyn.surface_sqft?.toFixed(0)} pi²</b></div>
          </div>
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(25,25,50,0.8)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#6b7280', fontWeight: 600 }}>Poste</th>
                  <th style={{ padding: '6px 6px', textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>Qté</th>
                  <th style={{ padding: '6px 6px', textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>Taux</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {dyn.lines.map((line: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '5px 8px', color: '#d1d5db' }}>{line.description}</td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: '#9ca3af' }}>{line.quantity} {line.unit}</td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: '#9ca3af' }}>{fmt2(line.rate)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#d1d5db', fontWeight: 600 }}>{fmt(line.total_displayed)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(25,25,50,0.5)' }}>
                  <td colSpan={3} style={{ padding: '5px 8px', fontWeight: 600, color: '#9ca3af' }}>Sous-total</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#d1d5db' }}>{fmt(dyn.subtotal_displayed)}</td>
                </tr>
                <tr><td colSpan={3} style={{ padding: '4px 8px', color: '#6b7280' }}>TPS (5%)</td><td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>{fmt2(dyn.tps)}</td></tr>
                <tr><td colSpan={3} style={{ padding: '4px 8px', color: '#6b7280' }}>TVQ (9.975%)</td><td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>{fmt2(dyn.tvq)}</td></tr>
                <tr style={{ borderTop: '2px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
                  <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 700, color: '#fff' }}>Total final</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#34d399', fontSize: 13 }}>{fmt(dyn.total_final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      {/* Clôture de projet — coût réel (heures × taux) vs revenu (admin uniquement) */}
      {!readOnly && (
        <Section title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Calculator size={11} /> Clôture de projet</span>}>
          <ProjectCloseout
            soumissionId={leadId}
            revenue={Number((lead as any).subtotal ?? (lead as any).high_estimate ?? dyn?.subtotal_displayed ?? 0) || 0}
            status={lead.status}
            onMarkDone={() => updateStatus('done')}
          />
        </Section>
      )}

      {/* Localisation */}
      <Section title="Localisation">
        <Row label="Coordonnées" value={lead.lat && lead.lng ? `${lead.lat.toFixed(5)}, ${lead.lng.toFixed(5)}` : '—'}
          link={lead.lat && lead.lng ? `https://maps.google.com/?q=${lead.lat},${lead.lng}` : undefined} mono />
        {lead.lat && lead.lng && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${lead.lat},${lead.lng}`} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.3)', textDecoration: 'none' }}>
            <ExternalLink size={12} /> Itinéraire Google Maps
          </a>
        )}
      </Section>

      {/* Métadonnées */}
      <Section title="Métadonnées">
        <Row label="Soumis le" value={formatDate(lead.created_at)} />
        <Row label="ID" value={lead.id} mono />
      </Section>

      {/* Lightbox satellite */}
      {lightboxUrl && (
        <div onClick={() => setLightboxUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={lightboxUrl} alt="Satellite" style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain' }} />
        </div>
      )}

      {/* Lightbox galerie de notes */}
      {galleryLightbox && (
        <div onClick={() => setGalleryLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={galleryLightbox.images[galleryLightbox.index]} alt="Pièce jointe"
            style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain' }} />
        </div>
      )}
    </>
  );
};

export default LeadDetailBody;