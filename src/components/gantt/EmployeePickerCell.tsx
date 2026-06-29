/**
 * EmployeePickerCell — multi-select dropdown to assign employees to a Gantt task.
 * Selections are persisted as `dispatch_assignments` rows so they appear in the
 * Dispatch board automatically.
 */
import React, { useMemo, useState } from 'react';
import { Check, Users2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

export interface EmployeeOption {
  id: string;
  name: string;
  alias?: string;
  color?: string;
}

interface Props {
  employees: EmployeeOption[];
  selectedIds: string[];
  fallbackText?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (nextIds: string[]) => void;
}

export const EmployeePickerCell: React.FC<Props> = ({
  employees,
  selectedIds,
  fallbackText,
  disabled,
  disabledReason,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.alias || '').toLowerCase().includes(q),
    );
  }, [employees, query]);

  const labelText = useMemo(() => {
    if (selectedIds.length === 0) return fallbackText || '-';
    const names = selectedIds
      .map(id => employees.find(e => e.id === id))
      .filter(Boolean)
      .map(e => e!.alias || e!.name);
    if (names.length === 0) return fallbackText || '-';
    return names.join(', ');
  }, [selectedIds, employees, fallbackText]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter(x => x !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <Popover open={open} onOpenChange={(v) => { if (!disabled) setOpen(v); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={disabled ? disabledReason : 'Assigner des employés'}
          onClick={(e) => { e.stopPropagation(); }}
          className={cn(
            'flex items-center gap-1 w-full h-6 px-1 rounded text-[10px] truncate text-left hover:bg-muted',
            disabled && 'opacity-60 cursor-not-allowed',
          )}
        >
          <Users2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{labelText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {disabled ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{disabledReason}</p>
        ) : (
          <>
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher..."
              className="h-7 text-xs mb-2"
            />
            <div className="max-h-56 overflow-y-auto -mx-1 px-1">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">Aucun employé</p>
              ) : (
                filtered.map(e => {
                  const checked = selectedSet.has(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggle(e.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-1.5 py-1.5 rounded text-xs hover:bg-accent text-left',
                        checked && 'bg-accent/60',
                      )}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                        style={{ background: e.color || 'hsl(var(--primary))' }}
                      >
                        {(e.alias || e.name || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex-1 truncate">{e.name}</span>
                      {checked && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="mt-2 w-full text-[11px] text-muted-foreground hover:text-foreground py-1 border-t border-border"
                onClick={() => onChange([])}
              >
                Tout retirer
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};