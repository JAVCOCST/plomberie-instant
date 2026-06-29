import React, { useState, useMemo } from 'react';
import { useFormContext } from '../../context/FormContext';
import {
  COMPLEXITY_FACTORS,
  SLOPE_FACTORS,
  computeEstimation,
  sqmToSqft,
} from '../../types/roofing';
import { supabase } from '../../integrations/supabase/client';
import Stepper from './Stepper';
import HouseBuilder from './HouseBuilder';
import RoofToast, { showToast } from './RoofToast';
import StepClient from './steps/StepClient';
import StepAddress from './steps/StepAddress';
import StepCoverage from './steps/StepCoverage';
import StepComplexity from './steps/StepComplexity';
import StepSlope from './steps/StepSlope';
import StepArea from './steps/StepArea';
import StepProduct from './steps/StepProduct';
import StepColor from './steps/StepColor';
import s from './FormWizard.module.css';

const STEP_NAMES = [
  'Client', 'Adresse', 'Couverture', 'Complexité',
  'Inclinaison', 'Superficie', 'Produit', 'Couleur',
];

const trackConversion = () => {
  if (typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', 'conversion', {
      send_to: 'AW-17958279418',
    });
  }
};
const FormWizard: React.FC = () => {
  const { data, step, setStep } = useFormContext();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const areaSqft = data.areaUnit === 'sqm' ? sqmToSqft(data.area) : data.area;

  const estimation = useMemo(() => {
    if (!data.product || !data.complexity || !data.slope || areaSqft <= 0) return null;
    return computeEstimation(
      areaSqft,
      data.product.price_per_sqft,
      COMPLEXITY_FACTORS[data.complexity],
      SLOPE_FACTORS[data.slope]
    );
  }, [data.product, data.complexity, data.slope, areaSqft]);

  const validateStep = (): boolean => {
    switch (step) {
      case 0: {
        const { firstName, lastName, email, phone } = data.client;
        if (!firstName.trim() || !lastName.trim()) { showToast('Prénom et nom requis', 'error'); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Courriel invalide', 'error'); return false; }
        if (phone.trim().length < 7) { showToast('Téléphone invalide', 'error'); return false; }
        return true;
      }
      case 1: return data.address ? true : (showToast('Adresse requise', 'error'), false);
      case 2: return data.coverageType ? true : (showToast('Sélectionnez un type', 'error'), false);
      case 3: return data.complexity ? true : (showToast('Sélectionnez la complexité', 'error'), false);
      case 4: return data.slope ? true : (showToast('Sélectionnez l\'inclinaison', 'error'), false);
      case 5: return areaSqft > 0 ? true : (showToast('Superficie requise', 'error'), false);
      case 6: return data.product ? true : (showToast('Sélectionnez un produit', 'error'), false);
      case 7: return data.color ? true : (showToast('Sélectionnez une couleur', 'error'), false);
      default: return true;
    }
  };

  const next = () => {
    if (!validateStep()) return;
    if (step < STEP_NAMES.length - 1) setStep(step + 1);
  };

  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const submit = async () => {
    if (!validateStep() || !estimation) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.from('soumissions').insert({
        first_name: data.client.firstName,
        last_name: data.client.lastName,
        email: data.client.email,
        phone: data.client.phone,
        formatted_address: data.address?.formatted_address ?? null,
        place_id: data.address?.place_id ?? null,
        lat: data.address?.lat ?? null,
        lng: data.address?.lng ?? null,
        coverage_type: data.coverageType,
        complexity: data.complexity,
        slope: data.slope,
        area_sqft: areaSqft,
        area_input: data.area,
        area_unit: data.areaUnit,
        product_id: data.product!.id,
        product_name: data.product!.name,
        product_brand: data.product!.brand,
        color: data.color,
        price_per_sqft: data.product!.price_per_sqft,
        subtotal: estimation.subtotal,
        mobilisation: estimation.mobilisation,
        low_estimate: estimation.low_estimate,
        high_estimate: estimation.high_estimate,
        complexity_factor: estimation.factors.complexity,
        slope_factor: estimation.factors.slope,
        user_agent: navigator.userAgent,
        page_url: window.location.href,
        utm: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
        contact_preference: data.contactPreference,
      });
      if (error) throw error;
      trackConversion();
      window.location.href = 'https://www.toituresvb.ca/soumission/merci';
    } catch (err) {
      showToast('Erreur lors de l\'envoi. Réessayez.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

  if (submitted) {
    return (
      <div className={s.wizard}>
        <div className={s.stepContent}>
          <div className={s.confirmation}>
            <div className={s.confirmIcon}>✓</div>
            <div className={s.confirmTitle}>Merci !</div>
            <p className={s.confirmText}>
              Votre demande a été envoyée avec succès.<br />
              Nous vous contactons sous 24 heures.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLastStep = step === STEP_NAMES.length - 1;
  const showSummary = isLastStep && estimation;

  const steps = [
    <StepClient />, <StepAddress />, <StepCoverage />, <StepComplexity />,
    <StepSlope />, <StepArea />, <StepProduct />, <StepColor />,
  ];

  return (
    <div className={s.wizard}>
      <h1 className={s.wizardTitle}>Formulaire de demande de soumission toiture</h1>
      <HouseBuilder current={step} total={STEP_NAMES.length} />
      <Stepper steps={STEP_NAMES} current={step} />

      <div className={s.stepContent}>
        {steps[step]}

        {showSummary && estimation && (
          <div style={{ marginTop: 'var(--spacing--32)' }}>
            <div className={s.summary}>
              <div className={s.summaryRow}>
                <span className={s.summaryLabel}>Client</span>
                <span className={s.summaryValue}>{data.client.firstName} {data.client.lastName}</span>
              </div>
              <div className={s.summaryRow}>
                <span className={s.summaryLabel}>Produit</span>
                <span className={s.summaryValue}>{data.product?.name} – {data.color}</span>
              </div>
              <div className={s.summaryRow}>
                <span className={s.summaryLabel}>Superficie</span>
                <span className={s.summaryValue}>{Math.round(areaSqft).toLocaleString()} pi²</span>
              </div>
            </div>
            <div className={s.estimationBox}>
              <div className={s.estimationAmount}>
                Estimation : {fmt(estimation.low_estimate)} à {fmt(estimation.high_estimate)}
              </div>
              <div className={s.estimationNote}>
                Estimation préliminaire basée sur les informations fournies.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={s.navButtons}>
        {step > 0 ? (
          <button className={s.btnSecondary} onClick={prev} type="button">Précédent</button>
        ) : <div />}
        {isLastStep ? (
          <button className={s.btnPrimary} onClick={submit} disabled={submitting} type="button">
            {submitting ? 'Envoi...' : 'Soumettre la demande'}
          </button>
        ) : (
          <button className={s.btnPrimary} onClick={next} type="button">Suivant</button>
        )}
      </div>

      <RoofToast />
    </div>
  );
};

export default FormWizard;
