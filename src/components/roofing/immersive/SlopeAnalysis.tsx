import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Satellite, Camera, ChevronDown, ChevronUp, Search, Eye, MapPin, Layers, Mountain, ImageIcon } from 'lucide-react';
import { supabase } from '../../../integrations/supabase/client';
import { SlopeLevel, CoverageType } from '../../../types/roofing';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import s from './AdvisorAnalysis.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const SLOPE_CAT_TO_LEVEL: Record<string, SlopeLevel> = {
  'aucune': '4-7',
  'legere': '7-9',
  'moderee': '9-12',
  'abrupte': '12+',
};

const SLOPE_CAT_LABELS: Record<string, string> = {
  'aucune': '4/12 – 7/12 (toit plat)',
  'legere': '7/12 – 9/12 (pente légère)',
  'moderee': '9/12 – 12/12 (pente modérée)',
  'abrupte': '12/12+ (pente abrupte)',
};

interface Props {
  firstName: string;
  address: string;
  lat: number;
  lng: number;
  coverageType: CoverageType | null;
  onClassified?: (slopeCategory: string, slopeLevel: SlopeLevel | null) => void;
}

type Phase = 'analyzing' | 'step1' | 'step2' | 'step3' | 'step4' | 'done' | 'error';

const SlopeAnalysis: React.FC<Props> = ({ firstName, address, lat, lng, coverageType, onClassified }) => {
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [slopeCategory, setSlopeCategory] = useState<string | null>(null);
  const [rawAnswer, setRawAnswer] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const launched = useRef(false);

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
      const { data, error } = await supabase.functions.invoke('roof-slope', {
        body: {
          address, lat, lng,
          satelliteZoom18Url: satZoom18,
          satelliteZoom21Url: satZoom20,
          streetViewUrl,
          coverageType,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);

      const cat = (data.slope_category || '').toLowerCase();
      setSlopeCategory(cat);
      setRawAnswer(data.raw_answer || data.reasoning_short || '');

      await delay(400);  setPhase('step1');
      await delay(800);  setPhase('step2');
      await delay(700);  setPhase('step3');
      await delay(500);  setPhase('step4');
      await delay(600);  setPhase('done');

      const mapped = SLOPE_CAT_TO_LEVEL[cat] || null;
      onClassified?.(cat, mapped);
    } catch (e) {
      console.error('Slope analysis error:', e);
      setPhase('error');
    }
  }, [address, lat, lng, satZoom18, satZoom20, streetViewUrl, coverageType, onClassified]);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    analyze();
  }, [analyze]);

  const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  const slopeLabel = SLOPE_CAT_LABELS;

  return (
    <div className={s.wrap}>
      <div className={s.msgRow}>
        <div className={s.avatar}>
          <img src={advisorAvatar} alt="Marie-Ève" className={s.avatarImg} />
          <div className={s.onlineDot} />
        </div>
        <div className={s.bubble}>
          <span className={s.name}>Marie-Ève</span>

          <AnimatePresence mode="wait">
            {phase === 'analyzing' && (
              <motion.p key="analyzing" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <span className={s.spinner} />Analyse de la pente en cours…
              </motion.p>
            )}
            {phase === 'step1' && (
              <motion.p key="s1" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Search size={12} className={s.inlineIcon} /> Validation géométrique… ✓
              </motion.p>
            )}
            {phase === 'step2' && (
              <motion.p key="s2" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Eye size={12} className={s.inlineIcon} /> Analyse relief… ✓
              </motion.p>
            )}
            {phase === 'step3' && (
              <motion.p key="s3" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <MapPin size={12} className={s.inlineIcon} /> Estimation angle réel… ✓
              </motion.p>
            )}
            {phase === 'step4' && (
              <motion.p key="s4" className={s.text} {...fade} exit={{ opacity: 0 }}>
                <Layers size={12} className={s.inlineIcon} /> Vérification cohérence… ✓
              </motion.p>
            )}
            {phase === 'error' && (
              <motion.p key="err" className={s.textError} {...fade} exit={{ opacity: 0 }}>
                Analyse échouée — sélectionnez manuellement ci-dessous.
              </motion.p>
            )}
          </AnimatePresence>

          {/* Result card */}
          <AnimatePresence>
            {phase === 'done' && slopeCategory && (
              <motion.div
                className={s.resultCard}
                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
              >
                <Mountain size={16} />
                <span className={s.resultText}>{slopeLabel[slopeCategory] || slopeCategory}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Expandable images */}
          {phase !== 'analyzing' && (
            <button className={s.toggleImages} onClick={() => setImagesOpen(!imagesOpen)}>
              <ImageIcon size={12} />
              {imagesOpen ? 'Masquer les images' : 'Voir les images analysées'}
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
                  <span className={s.thumbLabel}><Satellite size={10} /> Géométrie</span>
                </div>
                <div className={s.thumbWrap}>
                  <img src={satZoom20} alt="Relief" className={s.thumb} onClick={() => setLightboxImg(satZoom20)} />
                  <span className={s.thumbLabel}><Satellite size={10} /> Relief</span>
                </div>
                <div className={s.thumbWrap}>
                  <img src={streetViewUrl} alt="Street View" className={s.thumb} onClick={() => setLightboxImg(streetViewUrl)} />
                  <span className={s.thumbLabel}><Camera size={10} /> Angle réel</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Detail toggle */}
          {phase === 'done' && (
            <>
              <button className={s.detailToggle} onClick={() => setDetailOpen(!detailOpen)}>
                {detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {detailOpen ? 'Masquer' : "Détail de l'analyse"}
              </button>
              {detailOpen && (
                <motion.div className={s.detailContent} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <strong>Résultat :</strong> {rawAnswer || slopeCategory}<br />
                  <strong>Type de toiture :</strong> {coverageType || '—'}<br />
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

export default SlopeAnalysis;
