/**
 * AdminEmbauche.tsx — Tableau de bord des candidatures couvreurs.
 *
 * Route : /admin/embauche (auth required, via AdminLayout).
 *
 * Fonctionnalités :
 *  - Liste des candidatures (les plus récentes en haut)
 *  - Statut éditable : new / reviewing / interviewing / hired / rejected / archived
 *  - Tracking "réviewed_at" : se remplit automatiquement à la 1ère ouverture
 *    (équivalent du "ouverture vue" sur les soumissions)
 *  - Détails complets en panneau latéral (clic sur une ligne)
 *  - CV téléchargeable via signed URL (bucket privé)
 *  - Filtres par statut + recherche texte
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  HardHat, Search, Eye, FileText, X, ExternalLink,
  Sparkles, PhoneCall, XCircle, Inbox, Check, Trash2,
} from 'lucide-react';

type Status = 'new' | 'interesting' | 'to_contact' | 'rejected';

interface RoofApp {
  id: string;
  created_at: string;
  prenom: string;
  nom: string;
  telephone: string;
  email: string | null;
  carte_ccq: boolean;
  carte_ccq_niveau: string | null;
  carte_asp: boolean;
  spec_soudeur_sbs: boolean;
  spec_couvreur_bardeaux: boolean;
  spec_toiture_tole: boolean;
  spec_autre: string | null;
  annees_experience: number | null;
  disponibilite: string | null;
  references_text: string | null;
  notes: string | null;
  cv_storage_path: string | null;
  cv_filename: string | null;
  source: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  status: Status;
  reviewed_at: string | null;
  admin_notes: string | null;
}

// Statuts pipeline recrutement — ordre logique de progression :
//   1. Nouveau : tri à faire
//   2. Intéressant : à garder en short-list
//   3. À contacter : action immédiate du recruteur
//   4. Refusé : sortie du pipeline
// L'ordre dans STATUS_ORDER est utilisé pour l'affichage des filtres.
const STATUS_META: Record<Status, { label: string; color: string; icon: any; description: string }> = {
  new:        { label: 'Nouveau',      color: '#4499ff', icon: Inbox,      description: 'Pas encore trié' },
  interesting:{ label: 'Intéressant',  color: '#22c55e', icon: Sparkles,   description: 'Candidature à garder' },
  to_contact: { label: 'À contacter',  color: '#f59e0b', icon: PhoneCall,  description: 'Action immédiate' },
  rejected:   { label: 'Refusé',       color: '#6b7280', icon: XCircle,    description: 'Pas retenu' },
};

const STATUS_ORDER: Status[] = ['new', 'interesting', 'to_contact', 'rejected'];

// Safe accessor : retourne le meta du statut, ou le meta 'new' par défaut
// pour les anciennes valeurs (reviewing, interviewing, hired, archived)
// qui pourraient encore exister en DB. Évite les crashs JSX.
const statusMeta = (s: string | null | undefined) => STATUS_META[s as Status] || STATUS_META.new;

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
};

const ccqLabel = (n: string | null) => {
  if (!n) return '';
  const m: Record<string, string> = {
    apprenti_1: 'Apprenti 1', apprenti_2: 'Apprenti 2',
    apprenti_3: 'Apprenti 3', compagnon: 'Compagnon',
  };
  return m[n] || n;
};

const speciesLabels = (a: RoofApp) => {
  const s: string[] = [];
  if (a.spec_soudeur_sbs) s.push('Soudeur SBS');
  if (a.spec_couvreur_bardeaux) s.push('Bardeaux');
  if (a.spec_toiture_tole) s.push('Tôle');
  if (a.spec_autre) s.push(a.spec_autre);
  return s;
};

export default function AdminEmbauche() {
  const [apps, setApps] = useState<RoofApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RoofApp | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cvUrl, setCvUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('roofer_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(`Erreur chargement : ${error.message}`);
      setLoading(false);
      return;
    }
    setApps((data || []) as RoofApp[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Tracking "première ouverture" — comme les soumissions
  const openApplication = useCallback(async (a: RoofApp) => {
    setSelected(a);
    setCvUrl(null);

    if (!a.reviewed_at) {
      const { error } = await supabase
        .from('roofer_applications')
        .update({ reviewed_at: new Date().toISOString() })
        .eq('id', a.id);
      if (!error) {
        setApps((prev) => prev.map(x =>
          x.id === a.id ? { ...x, reviewed_at: new Date().toISOString() } : x));
      }
    }

    // Generate signed URL pour le CV si présent
    if (a.cv_storage_path) {
      const { data, error } = await supabase.storage
        .from('roofer-cvs')
        .createSignedUrl(a.cv_storage_path, 3600); // 1h
      if (error) {
        console.warn('[embauche] CV signed URL failed', error);
      } else {
        setCvUrl(data?.signedUrl || null);
      }
    }
  }, []);

  const updateStatus = useCallback(async (id: string, status: Status) => {
    const { error } = await supabase
      .from('roofer_applications')
      .update({ status })
      .eq('id', id);
    if (error) {
      toast.error(`Erreur mise à jour : ${error.message}`);
      return;
    }
    setApps((prev) => prev.map(a => a.id === id ? { ...a, status } : a));
    setSelected((s) => s?.id === id ? { ...s, status } : s);
    toast.success(`Statut changé à "${STATUS_META[status].label}"`);
  }, []);

  // Notes admin : debouncing 500ms — évite 1 PUT par keystroke. Maintient
  // l'état UI immédiat + flush en arrière-plan. Track le save status pour
  // afficher "Enregistré ✓" ou "Erreur" à côté du champ.
  const notesSaveTimer = React.useRef<number | null>(null);
  const [notesSaveStatus, setNotesSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const updateNotes = useCallback((id: string, admin_notes: string) => {
    setSelected((s) => s?.id === id ? { ...s, admin_notes } : s);
    setApps((prev) => prev.map(a => a.id === id ? { ...a, admin_notes } : a));
    setNotesSaveStatus('saving');
    if (notesSaveTimer.current) window.clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = window.setTimeout(async () => {
      const { error } = await supabase
        .from('roofer_applications')
        .update({ admin_notes })
        .eq('id', id);
      if (error) {
        console.warn('[embauche] notes save failed', error);
        setNotesSaveStatus('error');
        toast.error(`Sauvegarde notes échouée : ${error.message}`);
      } else {
        setNotesSaveStatus('saved');
        // Reset l'indicateur "Enregistré" après 2s
        window.setTimeout(() => setNotesSaveStatus('idle'), 2000);
      }
    }, 500);
  }, []);

  // Suppression définitive d'une candidature. On confirme côté UI (window.confirm),
  // on retire le CV du bucket si présent, puis on DELETE la ligne. Optimistic
  // update : on retire de la liste + on ferme le panneau dès succès.
  const deleteApplication = useCallback(async (app: RoofApp) => {
    const ok = window.confirm(
      `Supprimer définitivement la candidature de ${app.prenom} ${app.nom} ?\n\n` +
      `Cette action est irréversible (la ligne et le CV joint seront effacés).`
    );
    if (!ok) return;

    // 1. Best-effort : on supprime le CV du bucket si présent. Si ça échoue
    // (fichier déjà absent, etc.) on continue quand même avec le DELETE BD.
    if (app.cv_storage_path) {
      const { error: storageErr } = await supabase.storage
        .from('roofer-cvs')
        .remove([app.cv_storage_path]);
      if (storageErr) console.warn('[embauche] CV remove failed', storageErr);
    }

    const { error } = await supabase
      .from('roofer_applications')
      .delete()
      .eq('id', app.id);
    if (error) {
      toast.error(`Suppression échouée : ${error.message}`);
      return;
    }

    setApps((prev) => prev.filter((a) => a.id !== app.id));
    setSelected((s) => s?.id === app.id ? null : s);
    toast.success(`Candidature de ${app.prenom} supprimée`);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a) => {
      if (filter !== 'all' && a.status !== filter) return false;
      if (!q) return true;
      const hay = `${a.prenom} ${a.nom} ${a.telephone} ${a.email || ''} ${a.notes || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [apps, filter, search]);

  const counts = useMemo(() => {
    const c: Record<Status | 'all', number> = {
      all: apps.length, new: 0, interesting: 0, to_contact: 0, rejected: 0,
    };
    for (const a of apps) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [apps]);

  return (
    <div style={{ padding: 20, color: '#e5e7eb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <HardHat size={28} color="#f59e0b" />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Embauche couvreurs</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'hsl(230,10%,60%)' }}>
          {apps.length} candidature{apps.length > 1 ? 's' : ''} totale{apps.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Filtres + recherche */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}
          label={`Tous (${counts.all})`} color="#9ca3af" />
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}
            label={`${STATUS_META[s].label} (${counts[s] || 0})`} color={STATUS_META[s].color} />
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', background: 'hsl(230,22%,12%)',
          border: '1px solid hsl(230,20%,18%)', borderRadius: 6 }}>
          <Search size={14} color="hsl(230,10%,60%)" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Recherche…"
            style={{ background: 'transparent', border: 'none', outline: 'none',
              color: '#e5e7eb', fontSize: 13, width: 180 }} />
        </div>
      </div>

      {/* Tableau */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'hsl(230,10%,60%)' }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'hsl(230,10%,60%)' }}>
          {search || filter !== 'all' ? 'Aucun résultat' : 'Pas encore de candidatures.'}
        </div>
      ) : (
        <div style={{ background: 'hsl(230,22%,9%)', border: '1px solid hsl(230,20%,18%)',
          borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'hsl(230,22%,12%)', textAlign: 'left' }}>
                <th style={thStyle}>Reçu</th>
                <th style={thStyle}>Candidat</th>
                <th style={thStyle}>Téléphone</th>
                <th style={thStyle}>Spécialités</th>
                <th style={thStyle}>CCQ</th>
                <th style={thStyle}>Exp</th>
                <th style={thStyle}>Statut</th>
                <th style={thStyle}>CV</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isNew = !a.reviewed_at;
                return (
                  <tr key={a.id}
                    onClick={() => openApplication(a)}
                    style={{
                      borderTop: '1px solid hsl(230,20%,15%)',
                      cursor: 'pointer',
                      background: isNew ? 'hsl(230,30%,12%)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(230,22%,14%)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isNew ? 'hsl(230,30%,12%)' : 'transparent')}
                  >
                    <td style={tdStyle}>
                      {isNew && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                        background: '#4499ff', marginRight: 6 }} />}
                      {formatDate(a.created_at)}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#fff' }}>
                      {a.prenom} {a.nom}
                    </td>
                    <td style={tdStyle}>
                      <a href={`tel:${a.telephone}`} style={{ color: '#4499ff', textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}>{a.telephone}</a>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {speciesLabels(a).map((s) => (
                          <span key={s} style={specChipStyle}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {a.carte_ccq ? (
                        <span style={{ color: '#22c55e' }}>{ccqLabel(a.carte_ccq_niveau)}</span>
                      ) : (
                        <span style={{ color: 'hsl(230,10%,40%)' }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>{a.annees_experience != null ? `${a.annees_experience} ans` : '—'}</td>
                    <td style={tdStyle}>
                      <StatusBadge status={a.status} />
                    </td>
                    <td style={tdStyle}>
                      {a.cv_storage_path ? <FileText size={16} color="#22c55e" /> : '—'}
                    </td>
                    <td style={tdStyle}>
                      <Eye size={16} color="hsl(230,10%,50%)" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel détails */}
      {selected && (
        <DetailsPanel
          app={selected}
          cvUrl={cvUrl}
          notesSaveStatus={notesSaveStatus}
          onClose={() => setSelected(null)}
          onStatusChange={(s) => updateStatus(selected.id, s)}
          onNotesChange={(n) => updateNotes(selected.id, n)}
          onDelete={() => deleteApplication(selected)}
        />
      )}
    </div>
  );
}

// ---------- Panneau de détails ----------
const DetailsPanel: React.FC<{
  app: RoofApp;
  cvUrl: string | null;
  notesSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onClose: () => void;
  onStatusChange: (s: Status) => void;
  onNotesChange: (n: string) => void;
  onDelete: () => void;
}> = ({ app, cvUrl, notesSaveStatus, onClose, onStatusChange, onNotesChange, onDelete }) => {
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)', zIndex: 100,
      }} />
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: '100%', maxWidth: 540,
        background: 'hsl(230,22%,9%)',
        borderLeft: '1px solid hsl(230,20%,18%)',
        padding: 24, overflowY: 'auto',
        zIndex: 101,
        color: '#e5e7eb',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, flex: 1 }}>
            {app.prenom} {app.nom}
          </h2>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(230,10%,60%)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {STATUS_ORDER.map((s) => (
            <button key={s}
              onClick={() => onStatusChange(s)}
              style={{
                padding: '6px 10px', fontSize: 11, borderRadius: 6,
                border: `1px solid ${STATUS_META[s].color}66`,
                background: app.status === s ? `${STATUS_META[s].color}33` : 'transparent',
                color: STATUS_META[s].color, cursor: 'pointer',
                fontWeight: app.status === s ? 700 : 400,
              }}>
              {STATUS_META[s].label}
            </button>
          ))}
        </div>

        <Section title="Contact">
          <Row label="Téléphone" value={
            <a href={`tel:${app.telephone}`} style={{ color: '#4499ff' }}>{app.telephone}</a>
          } />
          <Row label="Courriel" value={app.email ? (
            <a href={`mailto:${app.email}`} style={{ color: '#4499ff' }}>{app.email}</a>
          ) : <span style={{ color: 'hsl(230,10%,50%)' }}>Non fourni</span>} />
          <Row label="Reçu le" value={formatDate(app.created_at)} />
          <Row label="Première ouverture admin" value={
            app.reviewed_at ? formatDate(app.reviewed_at) : <span style={{ color: '#4499ff' }}>À l'instant</span>
          } />
          <Row label="Source" value={app.source || 'embauche_form'} />
          {app.utm_campaign && <Row label="Campagne UTM" value={app.utm_campaign} />}
        </Section>

        <Section title="Cartes pro">
          <Row label="Carte CCQ" value={
            app.carte_ccq ? (
              <span style={{ color: '#22c55e' }}>Oui — {ccqLabel(app.carte_ccq_niveau)}</span>
            ) : <span style={{ color: 'hsl(230,10%,50%)' }}>Non</span>
          } />
          <Row label="Carte ASP" value={
            app.carte_asp ? <span style={{ color: '#22c55e' }}>Oui</span>
              : <span style={{ color: 'hsl(230,10%,50%)' }}>Non</span>
          } />
        </Section>

        <Section title="Spécialités">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {speciesLabels(app).length === 0
              ? <span style={{ color: 'hsl(230,10%,50%)' }}>Aucune cochée</span>
              : speciesLabels(app).map((s) => <span key={s} style={specChipStyle}>{s}</span>)
            }
          </div>
        </Section>

        <Section title="Profil">
          <Row label="Années d'expérience" value={app.annees_experience != null ? `${app.annees_experience} ans` : '—'} />
          <Row label="Disponibilité" value={app.disponibilite || '—'} />
        </Section>

        {app.references_text && (
          <Section title="Références">
            <div style={textBlock}>{app.references_text}</div>
          </Section>
        )}

        {app.notes && (
          <Section title="Notes du candidat">
            <div style={textBlock}>{app.notes}</div>
          </Section>
        )}

        <Section title="CV">
          {app.cv_storage_path ? (
            cvUrl ? (
              <a href={cvUrl} target="_blank" rel="noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', background: '#22c55e22',
                  border: '1px solid #22c55e66', borderRadius: 6,
                  color: '#22c55e', textDecoration: 'none', fontSize: 13,
                }}>
                <FileText size={14} /> Ouvrir {app.cv_filename || 'CV'}
                <ExternalLink size={12} />
              </a>
            ) : (
              <span style={{ color: 'hsl(230,10%,50%)', fontSize: 12 }}>Génération du lien…</span>
            )
          ) : (
            <span style={{ color: 'hsl(230,10%,50%)' }}>Pas de CV joint</span>
          )}
        </Section>

        <Section title="Notes admin (privées)">
          <div style={{ position: 'relative' }}>
            <textarea value={app.admin_notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={4}
              placeholder="Notes internes — auto-sauvegarde…"
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                background: 'hsl(230,22%,11%)', color: '#e5e7eb',
                border: '1px solid hsl(230,20%,20%)', borderRadius: 6,
                resize: 'vertical', minHeight: 80, outline: 'none',
                boxSizing: 'border-box',
              }} />
            <div style={{
              position: 'absolute', top: 8, right: 12,
              fontSize: 10, fontFamily: 'monospace',
              color: notesSaveStatus === 'saved' ? '#22c55e'
                : notesSaveStatus === 'saving' ? '#f59e0b'
                : notesSaveStatus === 'error' ? '#ef4444' : 'transparent',
              transition: 'color 0.2s',
              pointerEvents: 'none',
            }}>
              {notesSaveStatus === 'saving' && '⏳ Sauvegarde…'}
              {notesSaveStatus === 'saved' && '✓ Enregistré'}
              {notesSaveStatus === 'error' && '✕ Erreur'}
            </div>
          </div>
        </Section>

        {/* Zone danger : suppression définitive. Placée tout en bas pour
            éviter les clics accidentels près des actions courantes. */}
        <div style={{
          marginTop: 24, paddingTop: 20,
          borderTop: '1px solid hsl(0,40%,20%)',
        }}>
          <button
            type="button"
            onClick={onDelete}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', fontSize: 13, fontWeight: 600,
              background: 'transparent', color: '#ef4444',
              border: '1px solid #ef444466', borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Trash2 size={14} /> Supprimer cette candidature
          </button>
          <p style={{ fontSize: 11, color: 'hsl(230,10%,50%)', marginTop: 8 }}>
            Action irréversible — la ligne et le CV joint seront effacés.
          </p>
        </div>
      </div>
    </>
  );
};

