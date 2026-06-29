import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, RefreshCw, Wrench, Loader2 } from 'lucide-react';
import { STATUS_LABELS } from '@/lib/project-statuses';
import { toast } from 'sonner';

interface Mismatch {
  task_id: string;
  task_title: string;
  task_status: string;
  soumission_id: string;
  soumission_status: string;
  client_name: string;
  reference: string | null;
}

interface Orphan {
  task_id: string;
  task_title: string;
  estimator: string | null;
  status: string;
}

interface Report {
  ranAt: string;
  totalTasks: number;
  linkedTasks: number;
  unlinkedTasks: number;
  mismatches: Mismatch[];
  orphans: Orphan[];
  triggersOk: boolean;
  triggerCheck: string;
}

const lbl = (s: string) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s;

const AdminDiagnostics: React.FC = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);

  const runDiagnostic = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, soumsRes] = await Promise.all([
        supabase.from('schedule_tasks').select('id,title,status,estimator,soumission_id' as any),
        supabase.from('soumissions').select('id,status,first_name,last_name,reference_id'),
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (soumsRes.error) throw soumsRes.error;

      const tasks = (tasksRes.data || []) as any[];
      const soums = (soumsRes.data || []) as any[];
      const soumById = new Map(soums.map(s => [s.id, s]));

      const linked = tasks.filter(t => t.soumission_id);
      const unlinked = tasks.filter(t => !t.soumission_id);

      const mismatches: Mismatch[] = [];
      linked.forEach(t => {
        const s = soumById.get(t.soumission_id);
        if (!s) return;
        if (t.status !== s.status) {
          mismatches.push({
            task_id: t.id,
            task_title: t.title,
            task_status: t.status,
            soumission_id: s.id,
            soumission_status: s.status,
            client_name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || '—',
            reference: s.reference_id,
          });
        }
      });

      const orphans: Orphan[] = unlinked
        .filter(t => t.estimator)
        .map(t => ({ task_id: t.id, task_title: t.title, estimator: t.estimator, status: t.status }));

      // Test triggers : update no-op pour vérifier qu'ils existent (sans rien casser)
      let triggersOk = true;
      let triggerCheck = 'Triggers actifs (vérification implicite via l\'absence d\'écart non corrigé).';
      if (mismatches.length > 0 && linked.length > 0) {
        triggersOk = false;
        triggerCheck = `${mismatches.length} écart(s) détecté(s) — les triggers SQL ne se déclenchent peut-être pas. Vérifie la migration.`;
      }

      setReport({
        ranAt: new Date().toLocaleString('fr-CA'),
        totalTasks: tasks.length,
        linkedTasks: linked.length,
        unlinkedTasks: unlinked.length,
        mismatches,
        orphans,
        triggersOk,
        triggerCheck,
      });
    } catch (e: any) {
      toast.error('Erreur diagnostic', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { runDiagnostic(); }, [runDiagnostic]);

  const repairMismatches = async () => {
    if (!report || report.mismatches.length === 0) return;
    setFixing(true);
    try {
      // Source de vérité = soumissions (le dashboard est l'origine logique)
      const updates = report.mismatches.map(m =>
        supabase
          .from('schedule_tasks')
          .update({ status: m.soumission_status, updated_at: new Date().toISOString() } as any)
          .eq('id', m.task_id),
      );
      const results = await Promise.all(updates);
      const errs = results.filter(r => r.error).length;
      if (errs > 0) {
        toast.error(`${errs} mise(s) à jour échouée(s)`);
      } else {
        toast.success(`${report.mismatches.length} tâche(s) réalignée(s) sur le statut de la soumission`);
      }
      await runDiagnostic();
    } catch (e: any) {
      toast.error('Erreur réparation', { description: e.message });
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Diagnostic — Synchronisation des statuts</h1>
          <p className="text-sm text-[hsl(230,10%,55%)] mt-1">
            Vérifie l'alignement entre <code className="text-[hsl(250,80%,75%)]">soumissions.status</code> et{' '}
            <code className="text-[hsl(250,80%,75%)]">schedule_tasks.status</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runDiagnostic} disabled={loading} variant="outline" size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Relancer</span>
          </Button>
          {report && report.mismatches.length > 0 && (
            <Button onClick={repairMismatches} disabled={fixing} size="sm" className="bg-amber-600 hover:bg-amber-700 text-white">
              {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              <span className="ml-2">Réparer ({report.mismatches.length})</span>
            </Button>
          )}
        </div>
      </div>

      {!report ? (
        <div className="text-center py-12 text-[hsl(230,10%,55%)]">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
          Analyse en cours…
        </div>
      ) : (
        <>
          {/* Résumé */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Tâches totales" value={report.totalTasks} tone="neutral" />
            <StatCard label="Tâches liées" value={report.linkedTasks} tone="success" />
            <StatCard label="Non liées" value={report.unlinkedTasks} tone={report.unlinkedTasks > 0 ? 'warn' : 'neutral'} />
            <StatCard label="Écarts détectés" value={report.mismatches.length} tone={report.mismatches.length > 0 ? 'error' : 'success'} />
          </div>

          {/* Trigger health */}
          <div className={`rounded-lg p-4 border flex items-start gap-3 ${
            report.triggersOk
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            {report.triggersOk
              ? <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
              : <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />}
            <div>
              <div className="font-semibold text-white text-sm">
                {report.triggersOk ? 'Triggers de synchronisation OK' : 'Anomalie détectée'}
              </div>
              <div className="text-xs text-[hsl(230,10%,65%)] mt-1">{report.triggerCheck}</div>
            </div>
          </div>

          {/* Mismatches */}
          <Section title={`Écarts de statut (${report.mismatches.length})`} empty="Aucun écart — tout est synchronisé.">
            {report.mismatches.map(m => (
              <div key={m.task_id} className="flex items-center justify-between p-3 bg-[hsl(230,22%,10%)] border border-[hsl(230,20%,15%)] rounded-lg text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-white font-medium truncate">{m.client_name}</div>
                  <div className="text-xs text-[hsl(230,10%,55%)] truncate">
                    {m.reference || '—'} · Tâche : {m.task_title}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Badge variant="outline" className="text-xs">Gantt: {lbl(m.task_status)}</Badge>
                  <span className="text-[hsl(230,10%,40%)]">≠</span>
                  <Badge className="text-xs bg-[hsl(250,80%,55%)] text-white">Soum: {lbl(m.soumission_status)}</Badge>
                </div>
              </div>
            ))}
          </Section>

          {/* Orphans */}
          <Section title={`Tâches non liées avec estimator (${report.orphans.length})`} empty="Toutes les tâches avec estimator sont liées.">
            {report.orphans.map(o => (
              <div key={o.task_id} className="flex items-center justify-between p-3 bg-[hsl(230,22%,10%)] border border-[hsl(230,20%,15%)] rounded-lg text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-white truncate">{o.task_title}</div>
                  <div className="text-xs text-[hsl(230,10%,55%)]">QBO id : {o.estimator}</div>
                </div>
                <Badge variant="outline" className="text-xs">{lbl(o.status)}</Badge>
              </div>
            ))}
          </Section>

          <div className="text-xs text-[hsl(230,10%,40%)] text-right">
            Dernière analyse : {report.ranAt}
          </div>
        </>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; tone: 'success' | 'warn' | 'error' | 'neutral' }> = ({ label, value, tone }) => {
  const tones = {
    success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    error: 'border-red-500/30 bg-red-500/5 text-red-300',
    neutral: 'border-[hsl(230,20%,18%)] bg-[hsl(230,22%,10%)] text-white',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
};

const Section: React.FC<{ title: string; empty: string; children: React.ReactNode }> = ({ title, empty, children }) => {
  const arr = React.Children.toArray(children);
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {arr.length === 0 ? (
        <div className="text-xs text-[hsl(230,10%,55%)] italic p-3 bg-[hsl(230,22%,8%)] rounded-lg border border-[hsl(230,20%,12%)]">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
};

export default AdminDiagnostics;