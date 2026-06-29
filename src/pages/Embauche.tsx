/**
 * Embauche.tsx — Landing page de recrutement couvreurs (mode mini-funnel mobile-first).
 *
 * Route : /embauche (public, no auth). Aussi : embauche.toituresvb.com (Vercel alias).
 *
 * UX :
 *  - Hero plein écran (image + overlay) avec accroche + CTA "Postuler en 30s"
 *  - Form en 5 étapes (une question à la fois) pour maximiser la conversion :
 *      1. Prénom + Téléphone (les seuls champs vraiment requis)
 *      2. Métier (cards single-select)
 *      3. Cartes CCQ + ASP (cards toggle)
 *      4. Expérience (cards) + Disponibilité
 *      5. Détails optionnels + Email + Nom + CV
 *  - Submit → supabase insert + CV upload + email edge function + /embauche/merci
 *
 * Conversion : navigate('/embauche/merci') déclenche le tracking Google Ads
 * sur l'URL de la thank-you page (cf. EmbaucheMerci.tsx).
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Loader2, ChevronRight, ChevronLeft, Check, Upload,
  PhoneCall, Hammer, IdCard, Clock, FileText,
} from 'lucide-react';
import vbLogo from '@/assets/vb-logo-white.svg';
import heroBg from '@/assets/warranty-header-bg.jpg';

// ─────────────────────────────────────────────────────────────────────────────
// Palette (centralisée pour cohérence)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#080B12',
  card: '#111827',
  cardActive: '#181F2E',
  border: '#243044',
  borderActive: '#FF9F0A',
  inputBg: '#0F1522',
  orange: '#FF9F0A',
  orangeGlow: 'rgba(255,159,10,0.35)',
  text: '#F8FAFC',
  text2: '#94A3B8',
  success: '#22C55E',
};

type Metier = '' | 'couvreur_bardeaux' | 'soudeur_sbs' | 'toiture_tole' | 'apprenti' | 'autre';
type CcqNiveau = '' | 'aucune' | 'apprenti_1' | 'apprenti_2' | 'apprenti_3' | 'compagnon';
type ExpBucket = '' | '0_2' | '2_5' | '5_10' | '10_plus';
type Disponibilite = '' | 'immediate' | '2_semaines' | '1_mois' | 'autre';

interface FormState {
  prenom: string;
  nom: string;
  telephone: string;
  email: string;
  metier: Metier;
  metier_autre_text: string;
  carte_ccq: boolean;
  carte_ccq_niveau: CcqNiveau;
  carte_asp: boolean;
  exp_bucket: ExpBucket;
  disponibilite: Disponibilite;
  references_text: string;
  notes: string;
}

const INITIAL: FormState = {
  prenom: '', nom: '', telephone: '', email: '',
  metier: '', metier_autre_text: '',
  carte_ccq: false, carte_ccq_niveau: '',
  carte_asp: false,
  exp_bucket: '',
  disponibilite: '',
  references_text: '', notes: '',
};

const TOTAL_STEPS = 5;

const trackConversion = () => {
  if (typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', 'conversion', {
      send_to: 'AW-CONVERSION_ID/EMBAUCHE_LABEL',
      event_category: 'application',
    });
  }
};

function getUtmParams() {
  if (typeof window === 'undefined') return {};
  const sp = new URLSearchParams(window.location.search);
  return {
    utm_source: sp.get('utm_source') || undefined,
    utm_medium: sp.get('utm_medium') || undefined,
    utm_campaign: sp.get('utm_campaign') || undefined,
    referrer_url: document.referrer || undefined,
    user_agent: navigator.userAgent,
  };
}

const expBucketToInt = (b: ExpBucket): number | null => {
  switch (b) {
    case '0_2': return 1;
    case '2_5': return 3;
    case '5_10': return 7;
    case '10_plus': return 12;
    default: return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────────
export default function Embauche() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const onCvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { setCvFile(null); return; }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('CV trop volumineux (max 10 Mo)');
      e.target.value = '';
      return;
    }
    setCvFile(f);
  };

  // Validation par étape (ne bloque que prénom / tél / métier)
  const canAdvance = (s: number): boolean => {
    if (s === 1) return form.prenom.trim().length > 0 && form.telephone.trim().length >= 7;
    if (s === 2) {
      if (!form.metier) return false;
      if (form.metier === 'autre' && !form.metier_autre_text.trim()) return false;
      return true;
    }
    return true; // étapes 3-5 toutes optionnelles
  };

  const goNext = () => {
    if (!canAdvance(step)) {
      if (step === 1) toast.error('Prénom et téléphone requis');
      if (step === 2) toast.error('Choisis ton métier');
      return;
    }
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canAdvance(1) || !canAdvance(2)) {
      toast.error('Reviens compléter les champs requis');
      return;
    }

    setSubmitting(true);
    const tId = toast.loading('Envoi…');
    try {
      const utm = getUtmParams();
      const metierAsAutre =
        form.metier === 'apprenti' ? 'Apprenti' :
        form.metier === 'autre'    ? form.metier_autre_text.trim() :
        null;

      // PostgreSQL — INSERT ... RETURNING applique la SELECT policy en plus
      // de la WITH CHECK. Le rôle 'anon' n'a pas de SELECT policy sur la
      // table (volontaire — on ne veut pas que le public lise les candidatures
      // des autres), donc .select('id').single() planterait avec
      // "new row violates row-level security policy". On pré-génère l'UUID
      // côté client et on fait un INSERT sans RETURNING.
      const appId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const payload = {
        id: appId,
        prenom: form.prenom.trim(),
        nom: form.nom.trim() || form.prenom.trim(), // nom est NOT NULL en BD
        telephone: form.telephone.trim(),
        email: form.email.trim() || null,
        carte_ccq: form.carte_ccq,
        carte_ccq_niveau: form.carte_ccq ? (form.carte_ccq_niveau || null) : null,
        carte_asp: form.carte_asp,
        spec_soudeur_sbs: form.metier === 'soudeur_sbs',
        spec_couvreur_bardeaux: form.metier === 'couvreur_bardeaux',
        spec_toiture_tole: form.metier === 'toiture_tole',
        spec_autre: metierAsAutre,
        annees_experience: expBucketToInt(form.exp_bucket),
        disponibilite: form.disponibilite || null,
        references_text: form.references_text.trim() || null,
        notes: form.notes.trim() || null,
        source: utm.utm_source ? 'google_ads' : 'embauche_form',
        ...utm,
      };
      // INSERT sans RETURNING (pas de .select()) — la SELECT policy n'existe
      // pas pour anon (intentionnel : on ne veut pas que le public lise les
      // candidatures des autres). On a déjà l'id côté client.
      const { error: insErr } = await supabase
        .from('roofer_applications')
        .insert(payload);
      if (insErr) throw insErr;

      if (cvFile) {
        (async () => {
          try {
            const ext = cvFile.name.split('.').pop()?.toLowerCase() || 'pdf';
            const storagePath = `${appId}/cv.${ext}`;
            const { error: upErr } = await supabase.storage
              .from('roofer-cvs')
              .upload(storagePath, cvFile, { upsert: true, contentType: cvFile.type });
            if (upErr) throw upErr;
            await supabase.from('roofer_applications')
              .update({
                cv_storage_path: storagePath,
                cv_filename: cvFile.name,
                cv_uploaded_at: new Date().toISOString(),
              })
              .eq('id', appId);
          } catch (e) {
            console.warn('[embauche] CV upload failed (background)', e);
          }
        })();
      }

      supabase.functions
        .invoke('send-embauche-confirmation', { body: { application_id: appId } })
        .catch((mailErr) => console.warn('[embauche] email send failed', mailErr));

      toast.success('Envoyé !', { id: tId });
      // Surtout pas de setSubmitting(false) ici : le composant va se démonter
      // dans la milliseconde qui suit. Si on reset l'état, React re-render
      // le form avec le bouton "ENVOYER" restauré juste avant le démontage
      // → flicker visible avant /embauche/merci. On laisse spinner jusqu'au
      // démontage, point.
      navigate('/embauche/merci', {
        state: { prenom: form.prenom, email: form.email, telephone: form.telephone },
        replace: true,
      });
    } catch (e: any) {
      console.error('[embauche] submit error', e);
      toast.error(`Erreur : ${e?.message || e}`, { id: tId });
      setSubmitting(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER : hero plein écran tant que showForm = false
  // ───────────────────────────────────────────────────────────────────────────
  if (!showForm) {
    return (
      <>
        <GlobalEmbaucheCSS />
        <Hero onCta={() => { setShowForm(true); setStep(1); }} />
      </>
    );
  }

  return (
    <div style={pageStyle} className="embauche-root embauche-page">
      {/* Bandeau header */}
      <header style={headerStyle}>
        <img src={vbLogo} alt="Toitures VB" style={logoStyle} />
        <button onClick={() => setShowForm(false)} style={headerLinkStyle} type="button">
          Retour
        </button>
      </header>

      <main style={mainStyle}>
        <GlobalEmbaucheCSS />
        <ProgressDots current={step} total={TOTAL_STEPS} />

        <form onSubmit={(e) => { e.preventDefault(); if (step < TOTAL_STEPS) goNext(); else submit(); }}>
          <StepWrap key={step}>
            {step === 1 && <Step1 form={form} upd={upd} />}
            {step === 2 && <Step2 form={form} upd={upd} />}
            {step === 3 && <Step3 form={form} upd={upd} />}
            {step === 4 && <Step4 form={form} upd={upd} />}
            {step === 5 && <Step5 cvFile={cvFile} onCvChange={onCvChange} />}
          </StepWrap>

          {/* Footer navigation */}
          <div style={navRowStyle}>
            {step > 1 ? (
              <button type="button" onClick={goPrev} style={btnSecondaryStyle}>
                <ChevronLeft size={18} /> Retour
              </button>
            ) : <span />}

            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvance(step)}
                style={canAdvance(step) ? btnPrimaryStyle : btnPrimaryDisabledStyle}
              >
                Continuer <ChevronRight size={18} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                style={submitting ? btnPrimaryDisabledStyle : btnPrimaryStyle}
              >
                {submitting
                  ? (<><Loader2 size={18} className="animate-spin" /> Envoi…</>)
                  : (<>ENVOYER MA CANDIDATURE <Check size={18} /></>)}
              </button>
            )}
          </div>
        </form>

        <p style={legalStyle}>
          TOITURES VB INC. · RBQ 5854-9353-01 · Granby et environs
        </p>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero — full-screen landing
