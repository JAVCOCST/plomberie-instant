/**
 * GanttColumnManager — popover to toggle, reorder, and reset columns.
 */
import React, { memo } from 'react';
import { Settings2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { GanttColumnDef } from './types';

interface GanttColumnManagerProps {
  columns: GanttColumnDef[];
  onToggle: (key: string) => void;
  onReset: () => void;
}

export const GanttColumnManager = memo(function GanttColumnManager({
  columns,
  onToggle,
  onReset,
}: GanttColumnManagerProps) {
  // Skip 'link' column (always shown)
  const configurable = columns.filter(c => c.key !== 'link');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Settings2 className="h-3.5 w-3.5" />
          Colonnes
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">Colonnes visibles</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={onReset}>
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {configurable.map(col => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={col.visible}
                onCheckedChange={() => onToggle(col.key)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs">{col.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
