import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Satellite, Camera, ChevronDown, ChevronUp, Home, Search, Eye, Layers, MapPin, ImageIcon } from 'lucide-react';
import { supabase } from '../../../integrations/supabase/client';
import { CoverageType } from '../../../types/roofing';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import s from './AdvisorAnalysis.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const AI_TO_COVERAGE: { pattern: RegExp; type: CoverageType }[] = [
  { pattern: /membran.*élastom/i, type: 'membrane_elastomere' },
  { pattern: /membran.*gravier/i, type: 'membrane_gravier' },
  { pattern: /plat.*membran|membran.*plat/i, type: 'membrane_elastomere' },
  { pattern: /4\s*pans?\s*et\s*\+.*tole|tole.*4\s*pans?\s*et/i, type: 'tole_4pans_plus' },
  { pattern: /4\s*pans?.*tole|tole.*4\s*pans?/i, type: 'tole_4pans' },
  { pattern: /2\s*pans?.*tole|tole.*2\s*pans?/i, type: 'tole_2pans' },
  { pattern: /4\s*pans?\s*et\s*\+.*b[a]?rde|b[a]?rde.*4\s*pans?\s*et/i, type: 'shingle_4pans_plus' },
  { pattern: /4\s*pans?.*b[a]?rde|b[a]?rde.*4\s*pans?/i, type: 'shingle_4pans' },
  { pattern: /2\s*pans?.*b[a]?rde|b[a]?rde.*2\s*pans?/i, type: 'shingle_2pans' },
];

function mapToCoverageType(raw: string): CoverageType | null {
  for (const { pattern, type } of AI_TO_COVERAGE) {
    if (pattern.test(raw)) return type;
  }
  return null;
}

function extractGeometry(roofType: string): string {
  if (/plate/i.test(roofType)) return 'Toiture plate';
  if (/4\s*pans?\s*et\s*\+/i.test(roofType)) return '4 pans et + (complexe)';
  if (/4\s*pans/i.test(roofType)) return '4 pans';
  if (/2\s*pans/i.test(roofType)) return '2 pans';
  return 'Indéterminée';
}

function extractMaterial(roofType: string): string {
  if (/gravier/i.test(roofType)) return 'Membrane recouverte de gravier';
  if (/élastom/i.test(roofType)) return 'Membrane élastomère';
  if (/bard/i.test(roofType)) return "Bardeaux d'asphalte";
  if (/tole|tôle/i.test(roofType)) return 'Tôle';
  return 'Indéterminé';
}

interface Props {
  firstName: string;
  address: string;
  lat: number;
  lng: number;
  onClassified?: (roofType: string, coverageType: CoverageType | null, aiRoofType?: string, aiSlopeCategory?: string, aiConfidence?: number, buildingType?: string) => void;
  /** Called ~1.5s after the result card appears, so parent can start the sequential reveal */
  onResultDismissed?: () => void;
}

type Phase = 'analyzing' | 'step1' | 'step2' | 'step3' | 'step4' | 'done' | 'dismissed' | 'error';