// ─────────────────────────────────────────────────────────────────────────────
const Hero: React.FC<{ onCta: () => void }> = ({ onCta }) => (
  <div style={heroOuterStyle} className="embauche-root embauche-hero">
    {/* <img> + fetchpriority="high" → preload natif, beaucoup plus rapide
        qu'un background-image CSS qui attend que le CSS soit parsé. */}
    <img
      src={heroBg}
      alt=""
      // @ts-expect-error fetchPriority pas encore typé partout
      fetchpriority="high"
      decoding="async"
      style={heroBgImgStyle}
    />
    <div style={heroOverlayStyle} />

    <header style={{ ...headerStyle, position: 'relative', zIndex: 2 }}>
      <img src={vbLogo} alt="Toitures VB" style={logoStyle} />
      <a href="tel:+14506758892" style={headerLinkStyle}>
        <PhoneCall size={14} /> 450-675-8892
      </a>
    </header>

    <main style={heroMainStyle}>
      <span style={badgeStyle} className="embauche-pulse-badge">
        <span style={badgeDotStyle} className="embauche-pulse-dot" /> 3 POSTES DISPONIBLES
      </span>

      <h1 style={heroTitleStyle}>
        ON EMBAUCHE<br />DES COUVREURS
      </h1>

      <p style={heroSubtitleStyle}>
        Granby et environs · Paye CCQ · Début rapide
      </p>

      <div style={priceStyle}>
        42$ À 48$<span style={priceUnitStyle}>/H</span>
      </div>

      <ul style={checklistStyle}>
        <CheckItem text="Temps plein" />
        <CheckItem text="Travail à l'année" />
        <CheckItem text="Équipe solide" />
        <CheckItem text="Pas de CV requis" />
      </ul>

      <button onClick={onCta} type="button" style={heroCtaStyle} className="embauche-cta embauche-pulse-cta">
        POSTULER EN 30 SECONDES <ChevronRight size={20} />
      </button>
      <p style={heroCtaSubStyle}>
        On te contacte rapidement par texto ou téléphone
      </p>
    </main>

    <footer style={heroFooterStyle}>
      TOITURES VB INC. · RBQ 5854-9353-01
    </footer>
  </div>
);