// ---------- Helpers UI ----------
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid hsl(230,20%,15%)' }}>
    <h3 style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b',
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', padding: '4px 0', fontSize: 13 }}>
    <span style={{ flex: '0 0 160px', color: 'hsl(230,10%,60%)' }}>{label}</span>
    <span style={{ flex: 1, color: '#e5e7eb' }}>{value}</span>
  </div>
);

const FilterChip: React.FC<{ active: boolean; onClick: () => void; label: string; color: string }> = ({ active, onClick, label, color }) => (
  <button onClick={onClick}
    style={{
      padding: '5px 12px', fontSize: 12, borderRadius: 6,
      border: `1px solid ${active ? color : 'hsl(230,20%,20%)'}`,
      background: active ? `${color}22` : 'transparent',
      color: active ? color : 'hsl(230,10%,70%)',
      cursor: 'pointer', fontWeight: active ? 700 : 400,
    }}>
    {label}
  </button>
);

const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
  const m = statusMeta(status);
  const Icon = m.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', fontSize: 11,
      background: `${m.color}22`, color: m.color,
      border: `1px solid ${m.color}44`, borderRadius: 4,
    }}>
      <Icon size={11} /> {m.label}
    </span>
  );
};

const thStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 11, color: 'hsl(230,10%,60%)',
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
};
const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };

const specChipStyle: React.CSSProperties = {
  padding: '2px 8px', fontSize: 11,
  background: 'hsl(35,30%,15%)', color: 'hsl(35,90%,70%)',
  border: '1px solid hsl(35,40%,25%)', borderRadius: 4,
};

const textBlock: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'hsl(230,22%,11%)', borderRadius: 6,
  border: '1px solid hsl(230,20%,18%)', whiteSpace: 'pre-wrap',
};
