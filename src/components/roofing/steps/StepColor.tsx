import React from 'react';
import { useFormContext } from '../../../context/FormContext';
import s from './steps.module.css';

// Dynasty (IKO)
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

// Cambridge (IKO)
import swCambDualBlack from '../../../assets/cambridge-colors/dual-black.jpg';
import swCambWeatherwood from '../../../assets/cambridge-colors/weatherwood.jpg';
import swCambCharcoalGrey from '../../../assets/cambridge-colors/charcoal-grey.jpg';
import swCambDriftwood from '../../../assets/cambridge-colors/driftwood.jpg';
import swCambDualGrey from '../../../assets/cambridge-colors/dual-grey.jpg';
import swCambDualBrown from '../../../assets/cambridge-colors/dual-brown.jpg';
import swCambEarthtoneCedar from '../../../assets/cambridge-colors/earthtone-cedar.jpg';
import swCambHarvardSlate from '../../../assets/cambridge-colors/harvard-slate.jpg';

// Royal Estate (IKO)
import swREHarvestSlate from '../../../assets/royal-estate-colors/harvest-slate.jpg';
import swREMountainSlate from '../../../assets/royal-estate-colors/mountain-slate.jpg';
import swREShadowSlate from '../../../assets/royal-estate-colors/shadow-slate.jpg';
import swRETaupeSlate from '../../../assets/royal-estate-colors/taupe-slate.jpg';

// BP Signature
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

// BP Mystique
import swMysGrisArdoise from '../../../assets/bp-mystique-colors/gris-ardoise.png';
import swMysCedreRustique from '../../../assets/bp-mystique-colors/cedre-rustique.png';
import swMysBrunClassique from '../../../assets/bp-mystique-colors/brun-classique.png';
import swMysBoisChampetre from '../../../assets/bp-mystique-colors/bois-champetre.png';
import swMysArdoiseAntique from '../../../assets/bp-mystique-colors/ardoise-antique.png';
import swMysBrun2tons from '../../../assets/bp-mystique-colors/brun-2tons.png';
import swMysNoir2tons from '../../../assets/bp-mystique-colors/noir-2tons.png';
import swMysBrumeMatinale from '../../../assets/bp-mystique-colors/brume-matinale.jpg';
import swMysSangria from '../../../assets/bp-mystique-colors/sangria.jpg';

// BP Vangard
import swVanNoirCeleste from '../../../assets/bp-vangard-colors/noir-celeste.png';
import swVanGrisArgente from '../../../assets/bp-vangard-colors/gris-argente.png';
import swVanGrisLunaire from '../../../assets/bp-vangard-colors/gris-lunaire.png';
import swVanGalet from '../../../assets/bp-vangard-colors/galet.png';
import swVanBrunAutomnal from '../../../assets/bp-vangard-colors/brun-automnal.png';

// BP Dakota
import swDakGrisArdoise from '../../../assets/bp-dakota-colors/gris-ardoise.png';
import swDakBrun2tons from '../../../assets/bp-dakota-colors/brun-2tons.png';
import swDakNoir2tons from '../../../assets/bp-dakota-colors/noir-2tons.png';

const COLOR_SWATCH_MAP: Record<string, Record<string, string>> = {
  Dynasty: {
    'Atlantic Blue': swAtlanticBlue, 'Glacier': swGlacier, 'Granite Black': swGraniteBlack,
    'Graphite Black': swGraphiteBlack, 'Matte Black': swMatteBlack,
    'Shadow Brown': swShadowBrown, 'Summit Grey': swSummitGrey,
    'Cornerstone Weatherwood': swCornerstoneWeatherwood, 'Biscayne': swBiscayne,
    'Monaco Red': swMonacoRed, 'Frostone Grey': swFrostoneGrey, 'Emerald Green': swEmeraldGreen,
    'Driftshake': swDriftshake, 'Brownstone': swBrownstone,
    'Sentinel Slate': swSentinelSlate, 'Olde Style Weatherwood': swOldeStyleWeatherwood,
  },
  Nordic: {
    'Granite Black': swGraniteBlack, 'Shadow Brown': swShadowBrown, 'Summit Grey': swSummitGrey,
    'Glacier': swGlacier, 'Driftshake': swDriftshake, 'Olde Style Weatherwood': swOldeStyleWeatherwood,
    'Brownstone': swBrownstone, 'Cornerstone Weatherwood': swCornerstoneWeatherwood, 'Frostone Grey': swFrostoneGrey,
  },
  Cambridge: {
    'Dual Black': swCambDualBlack, 'Weatherwood': swCambWeatherwood, 'Charcoal Grey': swCambCharcoalGrey,
    'Driftwood': swCambDriftwood, 'Dual Grey': swCambDualGrey, 'Dual Brown': swCambDualBrown,
    'Earthtone Cedar': swCambEarthtoneCedar, 'Harvard Slate': swCambHarvardSlate,
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
};

const StepColor: React.FC = () => {
  const { data, updateData } = useFormContext();
  const colors = data.product?.colors || [];
  const productSwatches = data.product ? (COLOR_SWATCH_MAP[data.product.name] || {}) : {};

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Couleur</h2>
      {!data.product ? (
        <p className={s.stepDesc}>Sélectionnez un produit d'abord.</p>
      ) : (
        <div className={s.swatchGroup}>
          {colors.map(c => {
            const swatchImg = productSwatches[c];
            return (
              <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`${s.swatch} ${data.color === c ? s.swatchSelected : ''}`}
                  style={swatchImg
                    ? { backgroundImage: `url(${swatchImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: '#999' }
                  }
                  onClick={() => updateData({ color: c })}
                  aria-label={c}
                />
                <span className={s.swatchLabel}>{c}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StepColor;