const CheckItem: React.FC<{ text: string }> = ({ text }) => (
  <li style={checkItemStyle}>
    <span style={checkIconStyle}><Check size={14} strokeWidth={3} /></span>
    {text}
  </li>
);

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────
interface StepProps {
  form: FormState;
  upd: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}

const Step1: React.FC<StepProps> = ({ form, upd }) => (
  <>
    <StepHeader
      icon={<PhoneCall size={20} color={C.orange} />}
      title="Comment on te rejoint ?"
      subtitle="On te contacte par texto ou téléphone dans la journée."
    />
    <Field label="Ton prénom">
      <input
        value={form.prenom}
        onChange={(e) => upd('prenom', e.target.value)}
        placeholder="Ex. Jonathan"
        style={inputStyle}
        autoComplete="given-name"
        autoFocus
      />
    </Field>
    <Field label="Ton numéro de téléphone">
      <input
        type="tel"
        value={form.telephone}
        onChange={(e) => upd('telephone', e.target.value)}
        placeholder="450-555-1234"
        style={inputStyle}
        autoComplete="tel"
        inputMode="tel"
      />
    </Field>
  </>
);

const METIER_CARDS: { val: Metier; label: string; sub: string }[] = [
  { val: 'couvreur_bardeaux', label: 'Couvreur bardeaux', sub: 'Résidentiel · pose & arrachage' },
  { val: 'soudeur_sbs',       label: 'Soudeur SBS',        sub: 'Membrane élastomère · commercial' },
  { val: 'toiture_tole',      label: 'Toiture tôle',       sub: 'Acier prépeint, joint debout' },
  { val: 'apprenti',          label: 'Apprenti',           sub: "J'apprends le métier" },
  { val: 'autre',             label: 'Autre',              sub: "Précise ton métier" },
];

