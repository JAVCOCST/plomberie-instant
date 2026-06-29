import React, { useState, useEffect, useMemo, useCallback, useRef, ChangeEvent } from 'react';
import { getSignedQuotePdfUrl } from '@/lib/pdf-storage';
import { Gem, MessageCircle, Pencil, ChevronDown, ChevronUp, Download, FileText, Info, RefreshCw, Wrench, Search, HardHat, MoreHorizontal, Layers, Home, TrendingUp, Palette, Package, MessageSquare, Loader2, Upload, X, User, Mail, ClipboardList } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFormContext } from '../../../context/FormContext';
import {
  COMPLEXITY_FACTORS, SLOPE_FACTORS, computeEstimation, sqmToSqft,
  ComplexityLevel, SlopeLevel, CoverageType, AreaUnit, ContactPreference, Product,
  coverageToCategory, WorkType,
} from '../../../types/roofing';
import {
  computeDynastyQuote, DynastyQuote, VisionResult, FALLBACK_VISION,
  mapSlopeToCategory, mapRoofType, RoofType, SlopeCategory,
} from '../../../lib/dynasty-calculator';
import { buildPdfDisplayBase, buildPdfStorageObjectPaths } from '../../../lib/pdf-storage';
import { fetchPricingMatrix, computeMatrixEstimateSync, type PricingRow, type MatrixEstimate } from '../../../lib/pricing-matrix';
import { supabase } from '../../../integrations/supabase/client';
import { generateMaterialsPdf, generateQuotePdf, generateMergedPdfBase64, generateQuotePdfBase64, fetchSatelliteDataUrl, compositeMapWithPolygons, type BuildingData } from '../../../lib/pdf-generators';
import type { PolygonAdjustments } from './BuildingReadOnlyMap';
import s from './Immersive.module.css';
import vbLogo from '../../../assets/vb-logo-white.svg';
import StepCoverageImmersive from './StepCoverageImmersive';
import Globe from './Globe';
import IsometricHouse from './IsometricHouse';
import AdvisorBubble from './AdvisorBubble';
import AdvisorAnalysis from './AdvisorAnalysis';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import BuildingConfirmation from './BuildingConfirmation';
import RoofPreview from './RoofPreview';
import SlopeAnalysis from './SlopeAnalysis';
import slopeNoneIcon from '../../../assets/slope-icons/slope-none.svg';
import slopeLightIcon from '../../../assets/slope-icons/slope-light-new.svg';
import slopeModerateIcon from '../../../assets/slope-icons/slope-light.svg';
import slopeAbrupteIcon from '../../../assets/slope-icons/slope-moderate.svg';
import slopeSteepIcon from '../../../assets/slope-icons/slope-steep.svg';
import AdvisorChat from './AdvisorChat';
import ProgressDrawer from './ProgressDrawer';
import RepairDetailsChat from './RepairDetailsChat';
import '../../../styles/progress-drawer.css';
import '../../../styles/repair-chat.css';
import { playWhoosh, unlockAudioFeedback } from '../../../lib/audioFeedback';

/* ── Slope pitch labels ── */
const SLOPE_PITCH: Record<string, string> = {
  'flat': 'PLAT 0/12–2/12',
  '4-7': 'FAIBLE 4/12-5/12',
  '7-9': 'MOY 6/12-7/12',
  '9-12': 'ELEVEE 8/12-9/12',
  '12+': 'TRES ELEVEE 10/12-12/12',
};

/* ── Coverage type labels ── */
const COVERAGE_FR: Record<string, string> = {
  shingle_2pans: 'Bardeaux – 2 versants',
  shingle_4pans: 'Bardeaux – 4 versants',
  shingle_4pans_plus: 'Bardeaux – 4 versants complexe',
  membrane_elastomere: 'Membrane élastomère',
  membrane_gravier: 'Membrane gravier',
  tole_2pans: 'Tôle – 2 versants',
  tole_4pans: 'Tôle – 4 versants',
  tole_4pans_plus: 'Tôle – 4 versants complexe',
};

const PROGRESS_MAP = [0, 20, 45, 75, 100];

/* ── Micro feedback messages ── */
const MICRO_MSGS = [
  'Scan du projet en cours…',
  'Optimisation détectée…',
  'Paramètres calibrés…',
  'Estimation en préparation…',
  'Analyse en cours…',
  'Données intégrées…',
  'Configuration optimale…',
];

/* ── Brand logos ── */
import logoIko from '../../../assets/logo-iko.png';
import logoBp from '../../../assets/logo-bp.png';
import logoSoprema from '../../../assets/logo-soprema.png';

/* ── Color swatch images (IKO Dynasty) ── */
import swAtlanticBlue from '../../../assets/dynasty-colors/atlantic-blue.jpg';
import swGlacier from '../../../assets/dynasty-colors/glacier.jpg';
import swGraniteBlack from '../../../assets/dynasty-colors/granite-black.jpg';
import swShadowBrown from '../../../assets/dynasty-colors/shadow-brown.jpg';
import swSummitGrey from '../../../assets/dynasty-colors/summit-grey.jpg';
import swCornerstoneWeatherwood from '../../../assets/dynasty-colors/cornerstone-weatherwood.jpg';
import swBiscayne from '../../../assets/dynasty-colors/biscayne.jpg';
import swMonacoRed from '../../../assets/dynasty-colors/monaco-red.jpg';
import swFrostoneGrey from '../../../assets/dynasty-colors/frostone-grey.jpg';
import swEmeraldGreen from '../../../assets/dynasty-colors/emerald-green.jpg';
import swDriftshake from '../../../assets/dynasty-colors/driftshake.jpg';
import swBrownstone from '../../../assets/dynasty-colors/brownstone.jpg';

import swOldeStyleWeatherwood from '../../../assets/dynasty-colors/olde-style-weatherwood.jpg';
import swGraphiteBlack from '../../../assets/dynasty-colors/graphite-black.jpg';
import swMatteBlack from '../../../assets/dynasty-colors/matte-black.jpg';
import swSentinelSlate from '../../../assets/dynasty-colors/sentinel-slate.jpg';

/* ── Color swatch images (IKO Cambridge) ── */
import swCambDualBlack from '../../../assets/cambridge-colors/dual-black.jpg';
import swCambWeatherwood from '../../../assets/cambridge-colors/weatherwood.jpg';
import swCambCharcoalGrey from '../../../assets/cambridge-colors/charcoal-grey.jpg';
import swCambDriftwood from '../../../assets/cambridge-colors/driftwood.jpg';
import swCambDualGrey from '../../../assets/cambridge-colors/dual-grey.jpg';
import swCambDualBrown from '../../../assets/cambridge-colors/dual-brown.jpg';
import swCambEarthtoneCedar from '../../../assets/cambridge-colors/earthtone-cedar.jpg';
import swCambHarvardSlate from '../../../assets/cambridge-colors/harvard-slate.jpg';

/* ── Color swatch images (IKO Royal Estate) ── */
import swREHarvestSlate from '../../../assets/royal-estate-colors/harvest-slate.jpg';
import swREMountainSlate from '../../../assets/royal-estate-colors/mountain-slate.jpg';
import swREShadowSlate from '../../../assets/royal-estate-colors/shadow-slate.jpg';
import swRETaupeSlate from '../../../assets/royal-estate-colors/taupe-slate.jpg';

/* ── Color swatch images (BP Signature) ── */
import swSigArabica from '../../../assets/bp-signature-colors/arabica.jpg';
import swSigMesquite from '../../../assets/bp-signature-colors/mesquite.jpg';
import swSigCumin from '../../../assets/bp-signature-colors/cumin.jpg';
import swSigFjord from '../../../assets/bp-signature-colors/fjord.jpg';
import swSigCriollo from '../../../assets/bp-signature-colors/criollo.jpg';
import swSigDublin from '../../../assets/bp-signature-colors/dublin.jpg';
import swSigCortina from '../../../assets/bp-signature-colors/cortina.jpg';
import swSigMuskoka from '../../../assets/bp-signature-colors/muskoka.jpg';
import swSigNewport from '../../../assets/bp-signature-colors/newport.jpg';
import swSigQuinoa from '../../../assets/bp-signature-colors/quinoa.jpg';
import swSigSoho from '../../../assets/bp-signature-colors/soho.jpg';
import swSigToscana from '../../../assets/bp-signature-colors/toscana.jpg';

/* ── Color swatch images (BP Mystique) ── */
import swMysGrisArdoise from '../../../assets/bp-mystique-colors/gris-ardoise.png';
import swMysCedreRustique from '../../../assets/bp-mystique-colors/cedre-rustique.png';
import swMysBrunClassique from '../../../assets/bp-mystique-colors/brun-classique.png';
import swMysBoisChampetre from '../../../assets/bp-mystique-colors/bois-champetre.png';
import swMysArdoiseAntique from '../../../assets/bp-mystique-colors/ardoise-antique.png';
import swMysBrun2tons from '../../../assets/bp-mystique-colors/brun-2tons.png';
import swMysNoir2tons from '../../../assets/bp-mystique-colors/noir-2tons.png';
import swMysBrumeMatinale from '../../../assets/bp-mystique-colors/brume-matinale.jpg';
import swMysSangria from '../../../assets/bp-mystique-colors/sangria.jpg';

/* ── Color swatch images (BP Vangard) ── */
import swVanNoirCeleste from '../../../assets/bp-vangard-colors/noir-celeste.png';
import swVanGrisArgente from '../../../assets/bp-vangard-colors/gris-argente.png';
import swVanGrisLunaire from '../../../assets/bp-vangard-colors/gris-lunaire.png';
import swVanGalet from '../../../assets/bp-vangard-colors/galet.png';
import swVanBrunAutomnal from '../../../assets/bp-vangard-colors/brun-automnal.png';

/* ── Color swatch images (BP Dakota) ── */
import swDakGrisArdoise from '../../../assets/bp-dakota-colors/gris-ardoise.png';
import swDakBrun2tons from '../../../assets/bp-dakota-colors/brun-2tons.png';
import swDakNoir2tons from '../../../assets/bp-dakota-colors/noir-2tons.png';

/* ── Color swatch images (Membrane SBS) ── */
import swMembraneNoir from '../../../assets/membrane-colors/noir.jpg';
import swMembraneBlanc from '../../../assets/membrane-colors/blanc.jpg';
import swMembraneGris from '../../../assets/membrane-colors/gris.jpg';

const BRAND_LOGO: Record<string, string> = { IKO: logoIko, BP: logoBp, Soprema: logoSoprema };

/* ── Color map (fallback flat colors) ── */
const COLOR_MAP: Record<string, string> = {
  Noir: '#1a1a1a', Brun: '#6b4226', 'Brun foncé': '#3e2117',
  Gris: '#8c8c8c', 'Gris perle': '#b8b8b8', Charbon: '#36454f',
  Ardoise: '#5a5a5a', Blanc: '#f0f0f0', Automne: '#8B4513',
};

/* ── French color name translations ── */
const COLOR_FR: Record<string, string> = {
  'Granite Black': 'Noir granit', 'Shadow Brown': 'Brun ombre', 'Summit Grey': 'Gris sommet',
  'Atlantic Blue': 'Bleu atlantique', 'Glacier': 'Glacier', 'Cornerstone Weatherwood': 'Bois vieilli',
  'Biscayne': 'Biscayne', 'Monaco Red': 'Rouge Monaco', 'Frostone Grey': 'Gris givré',
  'Emerald Green': 'Vert émeraude', 'Driftshake': 'Bois flotté', 'Brownstone': 'Pierre brune',
  'Olde Style Weatherwood': 'Bois ancien',
  'Dual Black': 'Noir double', 'Weatherwood': 'Bois vieilli', 'Charcoal Grey': 'Gris charbon',
  'Driftwood': 'Bois flotté', 'Dual Grey': 'Gris double', 'Dual Brown': 'Brun double',
  'Earthtone Cedar': 'Cèdre naturel', 'Harvard Slate': 'Ardoise Harvard',
  'Graphite Black': 'Noir graphite', 'Matte Black': 'Noir mat', 'Sentinel Slate': 'Ardoise sentinelle',
  'Harvest Slate': 'Ardoise récolte', 'Mountain Slate': 'Ardoise montagne',
  'Shadow Slate': 'Ardoise ombre', 'Taupe Slate': 'Ardoise taupe',
};
const frColor = (c: string) => COLOR_FR[c] || c;

/* ── Per-product swatch maps ── */
const PRODUCT_SWATCH_MAP: Record<string, Record<string, string>> = {
  Cambridge: {
    'Dual Black': swCambDualBlack, 'Weatherwood': swCambWeatherwood,
    'Charcoal Grey': swCambCharcoalGrey, 'Driftwood': swCambDriftwood,
    'Dual Grey': swCambDualGrey, 'Dual Brown': swCambDualBrown,
    'Earthtone Cedar': swCambEarthtoneCedar, 'Harvard Slate': swCambHarvardSlate,
  },
  Dynasty: {
    'Atlantic Blue': swAtlanticBlue, 'Glacier': swGlacier, 'Granite Black': swGraniteBlack,
    'Graphite Black': swGraphiteBlack, 'Matte Black': swMatteBlack,
    'Shadow Brown': swShadowBrown, 'Summit Grey': swSummitGrey, 'Cornerstone Weatherwood': swCornerstoneWeatherwood,
    'Biscayne': swBiscayne, 'Monaco Red': swMonacoRed, 'Frostone Grey': swFrostoneGrey,
    'Emerald Green': swEmeraldGreen, 'Driftshake': swDriftshake, 'Brownstone': swBrownstone,
    'Sentinel Slate': swSentinelSlate, 'Olde Style Weatherwood': swOldeStyleWeatherwood,
  },
  Nordic: {
    'Granite Black': swGraniteBlack, 'Shadow Brown': swShadowBrown,
    'Summit Grey': swSummitGrey, 'Glacier': swGlacier,
    'Driftshake': swDriftshake, 'Olde Style Weatherwood': swOldeStyleWeatherwood,
    'Brownstone': swBrownstone, 'Cornerstone Weatherwood': swCornerstoneWeatherwood,
    'Frostone Grey': swFrostoneGrey,
  },
  'Royal Estate': {
    'Harvest Slate': swREHarvestSlate, 'Mountain Slate': swREMountainSlate,
    'Shadow Slate': swREShadowSlate, 'Taupe Slate': swRETaupeSlate,
  },
  Signature: {
    'Arabica': swSigArabica, 'Mesquite': swSigMesquite, 'Cumin': swSigCumin, 'Fjord': swSigFjord,
    'Criollo': swSigCriollo, 'Dublin': swSigDublin, 'Cortina': swSigCortina, 'Muskoka': swSigMuskoka,
    'Newport': swSigNewport, 'Quinoa': swSigQuinoa, 'Soho': swSigSoho, 'Toscana': swSigToscana,
  },
  Mystique: {
    'Gris Ardoise': swMysGrisArdoise, 'Cèdre Rustique': swMysCedreRustique,
    'Brun Classique': swMysBrunClassique, 'Bois Champêtre': swMysBoisChampetre,
    'Ardoise Antique': swMysArdoiseAntique, 'Brun 2 tons': swMysBrun2tons,
    'Noir 2 tons': swMysNoir2tons, 'Brume Matinale': swMysBrumeMatinale, 'Sangria': swMysSangria,
  },
  Vangard: {
    'Noir céleste': swVanNoirCeleste, 'Gris argenté': swVanGrisArgente,
    'Gris lunaire': swVanGrisLunaire, 'Galet': swVanGalet, 'Brun automnal': swVanBrunAutomnal,
  },
  Dakota: {
    'Gris ardoise': swDakGrisArdoise, 'Brun 2 tons': swDakBrun2tons, 'Noir 2 tons': swDakNoir2tons,
  },
  'ArmourPlan SBS': {
    'Noir': swMembraneNoir, 'Blanc': swMembraneBlanc, 'Gris': swMembraneGris,
  },
  Soprafix: {
    'Noir': swMembraneNoir, 'Blanc': swMembraneBlanc, 'Gris': swMembraneGris,
  },
  Colphène: {
    'Noir': swMembraneNoir, 'Blanc': swMembraneBlanc,
  },
  Elastophène: {
    'Noir': swMembraneNoir, 'Blanc': swMembraneBlanc, 'Gris ardoise': swMembraneGris,
  },
};

