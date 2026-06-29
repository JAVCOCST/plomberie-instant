import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeEstimate } from '@/lib/call/estimate';
import { Button } from '@/components/ui/button';
import { Phone, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { ProspectHeader, type CallProspect } from '@/components/call/ProspectHeader';
import { CallScript, type PrefillFact } from '@/components/call/CallScript';
import {
  FactConfirmPanel, draftFromPrefill, EMPTY_DRAFT, EMPTY_CONFIRMED,
  type FactDraft, type ConfirmedState,
} from '@/components/call/FactConfirmPanel';
import { DispositionBar, type DispositionType } from '@/components/call/DispositionBar';
import { CalcSummary } from '@/components/call/CalcSummary';
import { ImageryPanel } from '@/components/call/ImageryPanel';

const CALL_SCHEMA = ((import.meta.env as any).VITE_CALL_SCHEMA as string) || 'staging';
const CALL_VILLE = 'granby';
const SELECT_COLS = 'id, property_id, owner_name, telephone, address, ville_slug, footprint_m2, price_estimated, score_v1';

type UiState = 'loading' | 'ready' | 'empty' | 'error';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const AdminCallModule: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>('loading');
  const [prospect, setProspect] = useState<CallProspect | null>(null);
  const [facts, setFacts] = useState<PrefillFact[]>([]);
  const [draft, setDraft] = useState<FactDraft>(EMPTY_DRAFT);
  const [confirmed, setConfirmed] = useState<ConfirmedState>(EMPTY_CONFIRMED);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [errMsg, setErrMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<null | 'callback' | 'dnc'>(null);
  const [callbackDate, setCallbackDate] = useState('');
  const [rep, setRep] = useState('rep');
  const [sessionCount, setSessionCount] = useState(0);
  const [doubtDone, setDoubtDone] = useState(false);
  const [canPrev, setCanPrev] = useState(false);

  // Historique de navigation (IDs visités) — permet Précédent / Prochain.
  const historyRef = useRef<string[]>([]);
  const histIndexRef = useRef<number>(-1);
  const initedRef = useRef(false);

  const db = useCallback(() => (supabase as any).schema(CALL_SCHEMA), []);

  // Estimation live (suit les corrections forme/pente, dont le tarif toit plat).
  const liveEst = useMemo(
    () => (prospect
      ? computeEstimate({ footprint_m2: prospect.footprint_m2, roof_form: draft.roof_form, pitch: draft.pitch, price_estimated: prospect.price_estimated })
      : null),
    [prospect, draft],
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email;
      if (email) setRep(email.split('@')[0]);
    });
  }, []);

  // Charge un prospect (prefill + coords) dans l'écran.
  const loadProspectRow = useCallback(async (p: CallProspect) => {
    setProspect(p);
    setFacts([]); setDraft(EMPTY_DRAFT); setConfirmed(EMPTY_CONFIRMED);
    setPending(null); setCallbackDate(''); setDoubtDone(false); setCoords({ lat: null, lng: null });
    if (p.property_id) {
      const { data: pf, error: pfErr } = await db().rpc('prefill_call', { p_property_id: p.property_id });
      if (pfErr) throw pfErr;
      const list = (pf as PrefillFact[]) || [];
      setFacts(list); setDraft(draftFromPrefill(list));
      const { data: prop } = await db().from('property').select('lat,lng').eq('id', p.property_id).maybeSingle();
      if (prop) setCoords({ lat: (prop as any).lat ?? null, lng: (prop as any).lng ?? null });
    }
    setUiState('ready');
  }, [db]);

  const fetchById = useCallback(async (id: string): Promise<CallProspect | null> => {
    const { data, error } = await db().from('prospects_v1').select(SELECT_COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as CallProspect) || null;
  }, [db]);

  // Prochain prospect JAMAIS encore vu cette session (exclut l'historique).
  const fetchFreshNext = useCallback(async (): Promise<CallProspect | null> => {
    let q = db().from('prospects_v1').select(SELECT_COLS)
      .eq('ville_slug', CALL_VILLE).eq('status', 'new').eq('consent_dnc', false);
    if (historyRef.current.length) q = q.not('id', 'in', `(${historyRef.current.join(',')})`);
    const { data, error } = await q
      .order('score_v1', { ascending: false }).order('price_estimated', { ascending: false }).limit(1);
    if (error) throw error;
    return ((data && data[0]) as CallProspect) || null;
  }, [db]);

  const goNext = useCallback(async () => {
    setUiState('loading'); setErrMsg('');
    try {
      if (histIndexRef.current < historyRef.current.length - 1) {
        histIndexRef.current += 1;
        const p = await fetchById(historyRef.current[histIndexRef.current]);
        if (p) await loadProspectRow(p); else setUiState('empty');
      } else {
        const p = await fetchFreshNext();
        if (!p) { setProspect(null); setUiState('empty'); return; }
        historyRef.current.push(p.id);
        histIndexRef.current = historyRef.current.length - 1;
        await loadProspectRow(p);
      }
      setCanPrev(histIndexRef.current > 0);
    } catch (e: any) { setErrMsg(e?.message || String(e)); setUiState('error'); }
  }, [fetchById, fetchFreshNext, loadProspectRow]);

  const goPrev = useCallback(async () => {
    if (histIndexRef.current <= 0) return;
    setUiState('loading'); setErrMsg('');
    try {
      histIndexRef.current -= 1;
      const p = await fetchById(historyRef.current[histIndexRef.current]);
      if (p) await loadProspectRow(p); else setUiState('empty');
      setCanPrev(histIndexRef.current > 0);
    } catch (e: any) { setErrMsg(e?.message || String(e)); setUiState('error'); }
  }, [fetchById, loadProspectRow]);

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    goNext();
  }, [goNext]);

  const commit = useCallback(async (outcome: DispositionType, callbackDateStr?: string) => {
    if (!prospect?.property_id) return;
    setBusy(true); setErrMsg('');
    try {
      const notes = outcome === 'callback' && callbackDateStr ? `RAPPEL: ${callbackDateStr}` : null;
      const { error: logErr } = await db().rpc('log_call_facts', {
        p_property_id: prospect.property_id,
        p_prospect_id: prospect.id,
        p_rep: rep,
        p_outcome: outcome,
        p_roof_age: confirmed.roof_age ? draft.roof_age : null,
        p_material: confirmed.material ? draft.material : null,
        p_roof_form: confirmed.roof_form ? draft.roof_form : null,
        p_pitch: confirmed.pitch ? draft.pitch : null,
        p_intent: confirmed.intent ? draft.intent : null,
        p_email: draft.email,
        p_notes: notes,
      });
      if (logErr) throw logErr;

      // no_answer : on ne change pas le statut (prospect reste 'new', mais déjà
      // dans l'historique donc non re-servi). Les autres dispositions changent le statut.
      if (outcome !== 'no_answer') {
        const statusMap: Record<string, string> = {
          not_interested: 'not_interested', bad_number: 'bad_number', callback: 'callback', dnc: 'dnc',
        };
        const patch: any = { status: statusMap[outcome] };
        if (outcome === 'dnc') patch.consent_dnc = true;
        const { error: upErr } = await db().from('prospects_v1').update(patch).eq('id', prospect.id);
        if (upErr) throw upErr;
      }
      setSessionCount((c) => c + 1);
      setBusy(false);
      await goNext();
    } catch (e: any) {
      setErrMsg(e?.message || String(e));
      setBusy(false);
    }
  }, [prospect, draft, confirmed, rep, db, goNext]);

  const onDispose = (t: DispositionType) => {
    if (t === 'interested') return;
    if (t === 'callback') { setPending('callback'); return; }
    if (t === 'dnc') { setPending('dnc'); return; }
    commit(t);
  };

  const handleDoubt = useCallback(async (reason: string) => {
    if (!prospect?.property_id) return;
    try {
      await db().rpc('log_call_facts', {
        p_property_id: prospect.property_id, p_prospect_id: prospect.id, p_rep: rep,
        p_outcome: 'estimate_doubt', p_roof_age: null, p_material: null, p_roof_form: null,
        p_pitch: null, p_intent: null, p_email: null, p_notes: `DOUTE ESTIMATION: ${reason}`,
      });
      setDoubtDone(true);
    } catch (e: any) { setErrMsg(e?.message || String(e)); }
  }, [prospect, rep, db]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Phone className="h-5 w-5" /> Module d'appel</h1>
        <div className="flex items-center gap-2">
          {sessionCount > 0 && (
            <span className="text-xs text-[hsl(230,10%,55%)] inline-flex items-center gap-1 mr-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {sessionCount} appel(s)
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={busy || !canPrev}
            className="text-[hsl(230,10%,60%)] gap-1 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <Button variant="ghost" size="sm" onClick={goNext} disabled={busy} className="text-[hsl(230,10%,60%)] gap-1">
            Prochain <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {uiState === 'loading' && (<div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-8 text-center text-[hsl(230,10%,55%)]">Chargement…</div>)}
      {uiState === 'empty' && (<div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-8 text-center text-[hsl(230,10%,60%)]">File vide — aucun prospect « nouveau » à {cap(CALL_VILLE)}.</div>)}
      {uiState === 'error' && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-6 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div><div className="font-semibold">Erreur</div><div className="mt-1 text-red-300/80 break-words">{errMsg}</div></div>
        </div>
      )}

      {uiState === 'ready' && prospect && (
        <div className="space-y-4">
          <ProspectHeader prospect={prospect} estimate={liveEst ? { roofSqft: liveEst.roof_sqft, budgetLow: liveEst.budget_low, budgetHigh: liveEst.budget_high } : undefined} />

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <div className="space-y-4">
              <CallScript ownerName={prospect.owner_name} facts={facts} rep={rep} />
              <ImageryPanel lat={coords.lat} lng={coords.lng} address={prospect.address} />
              <FactConfirmPanel facts={facts} draft={draft} confirmed={confirmed} onDraft={setDraft} onConfirmed={setConfirmed} />
            </div>

            <CalcSummary prospect={prospect} facts={facts} draft={draft} confirmed={confirmed} onDoubt={handleDoubt} doubtDone={doubtDone} />
          </div>

          {errMsg && (<div className="text-sm text-red-300">{errMsg}</div>)}

          {pending === 'callback' ? (
            <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-4">
              <div className="text-sm text-[hsl(230,10%,75%)] mb-2">Date de rappel (obligatoire)</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={callbackDate} onChange={(e) => setCallbackDate(e.target.value)}
                  className="bg-[hsl(230,22%,8%)] border border-[hsl(230,20%,16%)] text-white rounded-md px-2 py-1.5 text-sm" />
                <Button size="sm" disabled={!callbackDate || busy} onClick={() => commit('callback', callbackDate)}>Confirmer le rappel</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPending(null); setCallbackDate(''); }}>Annuler</Button>
              </div>
            </div>
          ) : pending === 'dnc' ? (
            <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-4">
              <div className="text-sm text-red-200 font-semibold mb-1">Ne plus contacter — confirmation</div>
              <div className="text-xs text-red-300/80 mb-3">Le prospect sera marqué DNC (consent_dnc = true) et ne réapparaîtra jamais.</div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="bg-red-700 hover:bg-red-600 text-white" disabled={busy} onClick={() => commit('dnc')}>Confirmer NPC</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <DispositionBar onDispose={onDispose} busy={busy} />
          )}
        </div>
      )}
    </div>
  );
};

export default AdminCallModule;