const Step2: React.FC<StepProps> = ({ form, upd }) => (
  <>
    <StepHeader
      icon={<Hammer size={20} color={C.orange} />}
      title="C'est quoi ton métier ?"
      subtitle="Choisis ce qui te décrit le mieux."
    />
    <div style={cardListStyle}>
      {METIER_CARDS.map((c) => (
        <SelectCard
          key={c.val}
          active={form.metier === c.val}
          label={c.label}
          sub={c.sub}
          onClick={() => upd('metier', c.val)}
        />
      ))}
    </div>
    {form.metier === 'autre' && (
      <Field label="Précise ton métier">
        <input
          value={form.metier_autre_text}
          onChange={(e) => upd('metier_autre_text', e.target.value)}
          placeholder="Ex. Ferblantier, journalier…"
          style={inputStyle}
          autoFocus
        />
      </Field>
    )}
  </>
);

const CCQ_NIVEAUX: { val: CcqNiveau; label: string }[] = [
  { val: 'apprenti_1', label: 'Apprenti 1' },
  { val: 'apprenti_2', label: 'Apprenti 2' },
  { val: 'apprenti_3', label: 'Apprenti 3' },
  { val: 'compagnon',  label: 'Compagnon' },
];

const Step3: React.FC<StepProps> = ({ form, upd }) => (
  <>
    <StepHeader
      icon={<IdCard size={20} color={C.orange} />}
      title="Tes cartes pro"
      subtitle="Si tu n'en as pas — pas grave, on en parle quand même."
    />

    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ToggleCard
        active={form.carte_ccq}
        label="Carte CCQ"
        sub="Construction Québec"
        onClick={() => {
          const next = !form.carte_ccq;
          upd('carte_ccq', next);
          if (!next) upd('carte_ccq_niveau', '');
        }}
      />
      {form.carte_ccq && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginLeft: 4 }}>
          {CCQ_NIVEAUX.map((n) => (
            <SelectCard
              key={n.val}
              active={form.carte_ccq_niveau === n.val}
              label={n.label}
              compact
              onClick={() => upd('carte_ccq_niveau', n.val)}
            />
          ))}
        </div>
      )}
      <ToggleCard
        active={form.carte_asp}
        label="Carte ASP Construction"
        sub="Santé & sécurité chantier"
        onClick={() => upd('carte_asp', !form.carte_asp)}
      />
    </div>
  </>
);

