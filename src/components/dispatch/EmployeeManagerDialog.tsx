import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2, UserCircle, Phone, Mail, Briefcase, X, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { z } from 'zod';

/* ─── Validation helpers ───────────────────────────────────────────────── */
/** Format a NA phone number as `XXX-XXX-XXXX` (or `1-XXX-XXX-XXXX`). */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw.trim();
}

const phoneSchema = z
  .string()
  .trim()
  .refine(v => v === '' || /^\+?\d[\d\s\-().]{8,19}$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15, {
    message: 'Numéro invalide (ex: 514-555-1234)',
  });

const emailSchema = z
  .string()
  .trim()
  .max(255, { message: 'Trop long (max 255)' })
  .refine(v => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    message: 'Courriel invalide (ex: nom@domaine.com)',
  });

/**
 * Custom employee record. Stored in `qbo_employee` for the identity columns
 * (id/display/active) and `employee_mappings.notes` for extra metadata
 * (role, phone, email, hourly_rate, color, free notes) serialized as JSON.
 */
export interface ManagedEmployee {
  id: string;          // qbo_employee.id (text). For custom records we generate `local-<uuid>`
  displayName: string;
  givenName: string;
  familyName: string;
  active: boolean;
  alias: string;       // short label shown in the dispatch grid
  role: string;
  phone: string;
  email: string;
  hourlyRate: string;  // kept as string for input convenience
  color: string;
  notes: string;
  isCustom: boolean;   // true when not synced from QuickBooks
}

interface ExtraData {
  alias?: string;
  role?: string;
  phone?: string;
  email?: string;
  hourly_rate?: string;
  color?: string;
  notes?: string;
}

const COMPANY_ID_KEY = 'selectedCompanyId';
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

function parseExtra(raw: string | null | undefined): ExtraData {
  if (!raw) return {};
  // Try JSON first; fall back to using the raw string as alias for legacy rows.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ExtraData;
  } catch { /* not json */ }
  return { alias: raw };
}

