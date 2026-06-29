import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Satellite, Camera, Search, Home, ArrowRight } from 'lucide-react';
import { supabase } from '../../../integrations/supabase/client';
import s from './RoofPreview.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const ROOF_TYPES = [
  "Toiture plates, membranes élastomere",
  "Toiture plate, Membrane recouverte de gravier",
  "Toiture 4 pans, Bardeaux asphalte",
  "Toiture 2 pans, Brdeaux d'asphalte",
  "Toiture 4 pans et +, bardeaux d'asphalte",
  "Toiture 4 pans, Tole",
  "Toiture 2 pans, Tole",
  "Toiture 4 pans et +, Tole",
];

interface RoofPreviewProps {
  address: string;
  lat: number;
  lng: number;
  onConfirm: (roofType: string) => void;
}

const RoofPreview: React.FC<RoofPreviewProps> = ({ address, lat, lng, onConfirm }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [roofType, setRoofType] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

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

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('roof-classify', {
        body: {
          address,
          lat,
          lng,
          satelliteZoom18Url: satZoom18,
          satelliteZoom21Url: satZoom20,
          streetViewUrl,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const result = data?.roof_type || '';
      setRoofType(result);
      setSelectedType(result);
    } catch (e: any) {
      console.error('Roof classify error:', e);
      setError('Erreur lors de l\'analyse. Veuillez sélectionner manuellement.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className={s.wrap}>
      {/* Images */}
      <div className={s.imagesRow}>
        <div className={s.imageCard} onClick={() => setLightboxImg(satZoom20)}>
          <span className={s.imageCardLabel}><Satellite size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Satellite</span>
          <img src={satZoom20} alt="Vue satellite" className={s.imageCardImg} loading="lazy" />
        </div>
        <div className={s.imageCard} onClick={() => setLightboxImg(streetViewUrl)}>
          <span className={s.imageCardLabel}><Camera size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Street View</span>
          <img src={streetViewUrl} alt="Vue Street View" className={s.imageCardImg} loading="lazy" />
        </div>
      </div>

      {/* Analysis state */}
      {!roofType && !analyzing && !error && (
        <button
          className="ctaBtn"
          onClick={analyze}
          style={{
            padding: '16px 40px',
            background: 'linear-gradient(135deg, var(--imm-cta), hsl(35, 95%, 55%))',
            color: 'var(--imm-cta-text)',
            border: 'none',
            borderRadius: '100px',
            fontSize: '16px',
            fontWeight: 700,
            fontFamily: 'var(--imm-font)',
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          <Search size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />Analyser la toiture
        </button>
      )}

      {analyzing && (
        <div className={s.loader}>
          <div className={s.loaderSpinner} />
          <span className={s.loaderText}>Analyse de la toiture (vue satellite)…</span>
        </div>
      )}

      {error && (
        <p className={s.errorMsg}>{error}</p>
      )}

      {/* Result */}
      {(roofType || error) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}
        >
          {roofType && (
            <div className={s.resultBadge}>
              <span className={s.resultBadgeIcon}><Home size={22} /></span>
              <div>
                <div className={s.resultBadgeText}>{roofType}</div>
                <div className={s.resultBadgeNote}>Classification basée sur vue satellite. Vérifiez avec la vue Street View.</div>
              </div>
            </div>
          )}

          <select
            className={s.dropdown}
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
          >
            <option value="" disabled>Modifier le type de toiture…</option>
            {ROOF_TYPES.map(rt => (
              <option key={rt} value={rt}>{rt}</option>
            ))}
          </select>

          {selectedType && (
            <button
              onClick={() => onConfirm(selectedType)}
              style={{
                padding: '16px 40px',
                background: 'linear-gradient(135deg, var(--imm-cta), hsl(35, 95%, 55%))',
                color: 'var(--imm-cta-text)',
                border: 'none',
                borderRadius: '100px',
                fontSize: '16px',
                fontWeight: 700,
                fontFamily: 'var(--imm-font)',
                cursor: 'pointer',
                letterSpacing: '0.3px',
              }}
            >
              Confirmer et continuer →
            </button>
          )}
        </motion.div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxImg && (
          <motion.div
            className={s.lightbox}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxImg(null)}
          >
            <motion.img
              src={lightboxImg}
              alt="Agrandissement"
              className={s.lightboxImg}
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.85 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RoofPreview;
