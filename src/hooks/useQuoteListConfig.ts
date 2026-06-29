// useQuoteListConfig — source unique pour les listes partagées entre
// /admin/products (Catalogue QuickBooks) et la soumission (Configuration des
// listes). Lecture/écriture sur soumissions table `quote_list_config` (ligne
// unique `id='default'`). À l'initialisation, migre les anciens caches
// localStorage des DEUX pages pour ne pas perdre ce que l'utilisateur avait
// déjà ajouté localement, puis efface ces caches pour qu'une suppression
// future ne soit pas "ressuscitée" par une vieille entrée locale.
//
// Realtime (postgres_changes) garde les deux pages synchronisées quand elles
// sont ouvertes en parallèle ; un anti-écho évite la boucle persist→echo.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const LISTS_ROW_ID = 'default';

// Cache local hérité du composant soumission.
const LEGACY_COMBINED_KEY = 'vb_quote_lists_config_v1';
// Caches locaux hérités de /admin/products.
const LEGACY_GAMMES_KEY = 'qb_gammes';
const LEGACY_MARQUES_KEY = 'qb_marques';
const LEGACY_TYPES_KEY = 'qb_types_couverture';
const LEGACY_SUPPLIERS_KEY = 'qb_suppliers';

const uniqSort = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();

function readLegacy(): { coverageTypes: string[]; marques: string[]; gammes: string[]; suppliers: string[] } {
  const safeJson = <T,>(k: string, fb: T): T => {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fb; } catch { return fb; }
  };
  const combined = safeJson<any>(LEGACY_COMBINED_KEY, {});
  return {
    coverageTypes: [...(combined.coverageTypes || []), ...safeJson<string[]>(LEGACY_TYPES_KEY, [])],
    marques: [...(combined.marques || []), ...safeJson<string[]>(LEGACY_MARQUES_KEY, [])],
    gammes: [...(combined.gammes || []), ...safeJson<string[]>(LEGACY_GAMMES_KEY, [])],
    suppliers: [...(combined.suppliers || []), ...safeJson<string[]>(LEGACY_SUPPLIERS_KEY, [])],
  };
}

function clearLegacy() {
  try {
    localStorage.removeItem(LEGACY_COMBINED_KEY);
    localStorage.removeItem(LEGACY_GAMMES_KEY);
    localStorage.removeItem(LEGACY_MARQUES_KEY);
    localStorage.removeItem(LEGACY_TYPES_KEY);
    localStorage.removeItem(LEGACY_SUPPLIERS_KEY);
  } catch { /* ignore */ }
}

export interface QuoteListConfigApi {
  coverageTypes: string[];
  setCoverageTypes: React.Dispatch<React.SetStateAction<string[]>>;
  marques: string[];
  setMarques: React.Dispatch<React.SetStateAction<string[]>>;
  gammes: string[];
  setGammes: React.Dispatch<React.SetStateAction<string[]>>;
  suppliers: string[];
  setSuppliers: React.Dispatch<React.SetStateAction<string[]>>;
  loaded: boolean;
}

export function useQuoteListConfig(): QuoteListConfigApi {
  const [coverageTypes, setCoverageTypes] = useState<string[]>([]);
  const [marques, setMarques] = useState<string[]>([]);
  const [gammes, setGammes] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const lastWriteAtRef = useRef(0);

  // 1) Chargement initial : fusion (config Supabase) + (valeurs dérivées des
  //    qb_products) + (legacy localStorage des deux pages).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [prodRes, cfgRes] = await Promise.all([
        supabase.from('qb_products').select('coverage_types, brand, gamme, supplier').eq('active', true),
        (supabase as any).from('quote_list_config').select('coverage_types, marques, gammes, suppliers').eq('id', LISTS_ROW_ID).maybeSingle(),
      ]);
      if (cancelled) return;
      const types = new Set<string>();
      const brands = new Set<string>();
      const gammesS = new Set<string>();
      const supps = new Set<string>();
      for (const p of (prodRes.data || []) as any[]) {
        if (Array.isArray(p.coverage_types)) p.coverage_types.forEach((t: string) => t && types.add(t));
        if (p.brand) brands.add(p.brand);
        if (p.gamme) gammesS.add(p.gamme);
        if (p.supplier) supps.add(p.supplier);
      }
      const cfg: any = cfgRes.data || {};
      const legacy = readLegacy();
      setCoverageTypes(uniqSort([...(cfg.coverage_types || []), ...legacy.coverageTypes, ...Array.from(types)]));
      setMarques(uniqSort([...(cfg.marques || []), ...legacy.marques, ...Array.from(brands)]));
      setGammes(uniqSort([...(cfg.gammes || []), ...legacy.gammes, ...Array.from(gammesS)]));
      setSuppliers(uniqSort([...(cfg.suppliers || []), ...legacy.suppliers, ...Array.from(supps)]));
      // Une seule fois : on jette les caches locaux pour ne pas ressusciter
      // d'anciennes entrées après une suppression côté serveur.
      if (legacy.coverageTypes.length || legacy.marques.length || legacy.gammes.length || legacy.suppliers.length) {
        clearLegacy();
      }
      loadedRef.current = true;
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) Persistance Supabase à chaque modification utilisateur. La garde
  //    `loadedRef` évite d'écraser la table au tout premier rendu (état vide).
  useEffect(() => {
    if (!loadedRef.current) return;
    lastWriteAtRef.current = Date.now();
    (supabase as any).from('quote_list_config').upsert({
      id: LISTS_ROW_ID,
      coverage_types: coverageTypes,
      marques,
      gammes,
      suppliers,
    }, { onConflict: 'id' }).then((res: any) => {
      if (res?.error) console.warn('quote_list_config upsert failed:', res.error.message);
    });
  }, [coverageTypes, marques, gammes, suppliers]);

  // 3) Realtime : si une AUTRE fenêtre (l'autre page, un autre user) modifie
  //    la ligne, on rapatrie la nouvelle version. Anti-écho 1.5s sur nos
  //    propres écritures pour éviter la boucle persist → echo → setState →
  //    persist.
  useEffect(() => {
    const ch = (supabase as any).channel('quote_list_config_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_list_config', filter: `id=eq.${LISTS_ROW_ID}` }, (payload: any) => {
        if (Date.now() - lastWriteAtRef.current < 1500) return;
        const n = payload.new || {};
        if (Array.isArray(n.coverage_types)) setCoverageTypes(uniqSort(n.coverage_types));
        if (Array.isArray(n.marques)) setMarques(uniqSort(n.marques));
        if (Array.isArray(n.gammes)) setGammes(uniqSort(n.gammes));
        if (Array.isArray(n.suppliers)) setSuppliers(uniqSort(n.suppliers));
      })
      .subscribe();
    return () => { try { (supabase as any).removeChannel(ch); } catch { /* ignore */ } };
  }, []);

  return { coverageTypes, setCoverageTypes, marques, setMarques, gammes, setGammes, suppliers, setSuppliers, loaded };
}