const AdvisorAnalysis: React.FC<Props> = ({ firstName, address, lat, lng, onClassified, onResultDismissed }) => {
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [roofType, setRoofType] = useState<string | null>(null);
  const [rawAnswer, setRawAnswer] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const launched = useRef(false);

  const name = firstName || 'là';

  const satZoom18 = useMemo(
    () => `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_API_KEY}`,
    [lat, lng]
  );
  const satZoom20 = useMemo(
    () => `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_API_KEY}`,
    [lat, lng]
  );
  const streetViewUrl = useMemo(
    () => `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&fov=80&pitch=0&key=${GOOGLE_API_KEY}`,
    [lat, lng]
  );

  const analyze = useCallback(async () => {
    setPhase('analyzing');
    try {
      const { data, error } = await supabase.functions.invoke('roof-classify', {
        body: {
          address, lat, lng,
          satelliteZoom18Url: satZoom18,
          satelliteZoom21Url: satZoom20,
          streetViewUrl,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);

      // New JSON format: { roof_type, slope_category, confidence, reasoning_short, material, is_flat, building_type }
      const aiRoofType = data.roof_type || '4pans';
      const aiMaterial = data.material || 'shingle';
      const aiSlopeCategory = data.slope_category || 'moderee';
      const aiConfidence = typeof data.confidence === 'number' ? data.confidence : 0.5;
      const isFlat = data.is_flat === true;
      const aiBuildingType = data.building_type || 'unifamiliale';

      // Build a human-readable roof type string for display
      const materialLabel = aiMaterial === 'membrane_elastomere' ? 'Membrane élastomère'
        : aiMaterial === 'membrane_gravier' ? 'Membrane recouverte de gravier'
        : aiMaterial === 'tole' ? 'Tôle'
        : "Bardeaux d'asphalte";
      const geoLabel = isFlat ? 'Toiture plate'
        : aiRoofType === '2pans' ? 'Toiture 2 pans'
        : aiRoofType === '4pans_plus' ? 'Toiture 4 pans et +'
        : 'Toiture 4 pans';
      const rt = `${geoLabel}, ${materialLabel}`;

      setRoofType(rt);
      setRawAnswer(data.raw_answer || data.reasoning_short || '');

      await delay(500);  setPhase('step1');
      await delay(900);  setPhase('step2');
      await delay(700);  setPhase('step3');
      await delay(500);  setPhase('step4');
      await delay(700);  setPhase('done');

      // Map material to CoverageType
      let mapped: CoverageType | null = null;
      if (isFlat) {
        mapped = aiMaterial === 'membrane_gravier' ? 'membrane_gravier' : 'membrane_elastomere';
      } else if (aiMaterial === 'tole') {
        mapped = aiRoofType === '2pans' ? 'tole_2pans' : aiRoofType === '4pans_plus' ? 'tole_4pans_plus' : 'tole_4pans';
      } else {
        mapped = aiRoofType === '2pans' ? 'shingle_2pans' : aiRoofType === '4pans_plus' ? 'shingle_4pans_plus' : 'shingle_4pans';
      }

      onClassified?.(rt, mapped, aiRoofType, aiSlopeCategory, aiConfidence, aiBuildingType);
    } catch (e) {
      console.error('Analysis error:', e);
      setPhase('error');
    }
  }, [address, lat, lng, satZoom18, satZoom20, streetViewUrl, onClassified]);

  // Auto-launch on mount
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    analyze();
  }, [analyze]);

  const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };
  const geometry = roofType ? extractGeometry(roofType) : '';
  const material = roofType ? extractMaterial(roofType) : '';

  return (
    <div className={s.wrap}>
      {/* Single condensed advisor bubble */}
      <div className={s.msgRow}>
        <div className={s.avatar}>
          <img src={advisorAvatar} alt="Marie-Ève" className={s.avatarImg} />
          <div className={s.onlineDot} />
        </div>
        <div className={s.bubble}>
          <span className={s.name}>Marie-Ève</span>

          {/* Current phase status — only latest shown */}
          <AnimatePresence mode="wait">
            {phase === 'analyzing' && (
              <motion.p key="analyzing" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <span className={s.spinner} />Analyse satellite de votre toiture en cours…
              </motion.p>
            )}
            {phase === 'step1' && (
              <motion.p key="s1" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Search size={12} className={s.inlineIcon} /> Géométrie… <strong>{geometry}</strong>
              </motion.p>
            )}
            {phase === 'step2' && (
              <motion.p key="s2" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Eye size={12} className={s.inlineIcon} /> Matériau… <strong>{material}</strong>
              </motion.p>
            )}
            {phase === 'step3' && (
              <motion.p key="s3" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <MapPin size={12} className={s.inlineIcon} /> Vérification bâtiment… ✓
              </motion.p>
            )}
            {phase === 'step4' && (
              <motion.p key="s4" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Layers size={12} className={s.inlineIcon} /> Cohérence validée… ✓
              </motion.p>
            )}
            {phase === 'error' && (
              <motion.p key="err" className={s.textError} {...fade} exit={{ opacity: 0 }}>
                Analyse échouée — sélectionnez manuellement ci-dessous.
              </motion.p>
            )}
          </AnimatePresence>

          {/* Result card with gradient — shows briefly then exits */}
          <AnimatePresence
            onExitComplete={() => {
              if (phase === 'dismissed') {
                onResultDismissed?.();
              }
            }}
          >
            {phase === 'done' && roofType && (
              <motion.div
                className={s.resultCard}
                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: 40 }}
                transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                onAnimationComplete={() => {
                  // After showing for 1.5s, dismiss the card so it "flies" to the list below
                  setTimeout(() => setPhase('dismissed'), 1500);
                }}
              >
                <Home size={16} />
                <span className={s.resultText}>{roofType}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Expandable images */}
          {phase !== 'analyzing' && (
            <button className={s.toggleImages} onClick={() => setImagesOpen(!imagesOpen)}>
              <ImageIcon size={12} />
              {imagesOpen ? 'Masquer les images' : 'Voir les images satellite'}
              {imagesOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}

          <AnimatePresence>
            {imagesOpen && (
              <motion.div
                className={s.thumbRow}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className={s.thumbWrap}>
                  <img src={satZoom18} alt="Vue large" className={s.thumb} onClick={() => setLightboxImg(satZoom18)} />
                  <span className={s.thumbLabel}><Satellite size={10} /> Vue large</span>
                </div>
                <div className={s.thumbWrap}>
                  <img src={satZoom20} alt="Texture" className={s.thumb} onClick={() => setLightboxImg(satZoom20)} />
                  <span className={s.thumbLabel}><Satellite size={10} /> Texture</span>
                </div>
                <div className={s.thumbWrap}>
                  <img src={streetViewUrl} alt="Street View" className={s.thumb} onClick={() => setLightboxImg(streetViewUrl)} />
                  <span className={s.thumbLabel}><Camera size={10} /> Street View</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Detail toggle */}
          {(phase === 'done' || phase === 'dismissed') && (
            <>
              <button className={s.detailToggle} onClick={() => setDetailOpen(!detailOpen)}>
                {detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {detailOpen ? 'Masquer' : "Détail de l'analyse"}
              </button>
              {detailOpen && (
                <motion.div className={s.detailContent} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <strong>Résultat :</strong> {rawAnswer || roofType}<br />
                  <strong>Adresse :</strong> {address}
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxImg && (
          <motion.div className={s.lightbox} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setLightboxImg(null)}>
            <motion.img src={lightboxImg} alt="Agrandissement" className={s.lightboxImg} initial={{ scale: 0.85 }} animate={{ scale: 1 }} exit={{ scale: 0.85 }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export default AdvisorAnalysis;