/* ── Product info for tooltip ── */
const PRODUCT_INFO: Record<string, { tier: string; desc: string }> = {
  Cambridge:    { tier: 'Architectural',  desc: 'Bardeau architectural classique' },
  Dynasty:      { tier: 'Performance',    desc: 'Technologie ArmourZone, résistance aux impacts' },
  Nordic:       { tier: 'Performance',    desc: 'Protection haute performance' },
  'Royal Estate': { tier: 'Designer',     desc: 'Look premium d\'ardoise naturelle' },
  Mystique:     { tier: 'Stratifié',      desc: 'Double couche abordable, garantie à vie' },
  Signature:    { tier: 'Premium',        desc: 'Design, performance et personnalité' },
  Vangard:      { tier: 'Résistant IR',   desc: 'Résistance d\'impact Classe 4 (UL2218)' },
  Dakota:       { tier: '3 pattes',       desc: 'Classique, prix accessible' },
};

/* ── Mock products ── */
const MOCK_PRODUCTS: Product[] = [
  { id: '1', category: 'shingle', name: 'Cambridge', brand: 'IKO', price_per_sqft: 4.50, colors: ['Dual Black', 'Weatherwood', 'Charcoal Grey', 'Driftwood', 'Dual Grey', 'Dual Brown', 'Earthtone Cedar', 'Harvard Slate'] },
  { id: '2', category: 'shingle', name: 'Dynasty', brand: 'IKO', price_per_sqft: 5.75, colors: ['Granite Black', 'Graphite Black', 'Matte Black', 'Shadow Brown', 'Summit Grey', 'Atlantic Blue', 'Glacier', 'Cornerstone Weatherwood', 'Biscayne', 'Monaco Red', 'Frostone Grey', 'Emerald Green', 'Driftshake', 'Brownstone', 'Sentinel Slate', 'Olde Style Weatherwood'] },
  { id: '6', category: 'shingle', name: 'Royal Estate', brand: 'IKO', price_per_sqft: 6.25, colors: ['Harvest Slate', 'Mountain Slate', 'Shadow Slate', 'Taupe Slate'] },
  { id: '7', category: 'shingle', name: 'Nordic', brand: 'IKO', price_per_sqft: 5.25, colors: ['Granite Black', 'Shadow Brown', 'Summit Grey', 'Glacier', 'Driftshake', 'Olde Style Weatherwood', 'Brownstone', 'Cornerstone Weatherwood', 'Frostone Grey'] },
  { id: '3', category: 'shingle', name: 'Mystique', brand: 'BP', price_per_sqft: 4.75, colors: ['Gris Ardoise', 'Cèdre Rustique', 'Brun Classique', 'Bois Champêtre', 'Ardoise Antique', 'Brun 2 tons', 'Noir 2 tons', 'Brume Matinale', 'Sangria'] },
  { id: '10', category: 'shingle', name: 'Signature', brand: 'BP', price_per_sqft: 6.00, colors: ['Arabica', 'Mesquite', 'Cumin', 'Fjord', 'Criollo', 'Dublin', 'Cortina', 'Muskoka', 'Newport', 'Quinoa', 'Soho', 'Toscana'] },
  { id: '11', category: 'shingle', name: 'Vangard', brand: 'BP', price_per_sqft: 5.50, colors: ['Noir céleste', 'Gris argenté', 'Gris lunaire', 'Galet', 'Brun automnal'] },
  { id: '12', category: 'shingle', name: 'Dakota', brand: 'BP', price_per_sqft: 3.75, colors: ['Gris ardoise', 'Brun 2 tons', 'Noir 2 tons'] },
  { id: '4', category: 'sbs', name: 'ArmourPlan SBS', brand: 'IKO', price_per_sqft: 7.00, colors: ['Noir', 'Blanc', 'Gris'] },
  { id: '5', category: 'sbs', name: 'Soprafix', brand: 'Soprema', price_per_sqft: 7.50, colors: ['Noir', 'Blanc', 'Gris'] },
  { id: '13', category: 'sbs', name: 'Colphène', brand: 'Soprema', price_per_sqft: 8.25, colors: ['Noir', 'Blanc'] },
  { id: '14', category: 'sbs', name: 'Elastophène', brand: 'Soprema', price_per_sqft: 8.75, colors: ['Noir', 'Blanc', 'Gris ardoise'] },
];

/* ── Transition variants ── */
const pageVariants = {
  initial: { opacity: 0, scale: 0.96, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: -10 },
};
const pageTrans = { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] as const };

/* ── localStorage helpers ── */
const LS_KEY = 'imm_roofing_data';
const LS_STEP_KEY = 'imm_roofing_step';

function loadSaved() {
  try {
    const d = localStorage.getItem(LS_KEY);
    const s = localStorage.getItem(LS_STEP_KEY);
    return { data: d ? JSON.parse(d) : null, step: s ? parseInt(s, 10) : 0 };
  } catch { return { data: null, step: 0 }; }
}

/* ── Editable result row ── */
const ResultRow: React.FC<{ label: string; value: string; onEdit?: () => void; last?: boolean }> = ({ label, value, onEdit, last }) => (
  <div className={s.resultRow} style={last ? { borderBottom: 'none' } : undefined}>
    <span className={s.resultLabel}>{label}</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flex: 1, minWidth: 0 }}>
      <span className={s.resultValue}>{value}</span>
      {onEdit && (
        <button onClick={onEdit} className={s.editBtn} aria-label={`Modifier ${label}`}>
          <Pencil size={14} />
        </button>
      )}
    </span>
  </div>
);

const STEP_LABELS = ['Adresse', 'Travaux', 'Bâtiment', 'Analyse IA', 'Client'];

/* Work types that skip building + AI analysis (no GPS visibility) */
const SKIP_BUILDING_WORK_TYPES: WorkType[] = ['inspection', 'nouvelle_construction', 'autre'];

/* ── Work type options ── */
const WORK_TYPE_OPTIONS: { val: WorkType; label: string; icon: React.ReactNode }[] = [
  { val: 'remplacement', label: 'Remplacement couverture existante', icon: <RefreshCw size={20} /> },
  { val: 'reparations', label: 'Réparations mineures', icon: <Wrench size={20} /> },
  { val: 'inspection', label: 'Inspection', icon: <Search size={20} /> },
  { val: 'nouvelle_construction', label: 'Nouvelle construction', icon: <HardHat size={20} /> },
  { val: 'autre', label: 'Autre', icon: <MoreHorizontal size={20} /> },
];

/* ── Contact footer component ── */
const VBContactFooter: React.FC<{
  onSmsHandoff?: () => void;
  smsLoading?: boolean;
  showSms?: boolean;
  smsGlow?: boolean;
}> = ({ onSmsHandoff, smsLoading, showSms, smsGlow }) => (
  <div style={{
    marginTop: 'auto',
    padding: '16px 20px',
    textAlign: 'center',
    fontSize: 12,
    color: 'hsla(220, 15%, 75%, 0.8)',
    lineHeight: 1.6,
  }}>
    <p style={{ margin: '0 0 8px' }}>
      Toute autre demande non disponible au présent formulaire ?
    </p>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
      <a
        href="mailto:info@toituresvb.ca"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 18px', borderRadius: 10,
          background: 'hsla(260, 70%, 62%, 0.12)',
          border: '1px solid hsla(260, 70%, 62%, 0.3)',
          color: 'hsla(260, 80%, 78%, 1)',
          fontSize: 13, fontWeight: 500, textDecoration: 'none',
          transition: 'all 0.2s ease',
        }}
      >
        ✉ info@toituresvb.ca
      </a>
      {showSms && (
        <button
          onClick={onSmsHandoff}
          disabled={smsLoading}
          className={smsGlow ? 'sms-glow-pulse' : ''}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 10,
            background: smsGlow ? 'hsla(260, 70%, 62%, 0.35)' : 'hsla(260, 70%, 62%, 0.18)',
            border: `1px solid ${smsGlow ? 'hsla(260, 70%, 62%, 0.8)' : 'hsla(260, 70%, 62%, 0.4)'}`,
            color: 'hsla(260, 80%, 78%, 1)',
            fontSize: 13, fontWeight: 500,
            cursor: smsLoading ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
          }}
          aria-label="Continuer par texto"
        >
          {smsLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <MessageSquare size={16} />
          )}
          Texto
        </button>
      )}
    </div>
  </div>
);

