import React, { useEffect, useRef, useState } from 'react';
import { useFormContext } from '../../../context/FormContext';
import s from './steps.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyBZ3keSLQyDu_J7SR28ONt3B3jUAO1GwO4';

const StepAddress: React.FC = () => {
  const { data, updateData } = useFormContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [inputValue, setInputValue] = useState(data.address?.formatted_address || '');
  const confirmedRef = useRef(data.address?.formatted_address || '');

  useEffect(() => {
    if (!GOOGLE_API_KEY) return;
    if ((window as any).google?.maps?.places) {
      setLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => setLoaded(true);
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
    // MutationObserver to catch when pac-container is added to DOM
    const observer = new MutationObserver(() => fixMobileTouch());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loaded || !inputRef.current) return;
    const autocomplete = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'ca' },
      fields: ['formatted_address', 'place_id', 'geometry'],
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        setInputValue(place.formatted_address);
        confirmedRef.current = place.formatted_address;
        updateData({
          address: {
            formatted_address: place.formatted_address,
            place_id: place.place_id || '',
            lat: place.geometry?.location?.lat() || 0,
            lng: place.geometry?.location?.lng() || 0,
          },
        });
      }
    });
  }, [loaded, updateData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (val !== confirmedRef.current) {
      updateData({ address: null });
    }
  };

  const isValid = !!data.address;

  return (
    <div className={s.stepContainer}>
      <h2 className={s.stepTitle}>Adresse</h2>
      <p className={s.stepDesc}>Sélectionnez l'adresse dans la liste Google Maps</p>
      <div className={`${s.fieldGroup} ${isValid ? s.fieldDone : ''}`}>
        <label className={s.label}>Adresse *</label>
        <div className={s.inputWrap}>
          <input
            ref={inputRef}
            className={`${s.input} ${inputValue && !isValid ? s.inputError : ''}`}
            value={inputValue}
            onChange={handleChange}
            placeholder="Commencez à taper votre adresse..."
          />
          {isValid && <span className={s.inlineCheck}>✓</span>}
        </div>
        {inputValue && !isValid && (
          <span className={s.errorText}>Veuillez sélectionner une adresse dans la liste</span>
        )}
      </div>
    </div>
  );
};

export default StepAddress;
