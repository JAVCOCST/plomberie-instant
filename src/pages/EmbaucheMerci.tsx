/**
 * EmbaucheMerci.tsx — Page de confirmation après soumission du formulaire
 * d'embauche. Route : /embauche/merci
 *
 * Pourquoi une page dédiée (au lieu d'un état inline) :
 *  - Google Ads (gtag) track la conversion via l'URL visitée
 *  - On peut configurer cette URL comme "page de remerciement" dans la campagne
 *  - Calcul du taux de conversion (sessions /embauche → sessions /embauche/merci)
 *
 * Reçoit { prenom, email, telephone } via location.state pour personnaliser.
 * Si l'utilisateur arrive sans state (refresh, partage de lien), message générique.
 *
 * Visuel aligné sur la palette de la landing /embauche (dark + orange #FF9F0A).
 */
import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle2, ArrowLeft, PhoneCall, Mail } from 'lucide-react';
import vbLogo from '@/assets/vb-logo-white.svg';

interface MerciState {
  prenom?: string;
  email?: string;
  telephone?: string;
}

const C = {
  bg: '#080B12',
  card: '#111827',
  border: '#243044',
  orange: '#FF9F0A',
  text: '#F8FAFC',
  text2: '#94A3B8',
  success: '#22C55E',
};

const trackConversion = () => {
  if (typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', 'conversion', {
      send_to: 'AW-CONVERSION_ID/EMBAUCHE_LABEL',
      event_category: 'application',
      event_label: 'thank_you_page_view',
    });
  }
};

export default function EmbaucheMerci() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as MerciState;

  useEffect(() => {
    trackConversion();
  }, []);

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* Wordmark ultra-large (ratio ~10.7:1) → on cap en largeur, jamais
            en hauteur, sinon le logo déborde sur mobile (360px). */}
        <img
          src={vbLogo}
          alt="Toitures VB"
          style={{
            width: 'clamp(140px, 50vw, 220px)',
            height: 'auto',
            maxHeight: 48,
            marginBottom: 28,
            display: 'block',
          }}
        />

        <div style={successIconWrapStyle}>
          <CheckCircle2 size={56} color={C.success} strokeWidth={2.2} />
        </div>

        <h1 style={titleStyle}>
          {state.prenom ? `Merci ${state.prenom} !` : 'C\'est envoyé !'}
        </h1>

        <p style={leadStyle}>
          Ta candidature est dans nos mains. On te contacte rapidement
          {state.telephone ? <> au <strong style={{ color: C.orange }}>{state.telephone}</strong></> : ''}
          {state.telephone && state.email ? ' ou ' : ' '}
          {state.email ? <>par courriel à <strong style={{ color: C.orange }}>{state.email}</strong></> : ''}
          .
        </p>

        <div style={contactBoxStyle}>
          <p style={contactBoxLabelStyle}>Une question entre-temps ?</p>
          <a href="tel:+14506758892" style={contactLinkStyle}>
            <PhoneCall size={16} /> 450-675-8892
          </a>
          <a href="mailto:info@toituresvb.ca" style={contactLinkStyle}>
            <Mail size={16} /> info@toituresvb.ca
          </a>
        </div>

        <button onClick={() => navigate('/embauche')} style={backBtnStyle} type="button">
          <ArrowLeft size={16} /> Nouvelle candidature
        </button>

        <p style={legalStyle}>TOITURES VB INC. · RBQ 5854-9353-01</p>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: C.bg,
  padding: '40px 20px',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  fontFamily: 'system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif',
};

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 540,
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 18, padding: '40px 28px',
  boxShadow: '0 12px 50px rgba(0,0,0,0.5)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  textAlign: 'center',
};

const successIconWrapStyle: React.CSSProperties = {
  width: 88, height: 88, borderRadius: '50%',
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid rgba(34,197,94,0.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  marginBottom: 24,
};

const titleStyle: React.CSSProperties = {
  fontSize: 30, fontWeight: 900, color: C.text,
  margin: '0 0 14px 0', letterSpacing: -0.5, lineHeight: 1.1,
};

const leadStyle: React.CSSProperties = {
  fontSize: 15, color: C.text2, lineHeight: 1.6,
  margin: '0 0 28px 0',
};

const contactBoxStyle: React.CSSProperties = {
  width: '100%',
  padding: '18px 20px',
  background: 'rgba(255,159,10,0.06)',
  border: '1px solid rgba(255,159,10,0.2)',
  borderRadius: 12,
  marginBottom: 28,
  display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
};

const contactBoxLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: C.orange,
  textTransform: 'uppercase', letterSpacing: 0.8,
  margin: 0,
};

const contactLinkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  color: C.text, textDecoration: 'none',
  fontSize: 14, fontWeight: 600,
};

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '12px 22px', minHeight: 48,
  background: 'transparent', color: C.text2,
  border: `1px solid ${C.border}`, borderRadius: 12,
  cursor: 'pointer', fontSize: 14, fontWeight: 600,
  fontFamily: 'inherit',
};

const legalStyle: React.CSSProperties = {
  marginTop: 28, fontSize: 11,
  color: 'rgba(148,163,184,0.55)',
  letterSpacing: 0.5,
};
