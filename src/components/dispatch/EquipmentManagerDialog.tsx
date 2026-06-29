import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2, Wrench, X, Save, Search, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Equipment registry — pieces of equipment (truck, lift, crane, tools)
 * that can be dispatched to a project the same way employees are.
 */
export interface ManagedEquipment {
  id: string;
  displayName: string;
  alias: string;
  category: string;
  identifier: string;
  notes: string;
  color: string;
  active: boolean;
}

const COMPANY_ID_KEY = 'selectedCompanyId';
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

const PRESET_COLORS = ['#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#3b82f6', '#14b8a6', '#ec4899', '#64748b'];

function blank(): ManagedEquipment {
  return { id: '', displayName: '', alias: '', category: '', identifier: '', notes: '', color: '', active: true };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export const EquipmentManagerDialog: React.FC<Props> = ({ open, onOpenChange, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ManagedEquipment[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ManagedEquipment | null>(null);
  const companyId = localStorage.getItem(COMPANY_ID_KEY) || DEFAULT_COMPANY_ID;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('equipment' as any)
        .select('id, display_name, alias, category, identifier, notes, color, active')
        .order('display_name');
      if (error) throw error;
      setItems((data || []).map((r: any) => ({
        id: r.id,
        displayName: r.display_name || '',
        alias: r.alias || '',
        category: r.category || '',
        identifier: r.identifier || '',
        notes: r.notes || '',
        color: r.color || '',
        active: r.active !== false,
      })));
    } catch (err: any) {
      console.error('Load equipment failed', err);
      toast.error('Impossible de charger les équipements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(e =>
      [e.displayName, e.alias, e.category, e.identifier].some(v => (v || '').toLowerCase().includes(q))
    );
  }, [items, search]);

  const handleSave = async (eq: ManagedEquipment) => {
    if (!eq.displayName.trim()) {
      toast.error('Le nom est requis');
      return;
    }
    const id = eq.id || `equip-${crypto.randomUUID()}`;
    try {
      const { error } = await supabase.from('equipment' as any).upsert({
        id,
        company_id: companyId,
        display_name: eq.displayName.trim(),
        alias: eq.alias.trim() || null,
        category: eq.category.trim() || null,
        identifier: eq.identifier.trim() || null,
        notes: eq.notes.trim() || null,
        color: eq.color || null,
        active: eq.active,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'id' });
      if (error) throw error;
      toast.success(`${eq.displayName} sauvegardé`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      console.error(err);
      toast.error(`Erreur: ${err?.message || 'inconnue'}`);
    }
  };

  const handleDelete = async (eq: ManagedEquipment) => {
    if (!confirm(`Supprimer ${eq.displayName} ?`)) return;
    try {
      // Remove related dispatch assignments first
      await (supabase.from('dispatch_assignments') as any)
        .delete()
        .eq('equipment_id', eq.id);
      const { error } = await supabase.from('equipment' as any).delete().eq('id', eq.id);
      if (error) throw error;
      toast.success('Équipement supprimé');
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
            <Wrench className="h-5 w-5 text-primary" />
            Gestion des équipements
          </DialogTitle>
          <DialogDescription>
            Camions, nacelles, outillage… ajoutez les équipements que vous pourrez ensuite affecter dans le Dispatch.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <EquipmentForm initial={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
        ) : (
          <div className="flex flex-col gap-3 p-5 overflow-hidden flex-1">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher un équipement..."
                  className="pl-8"
                />
              </div>
              <Button size="sm" onClick={() => setEditing(blank())}>
                <Plus className="mr-1 h-4 w-4" /> Nouvel équipement
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Aucun équipement. Cliquez sur « Nouvel équipement » pour en créer un.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map(eq => (
                    <li key={eq.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-primary-foreground ring-1 ring-border shadow-sm"
                        style={{ background: eq.color || 'hsl(var(--primary))' }}
                      >
                        <Wrench className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{eq.displayName}</span>
                          {eq.alias && <span className="text-xs text-muted-foreground">({eq.alias})</span>}
                          {!eq.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Inactif</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {eq.category && <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{eq.category}</span>}
                          {eq.identifier && <span className="font-mono">#{eq.identifier}</span>}
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(eq)} title="Modifier">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(eq)} title="Supprimer">
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

const EquipmentForm: React.FC<{
  initial: ManagedEquipment;
  onCancel: () => void;
  onSave: (eq: ManagedEquipment) => void;
}> = ({ initial, onCancel, onSave }) => {
  const [eq, setEq] = useState<ManagedEquipment>(initial);
  const [aliasTouched, setAliasTouched] = useState<boolean>(!!initial.alias);

  const update = <K extends keyof ManagedEquipment>(k: K, v: ManagedEquipment[K]) =>
    setEq(prev => ({ ...prev, [k]: v }));

  const handleNameChange = (val: string) => {
    setEq(prev => {
      const next = { ...prev, displayName: val };
      if (!aliasTouched) {
        next.alias = val.split(/\s+/).map(w => w.charAt(0)).join('').slice(0, 3).toUpperCase();
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="eq-name">Nom *</Label>
          <Input id="eq-name" value={eq.displayName} onChange={e => handleNameChange(e.target.value)} placeholder="Camion Ford F-150" />
        </div>
        <div>
          <Label htmlFor="eq-alias" className="flex items-center justify-between">
            <span>Alias (Dispatch)</span>
            {!aliasTouched && eq.displayName && <span className="text-[10px] text-muted-foreground">auto</span>}
          </Label>
          <Input
            id="eq-alias"
            value={eq.alias}
            onChange={e => { setAliasTouched(true); update('alias', e.target.value); }}
            placeholder="F150"
          />
        </div>
        <div>
          <Label htmlFor="eq-cat">Catégorie</Label>
          <Input id="eq-cat" value={eq.category} onChange={e => update('category', e.target.value)} placeholder="Camion, Nacelle, Outillage..." />
        </div>
        <div>
          <Label htmlFor="eq-id">Identifiant / Plaque / N° série</Label>
          <Input id="eq-id" value={eq.identifier} onChange={e => update('identifier', e.target.value)} placeholder="ABC-1234" />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={eq.active} onCheckedChange={v => update('active', v)} id="eq-active" />
          <Label htmlFor="eq-active" className="cursor-pointer">Actif</Label>
        </div>

        <div className="sm:col-span-2">
          <Label>Couleur (chip Dispatch)</Label>
          <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md text-xs font-semibold text-primary-foreground ring-1 ring-border shadow-sm"
                style={{ background: eq.color || 'hsl(var(--primary))' }}
              >
                <Wrench className="h-4 w-4" />
              </div>
              <div className="text-xs text-muted-foreground">Aperçu de la pastille affichée dans le Dispatch.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('color', c)}
                  className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${eq.color.toLowerCase() === c.toLowerCase() ? 'border-foreground scale-110' : 'border-border'}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="eq-color-picker" className="text-xs text-muted-foreground shrink-0">Personnalisée :</Label>
              <input
                id="eq-color-picker"
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(eq.color) ? eq.color : '#f59e0b'}
                onChange={e => update('color', e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-background p-0.5"
              />
              <Input
                value={eq.color}
                onChange={e => update('color', e.target.value)}
                placeholder="#f59e0b"
                className="h-9 w-32 font-mono text-xs"
                maxLength={7}
              />
              {eq.color && (
                <Button type="button" size="sm" variant="ghost" onClick={() => update('color', '')} className="text-xs">
                  Effacer
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="eq-notes">Notes internes</Label>
          <Textarea id="eq-notes" value={eq.notes} onChange={e => update('notes', e.target.value)} rows={3} />
        </div>
      </div>

      <DialogFooter className="border-t border-border pt-3">
        <Button variant="outline" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Annuler
        </Button>
        <Button onClick={() => onSave(eq)}>
          <Save className="mr-1 h-4 w-4" /> Sauvegarder
        </Button>
      </DialogFooter>
    </div>
  );
};