const EXP_CARDS: { val: ExpBucket; label: string; sub: string }[] = [
  { val: '0_2',     label: '0 – 2 ans',  sub: 'Je débute' },
  { val: '2_5',     label: '2 – 5 ans',  sub: 'J\'ai de la base' },
  { val: '5_10',    label: '5 – 10 ans', sub: 'Solide' },
  { val: '10_plus', label: '10 ans +',   sub: 'Vétéran' },
];

const DISPO_OPTIONS: { val: Disponibilite; label: string }[] = [
  { val: 'immediate',   label: 'Tout de suite' },
  { val: '2_semaines',  label: '2 semaines' },
  { val: '1_mois',      label: '1 mois' },
  { val: 'autre',       label: 'À discuter' },
];

const Step4: React.FC<StepProps> = ({ form, upd }) => (
  <>
    <StepHeader
      icon={<Clock size={20} color={C.orange} />}
      title="Ton expérience"
      subtitle="Pour qu'on sache à qui parler."
    />

    <p style={miniLabelStyle}>EXPÉRIENCE EN TOITURE</p>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
      {EXP_CARDS.map((c) => (
        <SelectCard
          key={c.val}
          active={form.exp_bucket === c.val}
          label={c.label}
          sub={c.sub}
          onClick={() => upd('exp_bucket', c.val)}
        />
      ))}
    </div>

    <p style={miniLabelStyle}>DISPONIBILITÉ</p>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {DISPO_OPTIONS.map((d) => (
        <SelectCard
          key={d.val}
          active={form.disponibilite === d.val}
          label={d.label}
          compact
          onClick={() => upd('disponibilite', d.val)}
        />
      ))}
    </div>
  </>
);

interface Step5Props {
  cvFile: File | null;
  onCvChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Step 5 simplifiée : on demande une seule chose — déposer un CV ou non.
// Tout le reste (nom, email, notes, références) reste dans le schéma mais
// n'est plus sollicité ici. Le candidat veut postuler en 30s, point.
const Step5: React.FC<Step5Props> = ({ cvFile, onCvChange }) => {
  // Ouvre directement le picker quand on clique sur la card "Oui".
  const inputRef = React.useRef<HTMLInputElement>(null);
  const openPicker = () => inputRef.current?.click();

  return (
    <>
      <StepHeader
        icon={<FileText size={20} color={C.orange} />}
        title="As-tu un CV à joindre ?"
        subtitle="Pas obligatoire — on te contacte pareil."
      />

      <div style={cardListStyle}>
        <button
          type="button"
          onClick={openPicker}
          className="embauche-card"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10,
            padding: '16px 18px',
            minHeight: 64,
            background: cvFile ? C.cardActive : C.card,
            border: `1.5px solid ${cvFile ? C.borderActive : C.border}`,
            borderRadius: 14,
            color: C.text,
            textAlign: 'left',
            cursor: 'pointer',
            boxShadow: cvFile ? `0 0 0 3px ${C.orangeGlow}` : 'none',
            transition: 'background 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Upload size={20} color={C.orange} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>
                {cvFile ? 'CV joint' : 'Oui, joindre mon CV'}
              </span>
              <span style={{ fontSize: 12, color: C.text2 }}>
                {cvFile ? cvFile.name : 'PDF, Word, image · max 10 Mo'}
              </span>
            </div>
          </div>
          {cvFile && (
            <span style={checkmarkBadgeStyle}>
              <Check size={14} strokeWidth={3} color="#000" />
            </span>
          )}
        </button>

        <p style={{
          fontSize: 13, color: C.text2, textAlign: 'center',
          margin: '4px 0 0', lineHeight: 1.5,
        }}>
          Pas de CV ? Clique sur <strong style={{ color: C.text }}>Envoyer</strong>{' '}
          en bas — c'est tout.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          onChange={onCvChange}
          style={{ display: 'none' }}
        />
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Composants utilitaires
// ─────────────────────────────────────────────────────────────────────────────
const StepWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', gap: 14,
    animation: 'embaucheFade 220ms ease-out',
  }}>
    {children}
  </div>
);