function blankEmployee(): ManagedEmployee {
  return {
    id: '',
    displayName: '',
    givenName: '',
    familyName: '',
    active: true,
    alias: '',
    role: '',
    phone: '',
    email: '',
    hourlyRate: '',
    color: '',
    notes: '',
    isCustom: true,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any create/update/delete so the parent can refresh its list */
  onChanged?: () => void;
}

export const EmployeeManagerDialog: React.FC<Props> = ({ open, onOpenChange, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<ManagedEmployee[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ManagedEmployee | null>(null);
  const companyId = localStorage.getItem(COMPANY_ID_KEY) || DEFAULT_COMPANY_ID;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: emps }, { data: maps }] = await Promise.all([
        supabase.from('qbo_employee').select('id, display_name, given_name, family_name, active').order('display_name'),
        supabase.from('employee_mappings').select('qbo_employee_id, notes'),
      ]);
      const extraMap = new Map<string, ExtraData>();
      (maps || []).forEach((m: any) => { if (m?.qbo_employee_id) extraMap.set(m.qbo_employee_id, parseExtra(m.notes)); });

      const list: ManagedEmployee[] = (emps || []).map((e: any) => {
        const extra = extraMap.get(e.id) || {};
        return {
          id: e.id,
          displayName: e.display_name || '',
          givenName: e.given_name || '',
          familyName: e.family_name || '',
          active: e.active !== false,
          alias: extra.alias || '',
          role: extra.role || '',
          phone: extra.phone || '',
          email: extra.email || '',
          hourlyRate: extra.hourly_rate || '',
          color: extra.color || '',
          notes: extra.notes || '',
          isCustom: typeof e.id === 'string' && e.id.startsWith('local-'),
        };
      });
      setEmployees(list);
    } catch (err) {
      console.error('Load employees failed', err);
      toast.error('Impossible de charger les employés');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      [e.displayName, e.alias, e.role, e.phone, e.email].some(v => (v || '').toLowerCase().includes(q))
    );
  }, [employees, search]);

  const handleSave = async (emp: ManagedEmployee) => {
    if (!emp.displayName.trim()) {
      toast.error('Le nom est requis');
      return;
    }
    // Server-side guard: re-validate phone/email before persisting
    const phoneCheck = phoneSchema.safeParse(emp.phone || '');
    if (!phoneCheck.success) { toast.error(phoneCheck.error.issues[0].message); return; }
    const emailCheck = emailSchema.safeParse(emp.email || '');
    if (!emailCheck.success) { toast.error(emailCheck.error.issues[0].message); return; }
    const id = emp.id || `local-${crypto.randomUUID()}`;
    const extra: ExtraData = {
      alias: emp.alias || undefined,
      role: emp.role || undefined,
      phone: emp.phone ? formatPhone(emp.phone) : undefined,
      email: emp.email ? emp.email.trim().toLowerCase() : undefined,
      hourly_rate: emp.hourlyRate || undefined,
      color: emp.color || undefined,
      notes: emp.notes || undefined,
    };
    try {
      // Upsert qbo_employee (custom records use `local-<uuid>` ids; QBO ids stay intact)
      const { error: e1 } = await supabase.from('qbo_employee').upsert({
        id,
        company_id: companyId,
        display_name: emp.displayName.trim(),
        given_name: emp.givenName.trim() || null,
        family_name: emp.familyName.trim() || null,
        active: emp.active,
      }, { onConflict: 'id' });
      if (e1) throw e1;

      // Upsert metadata in employee_mappings.notes (JSON serialized)
      const notesJson = JSON.stringify(extra);
      // Try update first, then insert if no row affected
      const { data: existing } = await supabase
        .from('employee_mappings')
        .select('id')
        .eq('qbo_employee_id', id)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from('employee_mappings').update({ notes: notesJson }).eq('id', existing.id);
      } else {
        await supabase.from('employee_mappings').insert({
          qbo_employee_id: id,
          company_id: companyId,
          notes: notesJson,
        });
      }
      toast.success(`${emp.displayName} sauvegardé`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      console.error(err);
      toast.error(`Erreur: ${err?.message || 'inconnue'}`);
    }
  };

  const handleDelete = async (emp: ManagedEmployee) => {
    if (!emp.isCustom) {
      toast.warning('Les employés synchronisés depuis QuickBooks ne peuvent pas être supprimés ici. Désactivez-les dans QuickBooks.');
      return;
    }
    if (!confirm(`Supprimer ${emp.displayName} ?`)) return;
    try {
      await supabase.from('employee_mappings').delete().eq('qbo_employee_id', emp.id);
      const { error } = await supabase.from('qbo_employee').delete().eq('id', emp.id);
      if (error) throw error;
      toast.success('Employé supprimé');
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(`Erreur: ${err?.message || 'inconnue'}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[90vh] max-w-3xl overflow-hidden p-0 flex flex-col bg-background text-foreground">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-primary" />
            Gestion des employés
          </DialogTitle>
          <DialogDescription>
            Ajoutez et modifiez les employés que vous pouvez ensuite affecter dans le Dispatch.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <EmployeeForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={handleSave}
          />
        ) : (
          <div className="flex flex-col gap-3 p-5 overflow-hidden flex-1">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher un employé..."
                  className="pl-8"
                />
              </div>
              <Button size="sm" onClick={() => setEditing(blankEmployee())}>
                <Plus className="mr-1 h-4 w-4" /> Nouvel employé
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Aucun employé. Cliquez sur « Nouvel employé » pour en créer un.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map(emp => (
                     <li key={emp.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground ring-1 ring-border shadow-sm"
                        style={{ background: emp.color || 'hsl(var(--primary))' }}
                      >
                        {(emp.alias || emp.displayName || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{emp.displayName}</span>
                          {emp.alias && <span className="text-xs text-muted-foreground">({emp.alias})</span>}
                          {!emp.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Inactif</span>}
                          {!emp.isCustom && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">QBO</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {emp.role && <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" />{emp.role}</span>}
                          {emp.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{emp.phone}</span>}
                          {emp.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{emp.email}</span>}
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(emp)} title="Modifier">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(emp)}
                        title={emp.isCustom ? 'Supprimer' : 'Synchronisé QuickBooks (suppression désactivée)'}
                        disabled={!emp.isCustom}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ─── Inline form ─── */
const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

const EmployeeForm: React.FC<{
  initial: ManagedEmployee;
  onCancel: () => void;
  onSave: (emp: ManagedEmployee) => void;
}> = ({ initial, onCancel, onSave }) => {
  const [emp, setEmp] = useState<ManagedEmployee>(initial);
  // Track manual overrides so auto-generation stops once the user edits the field.
  const [displayTouched, setDisplayTouched] = useState<boolean>(!!initial.displayName);
  const [aliasTouched, setAliasTouched] = useState<boolean>(!!initial.alias);
  // Inline validation errors for phone/email (shown below each input).
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const update = <K extends keyof ManagedEmployee>(k: K, v: ManagedEmployee[K]) => setEmp(prev => ({ ...prev, [k]: v }));

  // Auto-generate displayName and alias from given/family name unless the user
  // has already typed something in those fields (then we leave their value alone).
  const handleGivenChange = (val: string) => {
    setEmp(prev => {
      const next = { ...prev, givenName: val };
      const auto = `${val} ${prev.familyName}`.trim();
      if (!displayTouched) next.displayName = auto;
      if (!aliasTouched) {
        const a = (val.charAt(0) + (prev.familyName.charAt(0) || '')).toUpperCase();
        next.alias = a;
      }
      return next;
    });
  };

  const handleFamilyChange = (val: string) => {
    setEmp(prev => {
      const next = { ...prev, familyName: val };
      const auto = `${prev.givenName} ${val}`.trim();
      if (!displayTouched) next.displayName = auto;
      if (!aliasTouched) {
        const a = ((prev.givenName.charAt(0) || '') + val.charAt(0)).toUpperCase();
        next.alias = a;
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="emp-given">Prénom</Label>
          <Input id="emp-given" value={emp.givenName} onChange={e => handleGivenChange(e.target.value)} placeholder="Jean" />
        </div>
        <div>
          <Label htmlFor="emp-family">Nom de famille</Label>
          <Input id="emp-family" value={emp.familyName} onChange={e => handleFamilyChange(e.target.value)} placeholder="Tremblay" />
        </div>
        <div>
          <Label htmlFor="emp-display" className="flex items-center justify-between">
            <span>Nom complet *</span>
            {!displayTouched && (emp.givenName || emp.familyName) && (
              <span className="text-[10px] text-muted-foreground">auto</span>
            )}
          </Label>
          <Input
            id="emp-display"
            value={emp.displayName}
            onChange={e => { setDisplayTouched(true); update('displayName', e.target.value); }}
            placeholder="Jean Tremblay"
          />
        </div>
        <div>
          <Label htmlFor="emp-alias" className="flex items-center justify-between">
            <span>Alias (Dispatch)</span>
            {!aliasTouched && (emp.givenName || emp.familyName) && (
              <span className="text-[10px] text-muted-foreground">auto</span>
            )}
          </Label>
          <Input
            id="emp-alias"
            value={emp.alias}
            onChange={e => { setAliasTouched(true); update('alias', e.target.value); }}
            placeholder="JT"
          />
        </div>
        <div>
          <Label htmlFor="emp-role">Poste / Métier</Label>
          <Input id="emp-role" value={emp.role} onChange={e => update('role', e.target.value)} placeholder="Couvreur" />
        </div>
        <div>
          <Label htmlFor="emp-phone">Téléphone</Label>
          <Input
            id="emp-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={emp.phone}
            maxLength={20}
            onChange={e => {
              update('phone', e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            onBlur={e => {
              const v = e.target.value.trim();
              if (!v) { setPhoneError(null); return; }
              const result = phoneSchema.safeParse(v);
              if (!result.success) { setPhoneError(result.error.issues[0].message); return; }
              setPhoneError(null);
              update('phone', formatPhone(v));
            }}
            placeholder="514-555-1234"
            aria-invalid={!!phoneError}
            className={phoneError ? 'border-destructive focus-visible:ring-destructive' : ''}
          />
          {phoneError && <p className="mt-1 text-xs text-destructive">{phoneError}</p>}
        </div>
        <div>
          <Label htmlFor="emp-email">Courriel</Label>
          <Input
            id="emp-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={emp.email}
            maxLength={255}
            onChange={e => {
              update('email', e.target.value);
              if (emailError) setEmailError(null);
            }}
            onBlur={e => {
              const v = e.target.value.trim();
              if (!v) { setEmailError(null); return; }
              const result = emailSchema.safeParse(v);
              setEmailError(result.success ? null : result.error.issues[0].message);
            }}
            placeholder="nom@domaine.com"
            aria-invalid={!!emailError}
            className={emailError ? 'border-destructive focus-visible:ring-destructive' : ''}
          />
          {emailError && <p className="mt-1 text-xs text-destructive">{emailError}</p>}
        </div>
        <div>
          <Label htmlFor="emp-rate">Taux horaire ($)</Label>
          <Input id="emp-rate" inputMode="decimal" value={emp.hourlyRate} onChange={e => update('hourlyRate', e.target.value)} placeholder="35" />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={emp.active} onCheckedChange={v => update('active', v)} id="emp-active" />
          <Label htmlFor="emp-active" className="cursor-pointer">Actif</Label>
        </div>
        <div className="sm:col-span-2">
          <Label>Couleur (chip Dispatch)</Label>
          <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            {/* Aperçu */}
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground ring-1 ring-border shadow-sm"
                style={{ background: emp.color || 'hsl(var(--primary))' }}
              >
                {(emp.alias || emp.displayName || '?').slice(0, 2).toUpperCase() || '??'}
              </div>
              <div className="text-xs text-muted-foreground">
                Aperçu de la pastille affichée dans le Dispatch et le Gantt.
              </div>
            </div>

            {/* Préréglages */}
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('color', c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${emp.color.toLowerCase() === c.toLowerCase() ? 'border-foreground scale-110' : 'border-border'}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>

            {/* Couleur personnalisée */}
            <div className="flex items-center gap-2">
              <Label htmlFor="emp-color-picker" className="text-xs text-muted-foreground shrink-0">
                Personnalisée :
              </Label>
              <input
                id="emp-color-picker"
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(emp.color) ? emp.color : '#3b82f6'}
                onChange={e => update('color', e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-0.5"
              />
              <Input
                value={emp.color}
                onChange={e => update('color', e.target.value)}
                placeholder="#3b82f6"
                className="h-9 w-32 font-mono text-xs"
                maxLength={7}
              />
              {emp.color && (
                <Button type="button" size="sm" variant="ghost" onClick={() => update('color', '')} className="text-xs">
                  Effacer
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="emp-notes">Notes internes</Label>
          <Textarea id="emp-notes" value={emp.notes} onChange={e => update('notes', e.target.value)} rows={3} />
        </div>
      </div>

      <DialogFooter className="border-t border-border pt-3">
        <Button variant="outline" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Annuler
        </Button>
        <Button
          onClick={() => {
            // Final guard before submitting
            const p = phoneSchema.safeParse(emp.phone || '');
            const e = emailSchema.safeParse(emp.email || '');
            setPhoneError(p.success ? null : p.error.issues[0].message);
            setEmailError(e.success ? null : e.error.issues[0].message);
            if (!p.success || !e.success) return;
            onSave({
              ...emp,
              phone: emp.phone ? formatPhone(emp.phone) : '',
              email: emp.email ? emp.email.trim().toLowerCase() : '',
            });
          }}
          disabled={!!phoneError || !!emailError}
        >
          <Save className="mr-1 h-4 w-4" /> Sauvegarder
        </Button>
      </DialogFooter>
    </div>
  );
};