const ImmersiveWizard: React.FC = () => {
  const { data, updateData, resetForm, step, setStep } = useFormContext();
  const [phase, setPhase] = useState<'intro' | 'form' | 'computing' | 'result'>('intro');
  const [introName, setIntroName] = useState('');
  const [introPhone, setIntroPhone] = useState('');
  const [introStep, setIntroStep] = useState<'cta' | 'name' | 'phone'>('cta');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [microMsg, setMicroMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [advisorDone, setAdvisorDone] = useState(false);
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [radarPulse, setRadarPulse] = useState(false);
  const [showProductInfo, setShowProductInfo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const [addressLoaded, setAddressLoaded] = useState(false);
  const [addressText, setAddressText] = useState(data.address?.formatted_address || '');
  const confirmedAddr = useRef(data.address?.formatted_address || '');
  const [addressInputKey, setAddressInputKey] = useState(0);
  const [globeSearchQuery, setGlobeSearchQuery] = useState('');
  const [globeTargetLatLng, setGlobeTargetLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedCoverageType, setDetectedCoverageType] = useState<CoverageType | null>(null);
  const [detectedSlopeLevel, setDetectedSlopeLevel] = useState<SlopeLevel | null>(null);
  const [buildingGeoJson, setBuildingGeoJson] = useState<string | null>(null);
  const [buildingSuperficie, setBuildingSuperficie] = useState<number | null>(null);
  const [buildingPerimetre, setBuildingPerimetre] = useState<number | null>(null);
  const [buildingLotGeojson, setBuildingLotGeojson] = useState<string | null>(null);
  const [buildingNoLot, setBuildingNoLot] = useState<string | null>(null);
  const [buildingLargeur, setBuildingLargeur] = useState<number | null>(null);
  const [buildingProfondeur, setBuildingProfondeur] = useState<number | null>(null);
  const [satDataUrl, setSatDataUrl] = useState<string | null>(null);
  const [polygonAdjustments, setPolygonAdjustments] = useState<PolygonAdjustments>({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0 });
  const satCenterRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const submissionSeqRef = useRef<number>(0);
  const [notCovered, setNotCovered] = useState(false);
  const [smsHandoffLoading, setSmsHandoffLoading] = useState(false);
  const [inspectionChatOpen, setInspectionChatOpen] = useState(false);
  const [ncChatOpen, setNcChatOpen] = useState(false);
  const [smsGlow, setSmsGlow] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editFromResult, setEditFromResult] = useState<number | null>(null);
  const [aiRoofType, setAiRoofType] = useState<RoofType>('4pans');
  const [aiSlopeCategory, setAiSlopeCategory] = useState<SlopeCategory>('moderee');
  const [aiConfidence, setAiConfidence] = useState<number>(0.5);
  const isAddressStep = phase === 'form' && step === 0;
  const [editingAiField, setEditingAiField] = useState<string | null>(null);
  const autoSetDoneRef = useRef(false);
  // Sequential AI reveal: tracks which fields have been revealed (0=none, 1=coverage, 2=slope, 3=product, 4=color)
  const [aiRevealCount, setAiRevealCount] = useState(0);
  const aiRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiAnalysisDone, setAiAnalysisDone] = useState(false);
  // Multi-phase advisor sub-phase for step 3
  type AdvisorSubPhase = 'idle' | 'slope_reasoning' | 'slope_card' | 'slope_fly' |
    'product_reasoning' | 'product_card' | 'product_fly' |
    'color_reasoning' | 'color_card' | 'color_fly' | 'done';
  const [advisorSubPhase, setAdvisorSubPhase] = useState<AdvisorSubPhase>('idle');

  // ── Form session tracking ──
  const formSessionIdRef = useRef<string | null>(null);
  const stepTimingsRef = useRef<Record<string, string>>({});
  const lastStepRef = useRef<number>(0);

  // Pricing matrix from Supabase
  const [pricingMatrix, setPricingMatrix] = useState<PricingRow[]>([]);
  useEffect(() => { fetchPricingMatrix().then(setPricingMatrix).catch(console.error); }, []);

  useEffect(() => {
    if (!formSessionIdRef.current) {
      formSessionIdRef.current = crypto.randomUUID();
    }
  }, []);

  // Track step enter time
  useEffect(() => {
    if (phase === 'form') {
      const key = `step_${step}_enter`;
      if (!stepTimingsRef.current[key]) {
        stepTimingsRef.current[key] = new Date().toISOString();
      }
      lastStepRef.current = Math.max(lastStepRef.current, step);
    }
  }, [step, phase]);

  // Track step leave time when step changes
  const prevStepRef = useRef<number>(0);
  useEffect(() => {
    if (phase === 'form' && prevStepRef.current !== step) {
      const leaveKey = `step_${prevStepRef.current}_leave`;
      stepTimingsRef.current[leaveKey] = new Date().toISOString();
      prevStepRef.current = step;
    }
  }, [step, phase]);

  // Track which plans have already been uploaded to avoid re-uploading
  const uploadedPlansRef = useRef<Set<string>>(new Set());

  // Upload construction plans to storage (fire-and-forget, tracks already-uploaded)
  const uploadConstructionPlansForSession = useCallback(async (plans: string[]): Promise<string[]> => {
    if (!formSessionIdRef.current || plans.length === 0) return [];
    const urls: string[] = [];
    for (let i = 0; i < plans.length; i++) {
      const dataUrl = plans[i];
      // Use a hash of the first 100 chars as a dedup key
      const dedupKey = dataUrl.slice(0, 100);
      if (uploadedPlansRef.current.has(dedupKey)) continue;
      try {
        const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
        const mime = mimeMatch?.[1] || 'application/octet-stream';
        const ext = mime === 'application/pdf' ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
        const raw = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(raw.length);
        for (let j = 0; j < raw.length; j++) arr[j] = raw.charCodeAt(j);
        const blob = new Blob([arr], { type: mime });
        const storagePath = `construction-plans/${formSessionIdRef.current}/${Date.now()}_plan_${i + 1}.${ext}`;
        const { error: upErr } = await supabase.storage.from('quote-pdfs').upload(storagePath, blob, { contentType: mime, upsert: true });
        if (!upErr) {
          const __signed = await getSignedQuotePdfUrl(storagePath);
          const urlData = { publicUrl: __signed || '' };
          if (urlData?.publicUrl) urls.push(urlData.publicUrl);
          uploadedPlansRef.current.add(dedupKey);
        }
      } catch (e) { console.warn('Session plan upload failed:', e); }
    }
    return urls;
  }, []);

  // Auto-save form session to DB (debounced)
  const saveSessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFormSession = useCallback(() => {
    if (!formSessionIdRef.current) return;
    if (saveSessionTimeoutRef.current) clearTimeout(saveSessionTimeoutRef.current);
    saveSessionTimeoutRef.current = setTimeout(async () => {
      try {
        // Build chat transcript from repairMessages if present
        let chatTranscript: string | null = null;
        if (data.repairMessages && data.repairMessages.length > 1) {
          chatTranscript = data.repairMessages
            .map((m: any) => `${m.role === 'user' ? '👤 Client' : '🤖 Marie-Ève'}: ${m.content}`)
            .join('\n\n');
        }

        // Upload construction plans in the background if any new ones
        let planUrls: string[] = [];
        if (data.constructionPlans && data.constructionPlans.length > 0) {
          planUrls = await uploadConstructionPlansForSession(data.constructionPlans);
        }

        // Merge new plan URLs with previously saved ones
        const existingUrls: string[] = (stepTimingsRef.current as any).construction_plan_urls
          ? JSON.parse((stepTimingsRef.current as any).construction_plan_urls)
          : [];
        const allPlanUrls = Array.from(new Set([...existingUrls, ...planUrls]));

        const timingsWithExtra = {
          ...stepTimingsRef.current,
          ...(chatTranscript ? { chat_transcript: chatTranscript } : {}),
          ...(data.workType ? { work_type: data.workType } : {}),
          ...(allPlanUrls.length > 0 ? { construction_plan_urls: JSON.stringify(allPlanUrls) } : {}),
          ...(data.projectDetails?.trim() ? { project_details: data.projectDetails.trim() } : {}),
        };

        // Update ref so subsequent saves include the URLs
        if (allPlanUrls.length > 0) {
          (stepTimingsRef.current as any).construction_plan_urls = JSON.stringify(allPlanUrls);
        }

        const sessionData = {
          session_id: formSessionIdRef.current!,
          first_name: data.client.firstName || null,
          last_name: data.client.lastName || null,
          email: data.client.email || null,
          phone: data.client.phone || null,
          formatted_address: data.address?.formatted_address || null,
          lat: data.address?.lat || null,
          lng: data.address?.lng || null,
          coverage_type: data.coverageType || null,
          slope: data.slope || null,
          product_name: data.product?.name || null,
          product_brand: data.product?.brand || null,
          color: data.color || null,
          last_step: lastStepRef.current,
          total_steps: 5,
          step_labels: STEP_LABELS,
          step_timings: timingsWithExtra,
          is_complete: false,
          user_agent: navigator.userAgent,
          page_url: window.location.href,
          updated_at: new Date().toISOString(),
        };

        await supabase.from('form_sessions').upsert(
          sessionData as any,
          { onConflict: 'session_id' }
        );
      } catch (e) {
        console.warn('Form session save failed:', e);
      }
    }, 1500);
  }, [data, uploadConstructionPlansForSession]);

  // Trigger save when form data or step changes
  useEffect(() => {
    if (phase === 'form') saveFormSession();
  }, [data, step, phase, saveFormSession]);

  // Persist form state to localStorage while in form phase
  useEffect(() => {
    if (phase === 'form') {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      localStorage.setItem(LS_STEP_KEY, String(step));
    }
  }, [data, step, phase]);

  // Auto-set slope + product defaults when AI detection arrives (step 3)
  useEffect(() => {
    if (step === 3 && detectedSlopeLevel && !data.slope) {
      updateData({ slope: detectedSlopeLevel });
    }
  }, [detectedSlopeLevel, step]);

  useEffect(() => {
    if (step === 3 && !autoSetDoneRef.current) {
      autoSetDoneRef.current = true;
      const isFlat = data.coverageType === 'membrane_elastomere' || data.coverageType === 'membrane_gravier';
      if (!data.product) {
        if (isFlat) {
          const sbsProducts = products.filter(p => p.category === 'sbs');
          const soprema = sbsProducts.find(p => p.brand === 'Soprema');
          const first = soprema || sbsProducts[0];
          if (first) updateData({ product: first, color: 'Noir' });
        } else {
          const dynasty = MOCK_PRODUCTS.find(p => p.name === 'Dynasty' && p.brand === 'IKO');
          if (dynasty) updateData({ product: dynasty, color: 'Granite Black' });
        }
      }
    }
  }, [step]);
  // SMS Handoff handler
  const [showDesktopSmsPopup, setShowDesktopSmsPopup] = useState(false);

  const handleSmsHandoff = useCallback(async () => {
    // Detect mobile via user agent + touch support
    const isMobileDevice = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || ('ontouchstart' in window && window.innerWidth < 768);

    if (!isMobileDevice) {
      setShowDesktopSmsPopup(true);
      return;
    }

    const phone = data.client.phone || introPhone;
    if (!phone) return;
    setSmsHandoffLoading(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/sms-handoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          clientName: `${data.client.firstName || introName} ${data.client.lastName || ''}`.trim(),
          clientPhone: phone,
          address: data.address?.formatted_address || addressText || null,
          messages: data.repairMessages || [],
          workType: data.workType || null,
          buildingType: (data as any).buildingType || null,
        }),
      });
      if (!resp.ok) throw new Error('Handoff failed');
      const result = await resp.json();
      const twilioNumber = result.twilio_number || '';
      const name = (data.client.firstName || introName || '').trim();
      const workLabel = data.workType === 'reparations' ? 'ma demande de réparation' : 'ma soumission de toiture';
      const defaultBody = `Bonjour, c'est ${name || 'moi'}. Je souhaite continuer ${workLabel} par texto.`;
      const body = encodeURIComponent(defaultBody);
      window.location.href = `sms:${twilioNumber}?body=${body}`;
    } catch (e) {
      console.error('SMS handoff error:', e);
    } finally {
      setSmsHandoffLoading(false);
    }
  }, [data, introName, introPhone, addressText]);

  // Load products
  useEffect(() => {
    fetch('/data/produits-toiture')
      .then(r => r.json())
      .then((d: Product[]) => setProducts(d))
      .catch(() => setProducts(MOCK_PRODUCTS));
  }, []);

  // Google Maps
  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    if ((window as any).google?.maps?.places) { setAddressLoaded(true); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onload = () => setAddressLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Fix mobile touch events on Google Places dropdown
  useEffect(() => {
    const fixMobileTouch = () => {
      const containers = document.querySelectorAll('.pac-container');
      containers.forEach((container) => {
        (container as HTMLElement).addEventListener('touchend', (e) => {
          e.stopImmediatePropagation();
        });
      });
    };
    const observer = new MutationObserver(() => fixMobileTouch());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!addressLoaded || step !== 0 || phase !== 'form' || !advisorDone) return;
    // Bump key to force React to remount a fresh input element
    setAddressInputKey(k => k + 1);
    // Clear previous autocomplete
    autocompleteRef.current = null;
    // Delay to let the new input DOM element mount (AnimatePresence + React rerender)
    const timer = setTimeout(() => {
      if (!addressInputRef.current) return;
      const autocomplete = new (window as any).google.maps.places.Autocomplete(addressInputRef.current, {
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'place_id', 'geometry'],
      });
      autocompleteRef.current = autocomplete;
      autocomplete.addListener('place_changed', async () => {
        const place = autocomplete.getPlace();
        if (!place.formatted_address) return;

        // When the user types an address and validates with Enter (instead of
        // tapping a Places suggestion), Google can return a place WITHOUT a
        // geometry. The old code fell back to lat/lng = 0, which sent the
        // building RPC searching in the Atlantic → "non localisé" (≈40% of
        // 546 Trépanier submissions had NULL coords in prod). Resolve the real
        // coordinates with the Geocoding API in that case.
        let lat = place.geometry?.location?.lat();
        let lng = place.geometry?.location?.lng();

        if (lat == null || lng == null) {
          try {
            const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
            const url = 'https://maps.googleapis.com/maps/api/geocode/json'
              + `?address=${encodeURIComponent(place.formatted_address)}`
              + `&key=${apiKey}&region=ca`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.status === 'OK' && json.results?.[0]?.geometry?.location) {
              lat = json.results[0].geometry.location.lat;
              lng = json.results[0].geometry.location.lng;
            }
          } catch (e) { console.warn('[wizard] geocoding fallback threw:', e); }
        }

        const finalLat = lat ?? 0;
        const finalLng = lng ?? 0;

        setAddressText(place.formatted_address);
        confirmedAddr.current = place.formatted_address;
        setGlobeTargetLatLng({ lat: finalLat, lng: finalLng });
        updateData({
          address: {
            formatted_address: place.formatted_address,
            place_id: place.place_id || '',
            lat: finalLat, lng: finalLng,
          },
        });
        // Close the mobile keyboard immediately so the address confirmation
        // and the 600ms transition are not hidden behind it.
        addressInputRef.current?.blur();
        setTimeout(() => goNext(0), 600);
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [addressLoaded, step, phase, advisorDone]); // eslint-disable-line

  // Use building superficie from DB (m² → sqft), fallback to manual input
  const areaSqft = buildingSuperficie
    ? sqmToSqft(buildingSuperficie)
    : (data.areaUnit === 'sqm' ? sqmToSqft(data.area) : data.area);

  // Derive complexity from coverage type if not explicitly set
  const effectiveComplexity: ComplexityLevel = data.complexity || (() => {
    const ct = data.coverageType || '';
    if (ct.includes('4pans_plus') || ct.includes('tole_4pans_plus')) return 'complexe';
    if (ct.includes('4pans') || ct.includes('tole_4pans')) return 'moyenne';
    return 'simple';
  })();

  // Matrix-based estimate from pricing_matrix table
  const matrixWorkType = data.workType === 'nouvelle_construction' ? 'nouvelle_couverture' : 'refection';
  const matrixEstimate = useMemo<MatrixEstimate | null>(() => {
    if (!pricingMatrix.length || !data.coverageType || !data.slope || areaSqft <= 0) return null;
    return computeMatrixEstimateSync(pricingMatrix, data.coverageType, data.slope, areaSqft, matrixWorkType as any);
  }, [pricingMatrix, data.coverageType, data.slope, areaSqft, matrixWorkType]);

  const estimation = useMemo(() => {
    if (!data.product || !data.slope || areaSqft <= 0) return null;
    return computeEstimation(
      areaSqft, data.product.price_per_sqft,
      COMPLEXITY_FACTORS[effectiveComplexity], SLOPE_FACTORS[data.slope]
    );
  }, [data.product, effectiveComplexity, data.slope, areaSqft]);

  // Dynasty quote (new detailed engine)
  const dynastyQuote = useMemo<DynastyQuote | null>(() => {
    if (areaSqft <= 0 || !buildingPerimetre) return null;
    const perimeterFt = buildingPerimetre * 3.28084;
    const vision: VisionResult = {
      slope_category: data.slope ? mapSlopeToCategory(data.slope) : aiSlopeCategory,
      roof_type: aiRoofType,
      confidence: aiConfidence,
      reasoning_short: '',
    };
    return computeDynastyQuote(areaSqft, perimeterFt, vision);
  }, [areaSqft, buildingPerimetre, data.slope, aiRoofType, aiSlopeCategory, aiConfidence]);

  const showMicro = useCallback((msg?: string) => {
    const m = msg || MICRO_MSGS[Math.floor(Math.random() * MICRO_MSGS.length)];
    setMicroMsg(m);
    setRadarPulse(true);
    setScanning(true);
    setTimeout(() => setRadarPulse(false), 400);
    setTimeout(() => { setMicroMsg(null); setScanning(false); }, 1200);
  }, []);

  useEffect(() => {
    if (phase !== 'intro') return;
    let played = false;
    const playIntroWhoosh = async () => {
      if (played) return;
      const didPlay = await playWhoosh();
      played = didPlay;
    };
    const introTimer = window.setTimeout(playIntroWhoosh, 650);
    const unlock = () => {
      unlockAudioFeedback().then(() => window.setTimeout(playIntroWhoosh, 120));
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { once: true, capture: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.clearTimeout(introTimer);
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [phase]);

  const returnToResult = useCallback(() => {
    setEditFromResult(null);
    setPhase('computing');
    setTimeout(() => setPhase('result'), 1200);
  }, []);

  const goNext = useCallback((fromStep?: number) => {
    const current = fromStep ?? step;
    // If we're editing from result, return to result after this step
    if (editFromResult !== null) {
      returnToResult();
      return;
    }
    showMicro();
    // After work type (step 1), skip building + AI for types that don't need GPS
    if (current === 1 && data.workType && SKIP_BUILDING_WORK_TYPES.includes(data.workType)) {
      // All work types skip the date step → go straight to client info
      setTimeout(() => setStep(4), 350);
      return;
    }
    if (current === 3) {
      setTimeout(() => setStep(4), 350);
      return;
    }
    setTimeout(() => setStep(current + 1), 350);
  }, [step, setStep, showMicro, editFromResult, returnToResult, data.workType]);

  const goPrev = useCallback(() => {
    if (editFromResult !== null) {
      returnToResult();
      return;
    }
    if (step > 0) {
      // From client step, go back to work type (step 1) if building was skipped
      if (step === 4 && data.workType && SKIP_BUILDING_WORK_TYPES.includes(data.workType)) {
        setStep(1);
        return;
      }
      setStep(step - 1);
    }
  }, [step, setStep, editFromResult, returnToResult, data.workType]);

  const autoSelect = useCallback(<T,>(field: string, value: T, extra?: Record<string, any>) => {
    updateData({ [field]: value, ...extra });
    if (editFromResult !== null) {
      setTimeout(() => returnToResult(), 500);
    } else {
      setTimeout(() => goNext(), 500);
    }
  }, [updateData, goNext, editFromResult, returnToResult]);

  const progress = PROGRESS_MAP[step] ?? 0;

  const fmt = (n: number) =>
    n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

  // ── Submit ──
  const submit = async () => {
    console.log('🔵 SUBMIT CLICKED', { phase, submitting, client: data.client });
    
    if (submitting) {
      console.warn('Submit already in progress, ignoring');
      return;
    }
    
    // Validate required client info
    if (!data.client.firstName || !data.client.lastName || !data.client.email || !data.client.phone) {
      console.warn('Submit blocked: missing client info', { client: data.client });
      alert('Veuillez remplir vos informations client (prénom, nom, courriel, téléphone).');
      return;
    }
    setSubmitting(true);
    try {
      // Build dynasty breakdown for storage
      const dynastyBreakdownForDb = dynastyQuote ? {
        surface_sqft: dynastyQuote.surface_displayed,
        subtotal_base: dynastyQuote.subtotal_base,
        contingency: dynastyQuote.contingency,
        subtotal_displayed: dynastyQuote.subtotal_displayed,
        tps: dynastyQuote.tps,
        tvq: dynastyQuote.tvq,
        total_final: dynastyQuote.total_final,
        slope_category: dynastyQuote.slope_category,
        slope_factor: dynastyQuote.slope_factor,
        roof_type: dynastyQuote.roof_type,
        perimeter_ft: dynastyQuote.perimeter_ft,
        area_sqft: dynastyQuote.area_sqft,
        surface_corrected: dynastyQuote.surface_corrected,
        confidence: dynastyQuote.confidence,
        low_confidence: dynastyQuote.low_confidence,
        lines: dynastyQuote.lines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          rate: l.rate,
          total_displayed: l.total_displayed,
        })),
      } : null;

      // Record final step leave time
      stepTimingsRef.current[`step_${step}_leave`] = new Date().toISOString();

      const { data: insertedRow, error } = await supabase.from('soumissions').insert({
        first_name: data.client.firstName, last_name: data.client.lastName,
        email: data.client.email, phone: data.client.phone,
        formatted_address: data.address?.formatted_address ?? null,
        place_id: data.address?.place_id ?? null,
        lat: data.address?.lat ?? null, lng: data.address?.lng ?? null,
        coverage_type: data.coverageType, complexity: effectiveComplexity,
        work_type: data.workType,
        building_type: (data as any).buildingType ?? null,
        slope: data.slope, area_sqft: areaSqft, area_input: data.area,
        area_unit: data.areaUnit, product_id: data.product?.id ?? null,
        product_name: data.product?.name ?? null, product_brand: data.product?.brand ?? null,
        color: data.color, price_per_sqft: data.product?.price_per_sqft ?? null,
        subtotal: matrixEstimate ? (matrixEstimate.low_estimate + matrixEstimate.high_estimate) / 2 : dynastyQuote?.subtotal_displayed ?? estimation?.subtotal ?? null,
        mobilisation: estimation?.mobilisation ?? null,
        low_estimate: matrixEstimate?.low_estimate ?? (dynastyQuote ? dynastyQuote.total_final * 0.9 : estimation?.low_estimate ?? null),
        high_estimate: matrixEstimate?.high_estimate ?? dynastyQuote?.total_final ?? estimation?.high_estimate ?? null,
        complexity_factor: estimation?.factors?.complexity || COMPLEXITY_FACTORS[effectiveComplexity],
        slope_factor: estimation?.factors?.slope || SLOPE_FACTORS[data.slope || '4-7'],
        user_agent: navigator.userAgent, page_url: window.location.href,
        utm: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
        contact_preference: data.contactPreference,
        dynasty_breakdown: dynastyBreakdownForDb,
        form_session_id: formSessionIdRef.current,
      } as any).select('id').single();
      if (error) throw error;

      const soumissionId = insertedRow?.id;
      const referenceId = soumissionId ? `VB-${soumissionId.replace(/-/g, '').slice(0, 12).toUpperCase()}` : '';

      // Clean up and redirect to thank-you page
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_STEP_KEY);
      setSubmitting(false);

      // Fire email in background (browser continues JS until unload)
      const coverageLabel = COVERAGE_FR[data.coverageType || ''] || data.coverageType || '—';
      const slopeLabel = data.slope || '—';
      const totalFormatted = matrixEstimate
        ? `${fmt(matrixEstimate.low_estimate)} – ${fmt(matrixEstimate.high_estimate)}`
        : dynastyQuote ? fmt(dynastyQuote.total_final)
        : estimation ? fmt(estimation.subtotal ?? 0) : '—';
      const surfaceFormatted = areaSqft > 0 ? `${Math.round(areaSqft)} pi²` : '—';

      const emailPayload = {
        clientName: `${data.client.firstName} ${data.client.lastName}`,
        clientEmail: data.client.email,
        clientPhone: data.client.phone,
        address: data.address?.formatted_address || '—',
        product: data.product?.name || '—',
        productBrand: data.product?.brand || '',
        color: data.color || '—',
        referenceId,
        totalFormatted,
        surfaceFormatted,
        slopeLabel,
        coverageLabel,
        dynastyBreakdown: dynastyQuote ? {
          lines: dynastyQuote.lines,
          subtotal_displayed: dynastyQuote.subtotal_displayed,
          tps: dynastyQuote.tps,
          tvq: dynastyQuote.tvq,
          slope_factor: dynastyQuote.slope_factor,
        } : null,
        buildingInfo: {
          superficie: buildingSuperficie ? `${Math.round(buildingSuperficie)} m²` : null,
          perimetre: buildingPerimetre ? `${Math.round(buildingPerimetre)} m` : null,
          largeur: buildingLargeur ? `${buildingLargeur.toFixed(1)} m` : null,
          profondeur: buildingProfondeur ? `${buildingProfondeur.toFixed(1)} m` : null,
          noLot: buildingNoLot,
        },
      };

      // Send email with retries (fire-and-forget, page is already redirecting)
      const sendEmail = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const { error: emailErr } = await supabase.functions.invoke('send-quote-email', { body: emailPayload });
            if (!emailErr) { console.log('✅ Email sent'); return; }
            console.warn(`Email attempt ${i + 1} failed:`, emailErr);
          } catch (e) { console.warn(`Email attempt ${i + 1} error:`, e); }
          if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
        console.error('❌ Email failed after all retries');
        try {
          const failedEmails = JSON.parse(localStorage.getItem('vb_failed_emails') || '[]');
          failedEmails.push({ ...emailPayload, failedAt: new Date().toISOString() });
          localStorage.setItem('vb_failed_emails', JSON.stringify(failedEmails.slice(-10)));
        } catch {}
      };
      sendEmail();

      // Redirect to external thank-you page
      window.location.href = 'https://www.toituresvb.ca/soumission/merci';

      // Everything below runs in the background after redirect is initiated

      // Save a journey summary note for ALL submissions
      if (soumissionId) {
        const journeyLines: string[] = [];
        if (data.workType) journeyLines.push(`Type de travaux: ${data.workType}`);
        if (data.address?.formatted_address) journeyLines.push(`Adresse: ${data.address.formatted_address}`);
        if (data.coverageType) journeyLines.push(`Couverture: ${data.coverageType}`);
        if (data.slope) journeyLines.push(`Pente: ${data.slope}`);
        if (data.product) journeyLines.push(`Produit: ${data.product.brand} ${data.product.name}`);
        if (data.color) journeyLines.push(`Couleur: ${data.color}`);
        if (data.area) journeyLines.push(`Superficie: ${data.area} ${data.areaUnit}`);
        if (data.complexity) journeyLines.push(`Complexité: ${data.complexity}`);
        if (data.contactPreference) journeyLines.push(`Préférence contact: ${data.contactPreference}`);
        const timingEntries = Object.entries(stepTimingsRef.current || {});
        if (timingEntries.length > 0) {
          const stepDurations = timingEntries
            .filter(([k]) => k.endsWith('_enter'))
            .map(([k, v]) => {
              const leaveKey = k.replace('_enter', '_leave');
              const leave = (stepTimingsRef.current as any)?.[leaveKey];
              if (leave && v) {
                const dur = Math.round((new Date(leave as string).getTime() - new Date(v as string).getTime()) / 1000);
                return `  ${k.replace('_enter', '')}: ${dur}s`;
              }
              return null;
            }).filter(Boolean);
          if (stepDurations.length > 0) journeyLines.push(`\nTemps par étape:\n${stepDurations.join('\n')}`);
        }
        if (journeyLines.length > 0) {
          supabase.from('soumission_notes').insert({
            soumission_id: soumissionId,
            content: `📊 Résumé du parcours client:\n\n${journeyLines.join('\n')}`,
          } as any).then(() => {});
        }
      }

      // Save repair conversation as a note if applicable
      if (soumissionId && data.repairMessages && data.repairMessages.length > 1) {
        const summary = data.repairMessages
          .map((m: any) => `${m.role === 'user' ? '👤 Client' : '🤖 Marie-Ève'}: ${m.content}`)
          .join('\n\n');
        supabase.from('soumission_notes').insert({
          soumission_id: soumissionId,
          content: `📋 Conversation de réparation:\n\n${summary}`,
        } as any).then(() => {});
      }

      // Upload construction plans to Storage and save URLs as a note
      if (soumissionId && data.constructionPlans.length > 0) {
        const planUrls: string[] = [];
        for (let i = 0; i < data.constructionPlans.length; i++) {
          try {
            const dataUrl = data.constructionPlans[i];
            const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
            const mime = mimeMatch?.[1] || 'application/octet-stream';
            const ext = mime === 'application/pdf' ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
            const raw = atob(dataUrl.split(',')[1]);
            const arr = new Uint8Array(raw.length);
            for (let j = 0; j < raw.length; j++) arr[j] = raw.charCodeAt(j);
            const blob = new Blob([arr], { type: mime });
            const storagePath = `construction-plans/${soumissionId}/${Date.now()}_plan_${i + 1}.${ext}`;
            const { error: upErr } = await supabase.storage.from('quote-pdfs').upload(storagePath, blob, { contentType: mime, upsert: true });
            if (!upErr) {
              const __signed = await getSignedQuotePdfUrl(storagePath);
          const urlData = { publicUrl: __signed || '' };
              if (urlData?.publicUrl) planUrls.push(urlData.publicUrl);
            }
          } catch (e) { console.warn('Plan upload failed:', e); }
        }
        if (planUrls.length > 0) {
          supabase.from('soumission_notes').insert({
            soumission_id: soumissionId,
            content: `📐 Plans de construction déposés:\n${planUrls.map((u, i) => `Plan ${i + 1}: ${u}`).join('\n')}`,
          } as any).then(() => {});
        }
      }

      // Save project details as a note if provided
      if (soumissionId && data.projectDetails?.trim()) {
        supabase.from('soumission_notes').insert({
          soumission_id: soumissionId,
          content: `📝 Détails du projet (nouvelle construction):\n\n${data.projectDetails.trim()}`,
        } as any).then(() => {});
      }

      // Mark form session as complete
      if (formSessionIdRef.current) {
        supabase.from('form_sessions').update({
          is_complete: true,
          last_step: 4,
          step_timings: stepTimingsRef.current,
          updated_at: new Date().toISOString(),
        } as any).eq('session_id', formSessionIdRef.current).then(() => {});
      }
    } catch (e: any) {
      const errMsg = e?.message || e?.details || JSON.stringify(e);
      console.error('❌ SUBMIT FAILED:', errMsg, e);
      alert(`Erreur lors de l'envoi: ${errMsg}`);
      setSubmitting(false);
    }
  };

  const startComputing = () => {
    setPhase('computing');
    setTimeout(() => setPhase('result'), 2200);
  };

  // Filtered products
  const filteredProducts = products.filter(p => data.coverageType ? p.category === coverageToCategory(data.coverageType) : false);


  /* ── Advisor messages per step ── */
  const advisorMsg = useMemo(() => {
    const name = data.client.firstName || 'là';
    switch (step) {
      case 0: return `Bonjour ${name} ! Pour commencer, j'aurais besoin de l'adresse où les travaux vont être effectués.`;
      case 1: return `De quel type de travaux avez-vous besoin, ${name} ?`;
      case 2: return ''; // handled by BuildingConfirmation
      case 3: return ''; // handled by AdvisorAnalysis
      case 4: return `Dernière étape ${name} ! Vos coordonnées et c'est terminé.`;
      default: return '';
    }
  }, [step, data.client.firstName]);

  // Reset advisorDone when step changes
  useEffect(() => { setAdvisorDone(false); }, [step]);

  /* ──────── RENDER STEPS ──────── */
  const renderStep = () => {
    switch (step) {
      // Step 0: Address
      case 0: return (
        <div className={s.stepWrap}>
          <AdvisorBubble message={advisorMsg} onDone={() => setAdvisorDone(true)} />
          {advisorDone && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} style={{ width: '100%' }}>
              <input
                key={`addr-input-${addressInputKey}`}
                ref={addressInputRef}
                className={s.darkInput}
                defaultValue={addressText}
                onChange={e => {
                  const val = e.target.value;
                  setAddressText(val);
                  setGlobeSearchQuery(val);
                  if (val !== confirmedAddr.current) {
                    updateData({ address: null });
                    setGlobeTargetLatLng(null);
                  }
                }}
                placeholder="Entrez l'adresse du projet…"
                autoFocus
              />
              {addressText && !data.address && (
                <p style={{ fontSize: 12, color: 'var(--imm-danger)' }}>
                  Sélectionnez une adresse dans la liste
                </p>
              )}
            </motion.div>
          )}
        </div>
      );

      // Step 2: Building confirmation (skipped for nouvelle_construction / autre)
      case 2: return (
        <div className={s.stepWrap}>
          {data.address && (
            <BuildingConfirmation
              firstName={data.client.firstName}
              address={data.address.formatted_address}
              lat={data.address.lat}
              lng={data.address.lng}
              onAdjustmentsChange={setPolygonAdjustments}
              onConfirm={(geoJson, sup, peri, extra) => {
                setBuildingGeoJson(geoJson);
                setBuildingSuperficie(sup);
                setBuildingPerimetre(peri);
                setBuildingLotGeojson(extra?.lotGeojson ?? null);
                setBuildingNoLot(extra?.noLot ?? null);
                setBuildingLargeur(extra?.largeur ?? null);
                setBuildingProfondeur(extra?.profondeur ?? null);
                setNotCovered(false);
                // Pre-fetch satellite image for PDF (will be composited with polygons at submit)
                const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
                if (data.address && apiKey) {
                  const zoomTarget = extra?.lotGeojson || geoJson;
                  let zoom = 19;
                  try {
                    const parsed = JSON.parse(zoomTarget);
                    let coords: number[][] = [];
                    if (parsed.type === 'Polygon') coords = parsed.coordinates[0];
                    else if (parsed.type === 'MultiPolygon') parsed.coordinates.forEach((p: number[][][]) => coords.push(...p[0]));
                    if (coords.length > 0) {
                      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
                      for (const [lng, lat] of coords) { if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng; }
                      const cLat = (minLat + maxLat) / 2;
                      const cLng = (minLng + maxLng) / 2;
                      const latSpan = maxLat - minLat;
                      const lngSpan = maxLng - minLng;
                      const zLng = lngSpan > 0 ? Math.log2(1280 * 360 / (lngSpan * 256 * 2)) : 21;
                      const zLat = latSpan > 0 ? Math.log2(1280 * 360 / (latSpan * 256 * 2 * (1 / Math.cos(cLat * Math.PI / 180)))) : 21;
                      zoom = Math.max(Math.min(Math.floor(Math.min(zLng, zLat)) - 1, 20), 16);
                      satCenterRef.current = { lat: cLat, lng: cLng, zoom };
                      fetchSatelliteDataUrl(cLat, cLng, zoom, apiKey).then(url => setSatDataUrl(url));
                    }
                  } catch { /* ignore */ }
                }
                goNext();
              }}
              onNotCovered={() => setNotCovered(true)}
              onContinueWithout={() => {
                setBuildingGeoJson(null);
                setBuildingSuperficie(null);
                setBuildingPerimetre(null);
                setNotCovered(true);
                goNext();
              }}
            />
          )}
        </div>
      );

      // Step 1: Work type selection
      case 1: return (
        <div className={s.stepWrap}>
          {data.workType !== 'reparations' && data.workType !== 'inspection' && data.workType !== 'nouvelle_construction' && <AdvisorBubble message={advisorMsg} />}

          {data.workType === 'reparations' ? (
            <RepairDetailsChat
              firstName={data.client.firstName}
              address={data.address?.formatted_address || ''}
              aiAnalysis={{
                roofType: aiRoofType,
                slopeCategory: aiSlopeCategory,
                confidence: aiConfidence,
                buildingType: (data as any).buildingType || '',
              }}
              onReady={() => goNext()}
              onBack={() => updateData({ workType: null })}
              onSmsGlow={() => setSmsGlow(true)}
            />
          ) : data.workType === 'inspection' ? (
            /* ── Inspection flow ── */
            inspectionChatOpen ? (
              <RepairDetailsChat
                firstName={data.client.firstName}
                address={data.address?.formatted_address || ''}
                aiAnalysis={{
                  roofType: aiRoofType,
                  slopeCategory: aiSlopeCategory,
                  confidence: aiConfidence,
                  buildingType: (data as any).buildingType || '',
                }}
                onReady={() => goNext()}
                onBack={() => setInspectionChatOpen(false)}
                onSmsGlow={() => setSmsGlow(true)}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 480 }}>
                <AdvisorBubble message={`Parfait ${data.client.firstName || introName || ''} ! Voici les détails de notre service d'inspection.`} />

                {/* Pricing card */}
                <div style={{
                  background: 'linear-gradient(135deg, hsla(260, 30%, 18%, 0.8), hsla(240, 20%, 14%, 0.8))',
                  border: '1px solid hsla(260, 40%, 35%, 0.5)',
                  borderRadius: 16, padding: '24px 20px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Inspection professionnelle
                  </div>
                  <div style={{
                    fontSize: 42, fontWeight: 800, marginBottom: 4,
                    background: 'linear-gradient(135deg, hsl(280, 80%, 65%), hsl(200, 80%, 65%))',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>
                    250$
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.5 }}>Frais fixe · 3 heures minimum</div>
                </div>

                {/* Info block */}
                <div style={{
                  background: 'hsla(260, 20%, 15%, 0.6)',
                  border: '1px solid hsla(260, 30%, 25%, 0.4)',
                  borderRadius: 12, padding: '16px 18px',
                  fontSize: 14, lineHeight: 1.7, opacity: 0.85,
                }}>
                  <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Search size={16} style={{ marginTop: 3, flexShrink: 0, opacity: 0.7 }} />
                    <span>Un de nos experts se déplacera pour inspecter votre toiture en détail.</span>
                  </p>
                  <p style={{ margin: '10px 0 0', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <ClipboardList size={16} style={{ marginTop: 3, flexShrink: 0, opacity: 0.7 }} />
                    <span>Suite à l'inspection, nous vous fournirons un <strong>rapport complet</strong> ainsi qu'un <strong>budget détaillé</strong> pour les travaux recommandés.</span>
                  </p>
                </div>

                {/* Action buttons */}
                <button
                  className={s.ctaBtn}
                  onClick={() => goNext()}
                  style={{ width: '100%' }}
                >
                  Réserver mon inspection →
                </button>

                <button
                  className={s.ctaBtnSecondary}
                  onClick={() => setInspectionChatOpen(true)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <MessageCircle size={16} />
                  Préciser les détails de mon problème
                </button>

                <button
                  onClick={() => { updateData({ workType: null }); setInspectionChatOpen(false); }}
                  style={{
                    background: 'none', border: 'none', color: 'hsla(260, 60%, 70%, 0.8)',
                    fontSize: 14, cursor: 'pointer', padding: '8px 0',
                  }}
                >
                  ← Changer le type de travaux
                </button>
              </div>
            )
          ) : data.workType === 'nouvelle_construction' ? (
            /* ── Nouvelle construction flow ── */
            ncChatOpen ? (
              <RepairDetailsChat
                firstName={data.client.firstName}
                address={data.address?.formatted_address || ''}
                aiAnalysis={{
                  roofType: aiRoofType,
                  slopeCategory: aiSlopeCategory,
                  confidence: aiConfidence,
                  buildingType: (data as any).buildingType || '',
                }}
                mode="construction"
                onReady={() => goNext()}
                onBack={() => setNcChatOpen(false)}
                onSmsGlow={() => setSmsGlow(true)}
              />
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 480 }}>
              <AdvisorBubble message={`Super ${data.client.firstName || introName || ''} ! Déposez vos plans et nous vous contacterons rapidement avec une soumission détaillée.`} />

              {/* Upload zone */}
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 12, padding: '32px 20px', borderRadius: 16,
                border: '2px dashed hsla(260, 40%, 50%, 0.5)',
                background: 'hsla(260, 20%, 15%, 0.5)',
                cursor: 'pointer', textAlign: 'center', minHeight: 140,
              }}>
                <Upload size={32} style={{ opacity: 0.6 }} />
                <div style={{ fontSize: 15, fontWeight: 600 }}>Déposer vos plans</div>
                <div style={{ fontSize: 13, opacity: 0.5 }}>PDF ou PNG · Max 10 fichiers</div>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        updateData({ constructionPlans: [...data.constructionPlans, reader.result as string] });
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = '';
                  }}
                />
              </label>

              {/* Plans à joindre */}
              <div style={{
                background: 'hsla(260, 20%, 15%, 0.5)',
                border: '1px solid hsla(260, 30%, 25%, 0.3)',
                borderRadius: 12, padding: '14px 16px',
                fontSize: 13, lineHeight: 1.7, opacity: 0.8,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>📐 Plans à joindre</div>
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  <li>Plans d'architecture (élévations, coupes)</li>
                  <li>Plans de structure</li>
                  <li>Plan d'implantation / arpentage</li>
                  <li>Devis descriptif (si disponible)</li>
                </ul>
              </div>

              {data.constructionPlans.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {data.constructionPlans.map((plan, i) => (
                    <div key={i} style={{
                      position: 'relative', width: 72, height: 72, borderRadius: 10, overflow: 'hidden',
                      border: '1px solid hsla(260, 30%, 30%, 0.5)',
                      background: 'hsla(260, 20%, 12%, 0.8)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {plan.startsWith('data:application/pdf') ? (
                        <FileText size={28} style={{ opacity: 0.5 }} />
                      ) : (
                        <img src={plan} alt={`Plan ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      <button
                        onClick={() => updateData({ constructionPlans: data.constructionPlans.filter((_, idx) => idx !== i) })}
                        style={{
                          position: 'absolute', top: 2, right: 2, background: 'hsla(0,0%,0%,0.6)',
                          border: 'none', borderRadius: '50%', width: 22, height: 22,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff',
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Project details textarea */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 14, fontWeight: 600, opacity: 0.85 }}>📝 Détails du projet (optionnel)</label>
                <textarea
                  value={data.projectDetails || ''}
                  onChange={e => updateData({ projectDetails: e.target.value })}
                  placeholder="Décrivez votre projet : type de bâtiment, nombre d'étages, superficie approximative, matériaux souhaités, échéancier…"
                  rows={4}
                  style={{
                    width: '100%', borderRadius: 12, padding: '12px 14px',
                    background: 'hsla(260, 20%, 12%, 0.8)',
                    border: '1px solid hsla(260, 30%, 30%, 0.5)',
                    color: '#fff', fontSize: 14, lineHeight: 1.6, resize: 'vertical',
                    outline: 'none', fontFamily: 'inherit',
                  }}
                />
              </div>

              <button
                className={s.ctaBtn}
                disabled={data.constructionPlans.length === 0}
                onClick={() => setStep(4)}
                style={{ width: '100%', opacity: data.constructionPlans.length === 0 ? 0.4 : 1 }}
              >
                Continuer →
              </button>

              <button
                className={s.ctaBtnSecondary}
                onClick={() => setNcChatOpen(true)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <MessageCircle size={16} />
                Préciser les détails de mon projet
              </button>

              <button
                onClick={() => { updateData({ workType: null, constructionPlans: [], projectDetails: '' }); setNcChatOpen(false); }}
                style={{
                  background: 'none', border: 'none', color: 'hsla(260, 60%, 70%, 0.8)',
                  fontSize: 14, cursor: 'pointer', padding: '8px 0',
                }}
              >
                ← Changer le type de travaux
              </button>
            </div>
            )
          ) : (
            <div className={`${s.cardsGrid}`} style={{ gridTemplateColumns: '1fr' }}>
              {WORK_TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.val}
                  className={`${s.darkCard} ${data.workType === opt.val ? s.darkCardSelected : ''}`}
                  onClick={() => {
                    if (opt.val === 'reparations' || opt.val === 'inspection' || opt.val === 'nouvelle_construction') {
                      updateData({ workType: opt.val });
                      if (opt.val === 'nouvelle_construction') { setNcChatOpen(false); }
                    } else {
                      autoSelect('workType', opt.val);
                    }
                  }}
                  style={{ flexDirection: 'row', gap: 14, justifyContent: 'flex-start', padding: '14px 18px', alignItems: 'center' }}
                >
                  <span style={{ color: 'hsla(260, 80%, 75%, 1)', display: 'flex', flexShrink: 0 }}>{opt.icon}</span>
                  <span className={s.darkCardTitle} style={{ fontSize: 14, textAlign: 'left' }}>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );

      // Step 3: AI Analysis Summary — consolidated coverage, slope, product, color
      case 3: {

        const editingField = editingAiField;
        const setEditingField = setEditingAiField;

        const isFlatRoof = data.coverageType === 'membrane_elastomere' || data.coverageType === 'membrane_gravier';

        const slopeOptions: { val: SlopeLevel; label: string; desc: string; icon: string }[] = isFlatRoof ? [
          { val: 'flat', label: 'Plat', desc: '0/12 – 2/12', icon: slopeNoneIcon },
        ] : [
          { val: '4-7', label: 'Faible', desc: '4/12 – 5/12', icon: slopeNoneIcon },
          { val: '7-9', label: 'Moyenne', desc: '6/12 – 7/12', icon: slopeLightIcon },
          { val: '9-12', label: 'Élevée', desc: '8/12 – 9/12', icon: slopeModerateIcon },
          { val: '12+', label: 'Très élevée', desc: '10/12 – 12/12', icon: slopeAbrupteIcon },
        ];

        const coverageLabel = COVERAGE_FR[data.coverageType || ''] || 'Non défini';
        const slopeLabel = slopeOptions.find(o => o.val === data.slope)?.label || 'Non défini';
        const isSbsCategory = data.coverageType === 'membrane_elastomere' || data.coverageType === 'membrane_gravier';
        const productLabel = data.product ? (isSbsCategory ? data.product.brand : `${data.product.brand} ${data.product.name}`) : 'Non défini';
        const colorLabel = data.color ? frColor(data.color) : 'Non défini';

        // Get current product swatches
        const currentSwatches = data.product ? (PRODUCT_SWATCH_MAP[data.product.name] || {}) : {};
        const currentColorSwatch = currentSwatches[data.color] || null;

        const allSet = !!data.coverageType && !!data.slope && !!data.product && !!data.color;

        // Filtered products for current coverage
        const stepProducts = products.filter(p => data.coverageType ? p.category === coverageToCategory(data.coverageType) : false);

        // Gradient card style
        const gradientCardStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          background: 'linear-gradient(135deg, hsla(260, 70%, 55%, 0.2), hsla(185, 70%, 50%, 0.15))',
          border: '1px solid hsla(260, 60%, 55%, 0.4)',
          borderRadius: 12,
          color: 'var(--imm-text, hsla(0,0%,95%,1))',
          boxShadow: '0 4px 20px hsla(260, 70%, 55%, 0.15), inset 0 1px 0 hsla(0, 0%, 100%, 0.06)',
          width: '100%',
        };

        const cardLand = {
          initial: { opacity: 0, scale: 0.85, y: -30 },
          animate: { opacity: 1, scale: 1, y: 0 },
          transition: { duration: 0.5, type: 'spring' as const, bounce: 0.35 },
        };

        const bubbleStyle: React.CSSProperties = {
          background: 'var(--imm-surface, hsla(230, 22%, 12%, 0.95))',
          border: '1px solid var(--imm-border, hsla(230, 22%, 20%, 0.5))',
          borderRadius: '0 12px 12px 12px',
          padding: '10px 14px',
          flex: 1,
          maxWidth: 420,
        };

        const miniCardInBubble: React.CSSProperties = {
          ...gradientCardStyle,
          marginTop: 8,
        };

        // Advisor sub-phase sequencer
        const startSlopePhase = () => {
          setAdvisorSubPhase('slope_reasoning');
          setTimeout(() => setAdvisorSubPhase('slope_card'), 1200);
          setTimeout(() => { setAdvisorSubPhase('slope_fly'); }, 2800);
          setTimeout(() => { setAiRevealCount(prev => Math.max(prev, 2)); setAdvisorSubPhase('product_reasoning'); }, 3200);
          setTimeout(() => setAdvisorSubPhase('product_card'), 4400);
          setTimeout(() => { setAdvisorSubPhase('product_fly'); }, 6000);
          setTimeout(() => { setAiRevealCount(prev => Math.max(prev, 3)); setAdvisorSubPhase('color_reasoning'); }, 6400);
          setTimeout(() => setAdvisorSubPhase('color_card'), 7600);
          setTimeout(() => { setAdvisorSubPhase('color_fly'); }, 9200);
          setTimeout(() => { setAiRevealCount(prev => Math.max(prev, 4)); setAdvisorSubPhase('done'); }, 9600);
        };

        const slopePitchLabel = slopeOptions.find(o => o.val === data.slope);

        return (
          <div className={s.stepWrap}>
            {/* Phase 1: AI Analysis — coverage detection */}
            {data.address && (
              <AdvisorAnalysis
                firstName={data.client.firstName}
                address={data.address.formatted_address}
                lat={data.address.lat}
                lng={data.address.lng}
                onClassified={(rt, mapped, roofType, slopeCat, confidence, buildingType) => {
                  updateData({ roofClassification: rt, buildingType: buildingType || null } as any);
                  const isMembrane = mapped === 'membrane_elastomere' || mapped === 'membrane_gravier';
                  if (mapped) {
                    setDetectedCoverageType(mapped);
                    if (!data.coverageType) updateData({ coverageType: mapped });
                  }
                  if (roofType) setAiRoofType(roofType as RoofType);
                  if (isMembrane) {
                    setDetectedSlopeLevel('flat');
                    if (!data.slope) updateData({ slope: 'flat' });
                    const sbsProducts = products.filter(p => p.category === 'sbs');
                    const soprema = sbsProducts.find(p => p.brand === 'Soprema');
                    const first = soprema || sbsProducts[0];
                    if (first && !data.product) updateData({ product: first, color: 'Noir' });
                  } else if (slopeCat) {
                    setAiSlopeCategory(slopeCat as SlopeCategory);
                    const slopeMap: Record<string, SlopeLevel> = {
                      'faible': '4-7', 'moderee': '7-9', 'elevee': '9-12', 'tres_elevee': '12+',
                    };
                    const mapped_slope = slopeMap[slopeCat] || '7-9';
                    setDetectedSlopeLevel(mapped_slope);
                    if (!data.slope) updateData({ slope: mapped_slope });
                  }
                  if (typeof confidence === 'number') setAiConfidence(confidence);
                  setAiAnalysisDone(true);
                }}
                onResultDismissed={() => {
                  // Coverage card dismissed → land it + start slope phase
                  setAiRevealCount(1);
                  startSlopePhase();
                }}
              />
            )}

            {/* Phase 2: Slope reasoning bubble */}
            <AnimatePresence>
              {(advisorSubPhase === 'slope_reasoning' || advisorSubPhase === 'slope_card') && (
                <motion.div
                  key="slope-bubble"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', marginTop: 8 }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={advisorAvatar} alt="Marie-Ève" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--imm-accent)', boxShadow: '0 0 8px var(--imm-accent-glow)' }} />
                  </div>
                  <div style={bubbleStyle}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--imm-accent)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 3 }}>Marie-Ève</span>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, color: 'var(--imm-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <TrendingUp size={12} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
                      Analyse de la pente… <strong>{slopePitchLabel?.label || 'Faible'}</strong>
                    </motion.p>
                    <AnimatePresence>
                      {advisorSubPhase === 'slope_card' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.85, y: 40 }}
                          transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                          style={miniCardInBubble}
                        >
                          <img src={slopePitchLabel?.icon || slopeNoneIcon} alt="" style={{ width: 20, height: 16, objectFit: 'contain', filter: 'invert(1)', opacity: 0.85, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>Pente {slopePitchLabel?.label || 'Faible'}</span>
                          <span style={{ fontSize: 10, color: 'hsla(260, 80%, 75%, 0.7)' }}>🤖</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 3: Product reasoning bubble */}
            <AnimatePresence>
              {(advisorSubPhase === 'product_reasoning' || advisorSubPhase === 'product_card') && (
                <motion.div
                  key="product-bubble"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', marginTop: 8 }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={advisorAvatar} alt="Marie-Ève" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--imm-accent)', boxShadow: '0 0 8px var(--imm-accent-glow)' }} />
                  </div>
                  <div style={bubbleStyle}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--imm-accent)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 3 }}>Marie-Ève</span>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, color: 'var(--imm-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Package size={12} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
                      Je vous recommande… <strong>{productLabel}</strong>
                    </motion.p>
                    <AnimatePresence>
                      {advisorSubPhase === 'product_card' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.85, y: 40 }}
                          transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                          style={miniCardInBubble}
                        >
                          {data.product && BRAND_LOGO[data.product.brand]
                            ? <img src={BRAND_LOGO[data.product.brand]} alt="" style={{ height: 18, objectFit: 'contain', mixBlendMode: 'screen', flexShrink: 0 }} />
                            : <Gem size={16} style={{ flexShrink: 0, color: 'hsla(260, 80%, 75%, 1)' }} />
                          }
                          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{productLabel}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 4: Color reasoning bubble */}
            <AnimatePresence>
              {(advisorSubPhase === 'color_reasoning' || advisorSubPhase === 'color_card') && (
                <motion.div
                  key="color-bubble"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', marginTop: 8 }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={advisorAvatar} alt="Marie-Ève" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--imm-accent)', boxShadow: '0 0 8px var(--imm-accent-glow)' }} />
                  </div>
                  <div style={bubbleStyle}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--imm-accent)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 3 }}>Marie-Ève</span>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, color: 'var(--imm-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Palette size={12} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
                      Couleur suggérée… <strong>{colorLabel}</strong>
                    </motion.p>
                    <AnimatePresence>
                      {advisorSubPhase === 'color_card' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.85, y: 40 }}
                          transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                          style={miniCardInBubble}
                        >
                          {currentColorSwatch
                            ? <span style={{ width: 20, height: 20, borderRadius: '50%', backgroundImage: `url(${currentColorSwatch})`, backgroundSize: 'cover', display: 'inline-block', border: '1px solid hsla(0,0%,100%,0.2)', flexShrink: 0 }} />
                            : <span style={{ width: 20, height: 20, borderRadius: '50%', background: COLOR_MAP[data.color] || '#999', display: 'inline-block', border: '1px solid hsla(0,0%,100%,0.2)', flexShrink: 0 }} />
                          }
                          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{colorLabel}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Landed result cards ── */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>

              {/* 1. Coverage */}
              <AnimatePresence>
                {aiRevealCount >= 1 && (
                  <motion.div key="landed-coverage" {...cardLand}>
                    <div style={{ ...gradientCardStyle, cursor: 'pointer' }} onClick={() => setEditingField('coverage')}>
                      <Layers size={16} style={{ flexShrink: 0, color: 'hsla(260, 80%, 75%, 1)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'hsla(0,0%,100%,0.5)', marginBottom: 2 }}>Couverture détectée</div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{coverageLabel}</div>
                      </div>
                      {detectedCoverageType === data.coverageType && <span style={{ fontSize: 10, color: 'hsla(260, 80%, 75%, 0.7)' }}>🤖</span>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 2. Slope */}
              <AnimatePresence>
                {aiRevealCount >= 2 && (
                  <motion.div key="landed-slope" {...cardLand}>
                    <div style={{ ...gradientCardStyle, cursor: 'pointer' }} onClick={() => setEditingField('slope')}>
                      <img src={data.slope ? slopeOptions.find(o => o.val === data.slope)?.icon || slopeNoneIcon : slopeNoneIcon} alt="" style={{ width: 20, height: 16, objectFit: 'contain', filter: 'invert(1)', opacity: 0.85, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'hsla(0,0%,100%,0.5)', marginBottom: 2 }}>Pente analysée</div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{slopeLabel} {data.slope ? `(${data.slope === '12+' ? '12/12+' : data.slope.replace('-', '/12 – ') + '/12'})` : ''}</div>
                      </div>
                      {detectedSlopeLevel === data.slope && <span style={{ fontSize: 10, color: 'hsla(260, 80%, 75%, 0.7)' }}>🤖</span>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 3. Product */}
              <AnimatePresence>
                {aiRevealCount >= 3 && (
                  <motion.div key="landed-product" {...cardLand}>
                    <div style={{ ...gradientCardStyle, cursor: 'pointer' }} onClick={() => setEditingField('product')}>
                      {data.product && BRAND_LOGO[data.product.brand]
                        ? <img src={BRAND_LOGO[data.product.brand]} alt="" style={{ height: 18, objectFit: 'contain', mixBlendMode: 'screen', flexShrink: 0 }} />
                        : <Gem size={16} style={{ flexShrink: 0, color: 'hsla(260, 80%, 75%, 1)' }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'hsla(0,0%,100%,0.5)', marginBottom: 2 }}>Produit recommandé</div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{productLabel}</div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 4. Color */}
              <AnimatePresence>
                {aiRevealCount >= 4 && (
                  <motion.div key="landed-color" {...cardLand}>
                    <div style={{ ...gradientCardStyle, cursor: 'pointer' }} onClick={() => setEditingField('color')}>
                      {currentColorSwatch
                        ? <span style={{ width: 20, height: 20, borderRadius: '50%', backgroundImage: `url(${currentColorSwatch})`, backgroundSize: 'cover', display: 'inline-block', border: '1px solid hsla(0,0%,100%,0.2)', flexShrink: 0 }} />
                        : <span style={{ width: 20, height: 20, borderRadius: '50%', background: COLOR_MAP[data.color] || '#999', display: 'inline-block', border: '1px solid hsla(0,0%,100%,0.2)', flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'hsla(0,0%,100%,0.5)', marginBottom: 2 }}>Couleur sélectionnée</div>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px' }}>{colorLabel}</div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>

            {/* ── Fullscreen edit overlay ── */}
            <AnimatePresence>
              {editingField && (
                <motion.div
                  key="edit-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 90,
                    background: 'hsla(230, 25%, 6%, 0.92)',
                    backdropFilter: 'blur(12px)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    padding: '24px 16px',
                  }}
                  onClick={(e) => { if (e.target === e.currentTarget) setEditingField(null); }}
                >
                  <motion.div
                    initial={{ scale: 0.92, y: 30 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.92, y: 30 }}
                    transition={{ duration: 0.25, type: 'spring', bounce: 0.2 }}
                    style={{
                      width: '100%', maxWidth: 420, maxHeight: '80vh',
                      overflowY: 'auto',
                      background: 'var(--imm-surface, hsla(230, 22%, 12%, 0.98))',
                      border: '1px solid hsla(260, 60%, 55%, 0.3)',
                      borderRadius: 20,
                      padding: '24px 20px 20px',
                      boxShadow: '0 24px 80px hsla(0, 0%, 0%, 0.6)',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--imm-text)' }}>
                        {editingField === 'coverage' && 'Modifier la couverture'}
                        {editingField === 'slope' && 'Modifier la pente'}
                        {editingField === 'product' && 'Modifier le produit'}
                        {editingField === 'color' && 'Modifier la couleur'}
                      </span>
                      <button
                        onClick={() => setEditingField(null)}
                        style={{
                          background: 'hsla(0,0%,100%,0.1)', border: 'none', borderRadius: '50%',
                          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--imm-text)', cursor: 'pointer', fontSize: 18,
                        }}
                      >✕</button>
                    </div>

                    {/* Coverage edit */}
                    {editingField === 'coverage' && (
                      <StepCoverageImmersive
                        value={data.coverageType}
                        detectedType={detectedCoverageType}
                        onSelect={(val) => {
                          const isFlat = val === 'membrane_elastomere' || val === 'membrane_gravier';
                          updateData({ coverageType: val, product: null, color: '', ...(isFlat ? { slope: 'flat' as SlopeLevel } : {}) });
                          setTimeout(() => {
                            const newProducts = products.filter(p => p.category === coverageToCategory(val));
                            if (isFlat) {
                              const soprema = newProducts.find(p => p.brand === 'Soprema');
                              const first = soprema || newProducts[0];
                              if (first) updateData({ product: first, color: 'Noir' });
                            } else {
                              const dynasty = newProducts.find(p => p.name === 'Dynasty' && p.brand === 'IKO');
                              if (dynasty) updateData({ product: dynasty, color: 'Granite Black' });
                              else if (newProducts[0]) updateData({ product: newProducts[0], color: newProducts[0].colors[0] || '' });
                            }
                          }, 50);
                          setEditingField(null);
                        }}
                      />
                    )}

                    {/* Slope edit */}
                    {editingField === 'slope' && (
                      <div className={`${s.cardsGrid} ${s.cardsGrid2}`}>
                        {slopeOptions.map(opt => {
                          const isDetected = detectedSlopeLevel === opt.val;
                          return (
                            <button key={opt.val}
                              className={`${s.darkCard} ${data.slope === opt.val ? s.darkCardSelected : ''}`}
                              onClick={() => { updateData({ slope: opt.val }); setEditingField(null); }}
                              style={{ position: 'relative', padding: '16px 12px' }}
                            >
                              {isDetected && (
                                <span style={{
                                  position: 'absolute', top: 6, right: 6,
                                  background: 'hsla(260, 70%, 55%, 0.3)',
                                  border: '1px solid hsla(260, 60%, 55%, 0.5)',
                                  borderRadius: 8, padding: '2px 6px',
                                  fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                                  color: 'hsla(260, 80%, 75%, 1)',
                                }}>🤖</span>
                              )}
                              <img src={opt.icon} alt={opt.label} style={{ width: opt.val === '4-7' ? 80 : 60, height: opt.val === '4-7' ? 64 : 48, objectFit: 'contain', filter: 'invert(1)', opacity: 0.85 }} />
                              <span className={s.darkCardTitle} style={{ fontSize: 13 }}>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Product edit */}
                    {editingField === 'product' && (() => {
                      const isSbs = data.coverageType === 'membrane_elastomere' || data.coverageType === 'membrane_gravier';
                      if (isSbs) {
                        // SBS: show only brand logos (IKO / Soprema)
                        const sbsBrands = ['IKO', 'Soprema'];
                        return (
                          <div className={`${s.cardsGrid}`} style={{ gridTemplateColumns: '1fr 1fr' }}>
                            {sbsBrands.map(brand => {
                              const isSelected = data.product?.brand === brand;
                              return (
                                <button key={brand}
                                  className={`${s.darkCard} ${isSelected ? s.darkCardSelected : ''}`}
                                  onClick={() => {
                                    const p = stepProducts.find(pr => pr.brand === brand);
                                    if (p) { updateData({ product: p, color: p.colors[0] || 'Noir' }); setEditingField(null); }
                                  }}
                                  style={{ padding: '20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                  <img src={BRAND_LOGO[brand]} alt={brand} style={{ height: 44, objectFit: 'contain', mixBlendMode: 'screen' }} />
                                </button>
                              );
                            })}
                          </div>
                        );
                      }
                      // Shingle: keep existing behavior
                      return (
                        <div className={`${s.cardsGrid} ${s.cardsGrid3}`}>
                          {[...stepProducts].sort((a, b) => {
                            const aFav = (a.name === 'Dynasty' && a.brand === 'IKO') || (a.name === 'Signature' && a.brand === 'BP');
                            const bFav = (b.name === 'Dynasty' && b.brand === 'IKO') || (b.name === 'Signature' && b.brand === 'BP');
                            return (bFav ? 1 : 0) - (aFav ? 1 : 0);
                          }).map(p => {
                            const isBestSeller = (p.name === 'Dynasty' && p.brand === 'IKO') || (p.name === 'Signature' && p.brand === 'BP');
                            const info = PRODUCT_INFO[p.name];
                            return (
                              <button key={p.id}
                                className={`${s.darkCard} ${data.product?.id === p.id ? s.darkCardSelected : ''}`}
                                onClick={() => {
                                  const defaultColor = p.colors[0] || '';
                                  updateData({ product: p, color: defaultColor });
                                  setEditingField(null);
                                }}
                                style={{ position: 'relative', padding: '16px 12px' }}
                              >
                                {isBestSeller && <span className={s.bestSellerBadge}><Gem size={14} /></span>}
                                <span className={s.darkCardTitle} style={{ fontSize: 13 }}>{p.name}</span>
                                {info && <span style={{ fontSize: 10, color: 'hsla(0,0%,100%,0.45)', marginTop: -4 }}>{info.tier}</span>}
                                {BRAND_LOGO[p.brand]
                                  ? <img src={BRAND_LOGO[p.brand]} alt={p.brand} style={{ height: 40, objectFit: 'contain', mixBlendMode: 'screen' }} />
                                  : <span className={s.darkCardDesc}>{p.brand}</span>
                                }
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Color edit */}
                    {editingField === 'color' && data.product && (
                      <div className={s.swatchGroup}>
                        {data.product.colors.map(c => {
                          const productSwatches = data.product ? (PRODUCT_SWATCH_MAP[data.product.name] || {}) : {};
                          const swatchImg = productSwatches[c];
                          return (
                            <div key={c} className={s.swatchItem}
                              onClick={() => { updateData({ color: c }); setEditingField(null); }}>
                              <div className={`${s.swatchCircle} ${data.color === c ? s.swatchCircleSelected : ''}`}
                                style={swatchImg
                                  ? { backgroundImage: `url(${swatchImg})`, backgroundSize: 'cover', backgroundPosition: 'center', width: 52, height: 52 }
                                  : { background: COLOR_MAP[c] || '#999', width: 52, height: 52 }
                                } />
                              <span className={s.swatchName}>{frColor(c)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Price estimate ── */}
            <AnimatePresence>
              {allSet && matrixEstimate && aiRevealCount >= 4 && data.workType !== 'reparations' && (
                <motion.div
                  key="price-estimate"
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.5, type: 'spring', bounce: 0.3, delay: 0.3 }}
                  style={{
                    width: '100%',
                    marginTop: 16,
                    padding: '20px 20px 16px',
                    background: 'linear-gradient(135deg, hsla(145, 60%, 40%, 0.2), hsla(185, 70%, 50%, 0.15))',
                    border: '1px solid hsla(145, 50%, 45%, 0.4)',
                    borderRadius: 16,
                    textAlign: 'center',
                    boxShadow: '0 8px 32px hsla(145, 60%, 40%, 0.15), inset 0 1px 0 hsla(0, 0%, 100%, 0.08)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'hsla(0,0%,100%,0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Estimation préliminaire</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--imm-text)', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                    {Math.round(matrixEstimate.price_per_sqft_low * matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff).toLocaleString('fr-CA')}&nbsp;$ — {Math.round(matrixEstimate.price_per_sqft_high * matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff).toLocaleString('fr-CA')}&nbsp;$
                  </div>
                  <div style={{ fontSize: 11, color: 'hsla(0,0%,100%,0.45)', marginTop: 8, lineHeight: 1.6 }}>
                    Superficie au sol : {Math.round(matrixEstimate.footprint_sqft).toLocaleString('fr-CA')} pi²<br />
                    Surface réelle : {Math.round(matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff).toLocaleString('fr-CA')} pi² (×{matrixEstimate.slope_coeff})<br />
                    Prix au pi² : {matrixEstimate.price_per_sqft_low.toFixed(2)}$ à {matrixEstimate.price_per_sqft_high.toFixed(2)}$
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {allSet && (advisorSubPhase === 'done' || aiRevealCount >= 4) && (
              <button className={s.ctaBtn} onClick={() => goNext()} style={{ marginTop: 12 }}>Continuer</button>
            )}
          </div>
        );
      }

      // Step 4: Client info (+ manual area only when required)
      case 4: {
        const c = data.client;
        const upd = (field: string, val: string) => updateData({ client: { ...c, [field]: val } });
        const needsManualArea = !buildingSuperficie && data.workType !== 'inspection' && data.workType !== 'nouvelle_construction';

        const firstNameValid = c.firstName.trim().length > 0;
        const lastNameValid = c.lastName.trim().length > 0;
        const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim());
        const phoneValid = c.phone.replace(/\D/g, '').length >= 7;
        const areaValid = !needsManualArea || data.area > 0;
        const allValid = firstNameValid && lastNameValid && emailValid && phoneValid && areaValid;

        const inputClass = (valid: boolean) => `${s.darkInput} ${valid ? s.darkInputValid : s.darkInputInvalid}`;

        return (
          <div className={s.stepWrap}>
            <AdvisorBubble message={advisorMsg} onDone={() => setAdvisorDone(true)} />
            {advisorDone && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>

            {needsManualArea && (
              <div className={`${s.fieldGroup} ${s.fieldGroupFull}`}>
                <label className={`${s.fieldLabel} ${s.fieldLabelWarning}`}>
                  Superficie de la couverture (pi²)
                </label>
                <div className={s.inputWrap}>
                  <input
                    className={inputClass(areaValid)}
                    type="number"
                    value={data.area || ''}
                    onChange={e => updateData({ area: parseFloat(e.target.value) || 0, areaUnit: 'sqft' as AreaUnit })}
                    placeholder="Ex: 1200"
                    min={100}
                    autoFocus
                  />
                  {areaValid && <span className={s.fieldCheck}>✓</span>}
                </div>
                {!areaValid && <p className={s.fieldErrorText}>Champ requis</p>}
                <p className={s.fieldHelpText}>
                  Bâtiment non trouvé dans notre base — entrez la superficie manuellement.
                </p>
              </div>
            )}

            <div className={s.fieldsGrid}>
              <div className={s.fieldGroup}>
                <label className={s.fieldLabel}>Prénom</label>
                <div className={s.inputWrap}>
                  <input
                    className={inputClass(firstNameValid)}
                    value={c.firstName}
                    onChange={e => upd('firstName', e.target.value)}
                    placeholder="Jean"
                    autoFocus={!needsManualArea}
                  />
                  {firstNameValid && <span className={s.fieldCheck}>✓</span>}
                </div>
                {!firstNameValid && <p className={s.fieldErrorText}>Champ requis</p>}
              </div>
              <div className={s.fieldGroup}>
                <label className={s.fieldLabel}>Nom</label>
                <div className={s.inputWrap}>
                  <input
                    className={inputClass(lastNameValid)}
                    value={c.lastName}
                    onChange={e => upd('lastName', e.target.value)}
                    placeholder="Dupont"
                  />
                  {lastNameValid && <span className={s.fieldCheck}>✓</span>}
                </div>
                {!lastNameValid && <p className={s.fieldErrorText}>Champ requis</p>}
              </div>
            </div>

            <div className={`${s.fieldGroup} ${s.fieldGroupFull}`}>
              <label className={s.fieldLabel}>Courriel</label>
              <div className={s.inputWrap}>
                <input
                  className={inputClass(emailValid)}
                  type="email"
                  value={c.email}
                  onChange={e => upd('email', e.target.value)}
                  placeholder="jean@exemple.com"
                />
                {emailValid && <span className={s.fieldCheck}>✓</span>}
              </div>
              {!emailValid && <p className={s.fieldErrorText}>Courriel invalide</p>}
            </div>

            <div className={`${s.fieldGroup} ${s.fieldGroupFull}`}>
              <label className={s.fieldLabel}>Téléphone</label>
              <div className={s.inputWrap}>
                <input
                  className={inputClass(phoneValid)}
                  type="tel"
                  value={c.phone}
                  onChange={e => upd('phone', e.target.value)}
                  placeholder="(514) 555-1234"
                />
                {phoneValid && <span className={s.fieldCheck}>✓</span>}
              </div>
              {!phoneValid && <p className={s.fieldErrorText}>Téléphone invalide</p>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <button
                className={s.ctaBtn}
                onClick={editFromResult !== null ? returnToResult : submit}
                disabled={!allValid}
                style={{ width: '100%', maxWidth: 400 }}
              >
                {editFromResult !== null ? 'Confirmer les modifications' : 'Soumettre ma demande →'}
              </button>
            </div>
            </motion.div>}
          </div>
        );
      }

      default: return null;
    }
  };

  /* ──────── INTRO ──────── */
  if (phase === 'intro') {
    const hasSaved = !!localStorage.getItem(LS_KEY);

    const goToPhone = () => {
      if (introName.trim()) {
        updateData({ client: { ...data.client, firstName: introName.trim() } });
        // Track intro_name step timing
        stepTimingsRef.current['intro_name_leave'] = new Date().toISOString();
        stepTimingsRef.current['intro_phone_enter'] = new Date().toISOString();
        // Save session with name immediately (captures early abandons)
        if (formSessionIdRef.current) {
          supabase.from('form_sessions').upsert({
            session_id: formSessionIdRef.current,
            first_name: introName.trim(),
            step_timings: stepTimingsRef.current,
            last_step: 0,
            is_complete: false,
            user_agent: navigator.userAgent,
            page_url: window.location.href,
            updated_at: new Date().toISOString(),
          } as any, { onConflict: 'session_id' }).then(() => {});
        }
        setIntroStep('phone');
      }
    };

    const startWithPhone = () => {
      if (introPhone.trim()) {
        updateData({ client: { ...data.client, phone: introPhone.trim() } });
      }
      // Track intro_phone step timing
      stepTimingsRef.current['intro_phone_leave'] = new Date().toISOString();
      // Save session with phone before transitioning
      if (formSessionIdRef.current) {
        supabase.from('form_sessions').upsert({
          session_id: formSessionIdRef.current,
          first_name: introName.trim() || null,
          phone: introPhone.trim() || null,
          step_timings: stepTimingsRef.current,
          last_step: 0,
          is_complete: false,
          user_agent: navigator.userAgent,
          page_url: window.location.href,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'session_id' }).then(() => {});
      }
      setPhase('form');
    };

    return (
      <div className={s.shell}>
        <div className={`${s.main} ${s.mainIntro}`}>
          <motion.div className={s.stepWrap}
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}>
            <motion.img
              src={vbLogo}
              alt="Toitures VB"
              style={{ height: 22, opacity: 0.85, marginBottom: 12, filter: 'drop-shadow(0 0 20px hsla(260,70%,62%,0.3))' }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 0.85, scale: 1 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
            <h1 className={s.question} style={{ fontSize: 'clamp(24px, 6vw, 32px)' }}>
              Votre soumission toiture<br />en 60 secondes
            </h1>
            <p className={s.subtext}>
              Zéro appel. Zéro attente. Résultat immédiat.
            </p>

            {introStep === 'cta' && (
              <>
                <button className={`${s.ctaBtn} ${s.ctaBtnIntro} ${s.ctaShine}`} onClick={() => { stepTimingsRef.current['intro_name_enter'] = new Date().toISOString(); setIntroStep('name'); }}>
                  Obtenir ma soumission →
                </button>
                {hasSaved && (
                  <button className={s.ctaBtnSecondary} onClick={() => {
                    const saved = loadSaved();
                    if (saved.data) { updateData(saved.data); setStep(saved.step); }
                    setPhase('form');
                  }}>
                    Reprendre ma soumission
                  </button>
                )}
              </>
            )}

            {introStep === 'name' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', maxWidth: 360 }}
              >
                <AdvisorBubble message="Bienvenue ! Quel est votre prénom ?" typing={true} />
                <input
                  className={s.darkInput}
                  value={introName}
                  onChange={e => setIntroName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && introName.trim()) goToPhone(); }}
                  placeholder="Votre prénom…"
                  autoFocus
                />
                {introName.trim() && (
                  <button className={`${s.ctaBtn} ${s.ctaBtnIntro} ${s.ctaShine}`} onClick={goToPhone}>
                    Continuer →
                  </button>
                )}
              </motion.div>
            )}

            {introStep === 'phone' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', maxWidth: 360 }}
              >
                <AdvisorBubble message={`Excellent ${introName.trim()} ! À quel numéro pouvons-nous vous rejoindre pour valider les détails de votre soumission ?`} typing={true} />
                <input
                  className={s.darkInput}
                  type="tel"
                  value={introPhone}
                  onChange={e => setIntroPhone(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && introPhone.replace(/\D/g, '').length >= 7) startWithPhone(); }}
                  placeholder="(514) 555-1234"
                  autoFocus
                />
                {introPhone.replace(/\D/g, '').length >= 7 && (
                  <button className={`${s.ctaBtn} ${s.ctaBtnIntro} ${s.ctaShine}`} onClick={startWithPhone}>
                    C'est parti →
                  </button>
                )}
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  /* ──────── COMPUTING ──────── */
  if (phase === 'computing') {
    return (
      <div className={s.shell}>
        <div className={s.radarWrap}>
          <div className={s.radarCircle}><div className={s.radarCircle2}><div className={s.radarCircle3} /></div></div>
          <div className={s.radarSweep} />
          <div className={s.radarDot} />
        </div>
        <div className={`${s.scanLine} ${s.scanLineActive}`} />
        <div className={s.main}>
          <motion.div className={s.stepWrap}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}>
            <h2 className={s.question}>Analyse IA en cours…</h2>
            <p className={s.subtext}>
              Optimisation des quantités<span className={s.loadingDots}><span>.</span><span>.</span><span>.</span></span>
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ──────── RESULT ──────── */
  if (phase === 'result') {
    if (submitted) {
      return (
        <div className={s.shell}>
          <div className={s.main} style={{ overflowY: 'auto', paddingTop: 24, paddingBottom: 32 }}>
            <motion.div className={s.stepWrap}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}>
              <div className={s.confirmIcon}>✓</div>
              <h2 className={s.question}>Merci {data.client.firstName || 'à vous'} !</h2>
              <p className={s.subtext} style={{ fontSize: 17, lineHeight: 1.6 }}>
                Votre demande a été reçue.<br />
                Notre équipe vous contactera sous peu
                {data.client.phone ? <> au <strong>{data.client.phone}</strong></> : ''}.
              </p>
              <button
                className={s.ctaBtn}
                style={{ marginTop: 24 }}
                onClick={() => {
                  resetForm();
                  setPhase('intro');
                  setSubmitted(false);
                  setIntroStep('cta');
                  setIntroName('');
                  setIntroPhone('');
                }}
              >
                Terminer
              </button>
            </motion.div>
          </div>
        </div>
      );
    }

    return (
      <div className={s.shell}>
        <div className={s.main} style={{ overflowY: 'auto', paddingTop: 24, paddingBottom: 32 }}>
          <motion.div className={s.stepWrap}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}>
            <h2 className={s.question}>Votre estimation personnalisée</h2>
            <div className={s.badge}>Votre configuration est cohérente ✔</div>

            <div className={s.resultCard}>
              <ResultRow label="Adresse" value={data.address?.formatted_address || '—'} onEdit={() => { setEditFromResult(0); setPhase('form'); setStep(0); }} />
              {buildingSuperficie && (
                <ResultRow label="Superficie" value={`${Math.round(sqmToSqft(buildingSuperficie))} pi²`} />
              )}
              {buildingPerimetre && (
                <ResultRow label="Périmètre" value={`${Math.round(buildingPerimetre * 3.28084)} pi`} />
              )}
              <ResultRow label="Couverture" value={COVERAGE_FR[data.coverageType || ''] || data.coverageType || '—'} onEdit={() => { setEditFromResult(3); setPhase('form'); setStep(3); }} />
              <ResultRow label="Pente" value={SLOPE_PITCH[data.slope || ''] || data.slope || '—'} onEdit={() => { setEditFromResult(3); setPhase('form'); setStep(3); }} />
              <ResultRow label="Produit" value={`${data.product?.name} – ${data.color}`} onEdit={() => { setEditFromResult(3); setPhase('form'); setStep(3); }} />
              
              <ResultRow label="Client" value={`${data.client.firstName} ${data.client.lastName}`} onEdit={() => { setEditFromResult(4); setPhase('form'); setStep(4); }} last />
            </div>

            {/* Matrix-based estimate (primary) */}
            {matrixEstimate && (
              <div style={{ width: '100%', marginTop: 16 }}>
                <div className={s.estimationBox}>
                <div className={s.estimationAmount}>
                    {fmt(matrixEstimate.price_per_sqft_low * matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff)} — {fmt(matrixEstimate.price_per_sqft_high * matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff)}
                  </div>
                  <div className={s.estimationNote}>
                    Superficie au sol : {Math.round(matrixEstimate.footprint_sqft).toLocaleString('fr-CA')} pi² · Surface réelle : {Math.round(matrixEstimate.footprint_sqft * matrixEstimate.slope_coeff).toLocaleString('fr-CA')} pi² · {matrixEstimate.price_per_sqft_low.toFixed(2)}$ à {matrixEstimate.price_per_sqft_high.toFixed(2)}$/pi²
                  </div>
                </div>
              </div>
            )}

            {/* Dynasty total + collapsible detail (secondary/admin) */}
            {dynastyQuote && !matrixEstimate && (
              <div style={{ width: '100%', marginTop: 16 }}>
                <div className={s.estimationBox}>
                  <div className={s.estimationAmount}>
                    {fmt(dynastyQuote.total_final)}
                  </div>
                  <div className={s.estimationNote}>
                    Incluant TPS + TVQ • {dynastyQuote.lines.length} postes
                    {dynastyQuote.low_confidence && ' • Vérification additionnelle recommandée'}
                  </div>
                </div>
              </div>
            )}

            {/* Legacy estimation fallback */}
            {!dynastyQuote && !matrixEstimate && estimation && (
              <div className={s.estimationBox}>
                <div className={s.estimationAmount}>
                  {fmt(estimation.low_estimate)} — {fmt(estimation.high_estimate)}
                </div>
                <div className={s.estimationNote}>
                  Estimation préliminaire basée sur les informations fournies.
                </div>
              </div>
            )}

            {dynastyQuote && (() => {
              // Generate composite satellite image with polygons for download PDFs
              const getCompositeSat = async () => {
                if (satDataUrl && satCenterRef.current && buildingGeoJson) {
                  try {
                    return await compositeMapWithPolygons(
                      satDataUrl, satCenterRef.current.lat, satCenterRef.current.lng,
                      satCenterRef.current.zoom, buildingGeoJson, buildingLotGeojson, polygonAdjustments,
                    );
                  } catch { /* fallback */ }
                }
                return satDataUrl;
              };
              const buildingCtx: BuildingData = {
                geojson: buildingGeoJson,
                lotGeojson: buildingLotGeojson,
                superficie: buildingSuperficie,
                perimetre: buildingPerimetre,
                largeur: buildingLargeur,
                profondeur: buildingProfondeur,
                noLot: buildingNoLot,
                slopeCategory: dynastyQuote.slope_category,
                roofType: dynastyQuote.roof_type,
                confidence: dynastyQuote.confidence,
                productName: data.product?.name || '',
                productBrand: data.product?.brand || '',
                colorName: data.color,
                coverageType: data.coverageType || '',
                satImageDataUrl: satDataUrl, // placeholder, will be replaced
              };
              const pdfCtx = {
                clientName: `${data.client.firstName} ${data.client.lastName}`,
                address: data.address?.formatted_address || '',
                product: data.product?.name || '',
                color: data.color,
                quote: dynastyQuote,
                building: buildingCtx,
              };

              const formatDownloadFilenameBase = (seq: number) => {
                const addrRaw = data.address?.formatted_address || '';
                const addrParts = addrRaw.split(',').map((part: string) => part.trim()).filter(Boolean);
                const streetAndCity = addrParts.slice(0, 2).join(', ').toUpperCase();
                return `VB_${String(seq).padStart(4, '0')}_${streetAndCity}`.replace(/[/\\?%*:|"<>]/g, '');
              };

              const resolveDownloadSeq = async (): Promise<number> => {
                if (submissionSeqRef.current >= 2000) return submissionSeqRef.current;
                try {
                  const { data: seqRows } = await supabase
                    .from('soumissions')
                    .select('seq_number')
                    .order('seq_number', { ascending: false })
                    .limit(1);
                  const lastSeq = seqRows?.[0]?.seq_number ?? 1999;
                  const nextSeq = Number.isFinite(lastSeq) ? Math.max(2000, lastSeq + 1) : 2000;
                  submissionSeqRef.current = nextSeq;
                  return nextSeq;
                } catch {
                  return 2000;
                }
              };

              const generateWithComposite = async (genFn: (ctx: typeof pdfCtx & { pdfFilenameBase: string; referenceId: string }) => Promise<void> | void) => {
                const [compositeUrl, resolvedSeq] = await Promise.all([getCompositeSat(), resolveDownloadSeq()]);
                const refId = formatDownloadFilenameBase(resolvedSeq);
                const ctxWithComposite = {
                  ...pdfCtx,
                  building: { ...buildingCtx, satImageDataUrl: compositeUrl },
                  pdfFilenameBase: refId,
                  referenceId: refId,
                };
                await genFn(ctxWithComposite);
              };
              {/* PDF download buttons hidden from client view */}
              return null;
            })()}

            <button className={s.ctaBtn} onClick={submit} disabled={submitting}>
              {submitting ? 'Envoi…' : 'Continuer →'}
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ──────── FORM ──────── */
  return (
    <div className={s.shell}>
      {/* Header */}
      <div className={s.header}>
        <img src={vbLogo} alt="Toitures VB" style={{ height: 20 }} />
        <button className={s.quitBtn} onClick={() => { setPhase('intro'); }}>Quitter</button>
      </div>

      {/* Progress */}
      <div className={s.progressWrap}>
        <div className={s.progressTrack}>
          <div className={s.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <div className={s.progressLabel}>
          {progress >= 86 && <span className={s.almostDone}>Plus que {STEP_LABELS.length - step} étape{STEP_LABELS.length - step > 1 ? 's' : ''}</span>}
        </div>
      </div>

      {/* Radar — dims when globe is active or house is shown */}
      <div className={`${s.radarWrap} ${isAddressStep ? s.radarDimmed : ''}`}
        style={radarPulse && !isAddressStep ? { } : undefined}
      >
        <div className={s.radarCircle} style={radarPulse && !isAddressStep ? { animation: 'none', transform: 'scale(1.08)', opacity: 1, transition: 'all 0.3s' } : {}}>
          <div className={s.radarCircle2}><div className={s.radarCircle3} /></div>
        </div>
        <div className={s.radarSweep} />
        <div className={s.radarDot} />

        {/* Globe — only rendered during address step */}
        <div className={`${s.globeContainer} ${isAddressStep ? s.globeVisible : ''}`}>
          <Globe
            active={isAddressStep}
            searchQuery={isAddressStep ? globeSearchQuery : undefined}
            targetLatLng={isAddressStep ? globeTargetLatLng : null}
          />
        </div>
      </div>

      {/* Scan line */}
      <div className={`${s.scanLine} ${scanning ? s.scanLineActive : ''}`} />

      {/* Step content */}
      <div className={s.main}>
        <AnimatePresence mode="wait">
          <motion.div key={step}
            variants={pageVariants}
            initial="initial" animate="animate" exit="exit"
            transition={pageTrans}
            style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Nav (only back button when needed, CTA is in-step) */}
      {(step > 0 || editFromResult !== null) && (
        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-start' }}>
          <button className={s.ctaBtnSecondary} onClick={goPrev}>
            {editFromResult !== null ? '← Annuler la modification' : '← Retour'}
          </button>
        </div>
      )}

      {/* Contact footer */}
      <VBContactFooter
        onSmsHandoff={handleSmsHandoff}
        smsLoading={smsHandoffLoading}
        showSms={phase === 'form' && !!(introPhone || data.client.phone)}
        smsGlow={smsGlow}
      />

      {/* Desktop SMS popup */}
      <AnimatePresence>
        {showDesktopSmsPopup && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24,
            }}
            onClick={() => setShowDesktopSmsPopup(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'linear-gradient(135deg, hsl(260 30% 16%), hsl(240 20% 12%))',
                border: '1px solid hsl(260 40% 30%)',
                borderRadius: 16, padding: '32px 28px', maxWidth: 380,
                textAlign: 'center', color: '#fff',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                Disponible sur mobile uniquement
              </h3>
              <p style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.6, marginBottom: 20 }}>
                La conversation par texto est disponible uniquement depuis un téléphone mobile.
                Ouvrez ce formulaire sur votre cellulaire pour utiliser cette fonctionnalité.
              </p>
              <button
                onClick={() => setShowDesktopSmsPopup(false)}
                style={{
                  background: 'linear-gradient(135deg, hsl(280 80% 55%), hsl(200 80% 55%))',
                  border: 'none', borderRadius: 10, padding: '12px 32px',
                  color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer',
                }}
              >
                Compris
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {microMsg && (
          <motion.div className={s.microToast}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.2 }}>
            {microMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress drawer */}
      <ProgressDrawer
        phase={phase}
        introName={introName}
        introPhone={introPhone}
        addressText={addressText}
        workType={data.workType ?? null}
        buildingType={(data as any).buildingType ?? null}
        onBuildingTypeChange={(val) => updateData({ buildingType: val } as any)}
        onNavigateToStep={(formStep) => {
          if (phase === 'form') {
            setStep(formStep);
          }
        }}
        buildingMetrics={buildingSuperficie ? {
          superficieM2: buildingSuperficie,
          perimetreM: buildingPerimetre,
          largeurM: buildingLargeur,
          profondeurM: buildingProfondeur,
          noLot: buildingNoLot,
        } : undefined}
      />
    </div>
  );
};

export default ImmersiveWizard;