// CSS global pour la landing : règles qui ne peuvent pas vivre en inline
// (pseudo-classes, viewport units modernes, safe-area, anti-zoom iOS).
const GlobalEmbaucheCSS = () => (
  <style>{`
    @keyframes embaucheFade {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .embauche-card:hover    { background: ${C.cardActive} !important; }
    .embauche-cta:hover     { box-shadow: 0 0 0 4px ${C.orangeGlow}; }
    .embauche-cta:active,
    .embauche-card:active   { transform: scale(0.98); }

    /* Reset tap highlight bleu + delay 300ms sur tout ce qui est interactif */
    .embauche-root button,
    .embauche-root a,
    .embauche-root label,
    .embauche-root input,
    .embauche-root textarea {
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    /* iOS Safari zoom au focus si font-size < 16px → on force 16 sur tous
       les inputs/textarea/selects de la landing. */
    .embauche-root input,
    .embauche-root textarea,
    .embauche-root select {
      font-size: 16px !important;
    }

    /* Hero : 100dvh = vraie hauteur visible (sans la barre de Safari mobile),
       fallback 100vh pour les vieux navigateurs. */
    .embauche-hero {
      min-height: 100vh;
      min-height: 100dvh;
      /* Safe-area pour iPhone X+ : on respecte le notch & le home indicator */
      padding-top:    env(safe-area-inset-top, 0);
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    .embauche-page {
      min-height: 100vh;
      min-height: 100dvh;
    }

    /* Anti overflow horizontal global */
    .embauche-root { overflow-x: hidden; }

    /* Pulse glow sur le badge "3 POSTES DISPONIBLES" — attire l'œil sans
       être agressif (cycle 2s, opacité du halo orange qui respire). */
    @keyframes embauchePulseBadge {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,159,10,0.0); }
      50%      { box-shadow: 0 0 0 6px rgba(255,159,10,0.18); }
    }
    .embauche-pulse-badge {
      animation: embauchePulseBadge 2.2s ease-in-out infinite;
    }
    /* Petit "ping" sur le dot rouge à l'intérieur du badge */
    @keyframes embauchePulseDot {
      0%, 100% { box-shadow: 0 0 0 4px rgba(255,159,10,0.25); }
      50%      { box-shadow: 0 0 0 8px rgba(255,159,10,0.05); }
    }
    .embauche-pulse-dot {
      animation: embauchePulseDot 1.6s ease-in-out infinite;
    }

    /* Pulse glow sur le CTA principal — halo orange qui grandit/se dissipe.
       Cycle 2.4s pour ne pas concurrencer le badge (rythmes différents). */
    @keyframes embauchePulseCta {
      0%, 100% { box-shadow: 0 8px 30px rgba(255,159,10,0.35),
                              0 0 0 0 rgba(255,159,10,0.5); }
      50%      { box-shadow: 0 8px 30px rgba(255,159,10,0.5),
                              0 0 0 10px rgba(255,159,10,0.0); }
    }
    .embauche-pulse-cta {
      animation: embauchePulseCta 2.4s ease-in-out infinite;
    }

    /* Respect des préférences utilisateur — pas d'animation si reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .embauche-pulse-badge,
      .embauche-pulse-dot,
      .embauche-pulse-cta { animation: none; }
    }
  `}</style>
);

const StepHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}> = ({ icon, title, subtitle }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(255,159,10,0.12)',
        border: `1px solid rgba(255,159,10,0.25)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
    </div>
    <h2 style={{
      fontSize: 24, fontWeight: 800, color: C.text,
      margin: 0, letterSpacing: -0.3, lineHeight: 1.2,
    }}>{title}</h2>
    <p style={{ fontSize: 14, color: C.text2, margin: '6px 0 0 0', lineHeight: 1.5 }}>
      {subtitle}
    </p>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span style={{ fontSize: 13, color: C.text2, fontWeight: 500 }}>{label}</span>
    {children}
  </label>
);

const SelectCard: React.FC<{
  active: boolean;
  label: string;
  sub?: string;
  compact?: boolean;
  onClick: () => void;
}> = ({ active, label, sub, compact, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="embauche-card"
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10,
      padding: compact ? '12px 14px' : '14px 16px',
      minHeight: compact ? 48 : 58,
      width: '100%',
      background: active ? C.cardActive : C.card,
      border: `1.5px solid ${active ? C.borderActive : C.border}`,
      borderRadius: 14,
      color: C.text,
      textAlign: 'left',
      cursor: 'pointer',
      transition: 'background 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
      boxShadow: active ? `0 0 0 3px ${C.orangeGlow}` : 'none',
      fontFamily: 'inherit',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: sub ? 2 : 0 }}>
      <span style={{ fontSize: compact ? 14 : 15, fontWeight: 700 }}>{label}</span>
      {sub && <span style={{ fontSize: 12, color: C.text2, fontWeight: 400 }}>{sub}</span>}
    </div>
    {active && (
      <span style={checkmarkBadgeStyle}><Check size={14} strokeWidth={3} color="#000" /></span>
    )}
  </button>
);

const ToggleCard: React.FC<{
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}> = ({ active, label, sub, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="embauche-card"
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10,
      padding: '14px 16px',
      minHeight: 58,
      background: active ? C.cardActive : C.card,
      border: `1.5px solid ${active ? C.borderActive : C.border}`,
      borderRadius: 14,
      color: C.text,
      textAlign: 'left',
      cursor: 'pointer',
      transition: 'background 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
      boxShadow: active ? `0 0 0 3px ${C.orangeGlow}` : 'none',
      fontFamily: 'inherit',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text2, fontWeight: 400 }}>{sub}</span>
    </div>
    {/* Pill style toggle */}
    <span
      style={{
        width: 44, height: 26, borderRadius: 999,
        background: active ? C.orange : '#1F2937',
        position: 'relative',
        transition: 'background 150ms ease',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: active ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%',
        background: '#000',
        transition: 'left 150ms ease',
      }} />
    </span>
  </button>
);

const ProgressDots: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
    {Array.from({ length: total }, (_, i) => {
      const done = i + 1 < current;
      const active = i + 1 === current;
      return (
        <span key={i} style={{
          height: 4,
          flex: active ? 1.5 : 1,
          maxWidth: 40,
          minWidth: 16,
          borderRadius: 999,
          background: done || active ? C.orange : C.border,
          opacity: done ? 0.55 : 1,
          transition: 'all 200ms ease',
        }} />
      );
    })}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const heroOuterStyle: React.CSSProperties = {
  position: 'relative',
  minHeight: '100vh',
  background: C.bg,
  color: C.text,
  fontFamily: 'system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};

const heroBgImgStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  width: '100%', height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  filter: 'saturate(1.15) contrast(1.05)',
  zIndex: 0,
};

// Overlay allégé : image clairement visible, lisibilité du texte conservée
// via un gradient bas → haut plus marqué là où vit le texte (CTA bas).
const heroOverlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background:
    'linear-gradient(180deg, rgba(8,11,18,0.45) 0%, rgba(8,11,18,0.35) 40%, rgba(8,11,18,0.85) 100%)',
  zIndex: 1,
};

const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 12,
  padding: '16px 20px',
  width: '100%',
  boxSizing: 'border-box',
};

// Le wordmark Toitures VB est ultra-large (viewBox 1080×100.57 ≈ 10.7:1).
// Si on fixe la hauteur, la largeur calculée déborde sur mobile.
// On contrôle donc en largeur (clamp) et on laisse la hauteur s'auto-ajuster.
// Sur 360px de large : 42vw = ~151px → hauteur ~14px (encore lisible).
const logoStyle: React.CSSProperties = {
  width: 'clamp(140px, 42vw, 200px)',
  height: 'auto',
  maxHeight: 32,
  flexShrink: 1,
  minWidth: 0,
  display: 'block',
};

const headerLinkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 13, color: C.text2, textDecoration: 'none',
  fontWeight: 600,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const heroMainStyle: React.CSSProperties = {
  position: 'relative', zIndex: 2,
  flex: 1,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center',
  // padding et marges clamp() : tassent sur petit écran, respirent sur grand
  padding: 'clamp(16px, 4vw, 32px) clamp(20px, 5vw, 24px) clamp(24px, 6vw, 48px)',
  maxWidth: 620,
  margin: '0 auto',
  width: '100%',
  boxSizing: 'border-box',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 14px',
  background: 'rgba(255,159,10,0.12)',
  border: `1px solid rgba(255,159,10,0.35)`,
  borderRadius: 999,
  color: C.orange,
  fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
  marginBottom: 'clamp(16px, 4vw, 28px)',
};

const badgeDotStyle: React.CSSProperties = {
  width: 8, height: 8, borderRadius: '50%',
  background: C.orange,
  boxShadow: `0 0 0 4px rgba(255,159,10,0.25)`,
};

const heroTitleStyle: React.CSSProperties = {
  fontSize: 'clamp(36px, 9vw, 56px)',
  fontWeight: 900,
  color: C.text,
  margin: 0,
  letterSpacing: -1.2,
  lineHeight: 1.0,
  textShadow: '0 2px 30px rgba(0,0,0,0.4)',
};

const heroSubtitleStyle: React.CSSProperties = {
  fontSize: 'clamp(14px, 3.6vw, 16px)',
  color: C.text2,
  margin: 'clamp(12px, 3vw, 20px) 0 clamp(16px, 4vw, 28px)',
  fontWeight: 500,
  letterSpacing: 0.2,
};

const priceStyle: React.CSSProperties = {
  fontSize: 'clamp(40px, 11vw, 64px)',
  fontWeight: 900,
  color: C.orange,
  lineHeight: 1,
  marginBottom: 'clamp(16px, 4vw, 28px)',
  letterSpacing: -1.5,
  textShadow: `0 0 40px rgba(255,159,10,0.35)`,
};

const priceUnitStyle: React.CSSProperties = {
  fontSize: '0.45em',
  color: C.text2,
  fontWeight: 700,
  marginLeft: 4,
};

const checklistStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 clamp(24px, 6vw, 40px) 0',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, auto)',
  gap: 'clamp(8px, 2.5vw, 12px) clamp(16px, 5vw, 24px)',
  justifyContent: 'center',
};

const checkItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 14, color: C.text, fontWeight: 600,
};

const checkIconStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: '50%',
  background: 'rgba(34,197,94,0.18)',
  color: C.success,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const heroCtaStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '18px 32px',
  minHeight: 60,
  width: '100%', maxWidth: 420,
  background: C.orange,
  color: '#000',
  border: 'none',
  borderRadius: 14,
  fontSize: 16, fontWeight: 800, letterSpacing: 0.4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: `0 8px 30px rgba(255,159,10,0.35)`,
  transition: 'box-shadow 150ms ease, transform 100ms ease',
};

const heroCtaSubStyle: React.CSSProperties = {
  fontSize: 13,
  color: C.text2,
  marginTop: 14,
  fontWeight: 500,
};

const heroFooterStyle: React.CSSProperties = {
  position: 'relative', zIndex: 2,
  textAlign: 'center',
  fontSize: 11,
  color: 'rgba(148,163,184,0.6)',
  padding: '16px 24px 24px',
  letterSpacing: 0.5,
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: C.bg,
  color: C.text,
  fontFamily: 'system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif',
  display: 'flex', flexDirection: 'column',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  maxWidth: 560,
  margin: '0 auto',
  padding: '12px 20px 32px',
  boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column',
};

const navRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  marginTop: 28,
};

const btnPrimaryStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '16px 24px',
  minHeight: 56,
  flex: 1,
  background: C.orange,
  color: '#000',
  border: 'none',
  borderRadius: 14,
  fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: `0 6px 22px rgba(255,159,10,0.3)`,
  transition: 'box-shadow 150ms ease, transform 100ms ease',
};

const btnPrimaryDisabledStyle: React.CSSProperties = {
  ...btnPrimaryStyle,
  background: '#374151',
  color: 'rgba(248,250,252,0.45)',
  cursor: 'not-allowed',
  boxShadow: 'none',
};

const btnSecondaryStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '14px 18px',
  minHeight: 52,
  background: 'transparent',
  color: C.text2,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const legalStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 11,
  color: 'rgba(148,163,184,0.55)',
  marginTop: 32,
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 15,
  minHeight: 52,
  width: '100%',
  background: C.inputBg,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const miniLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: C.text2,
  letterSpacing: 1,
  margin: '4px 0 10px 2px',
  textTransform: 'uppercase',
};

const cardListStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
};

const checkmarkBadgeStyle: React.CSSProperties = {
  width: 24, height: 24, borderRadius: '50%',
  background: C.orange,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};

