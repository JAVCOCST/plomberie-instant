/**
 * GanttToolbar — top toolbar with navigation, view mode, toggles, and actions.
 */
import React, { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronLeft,
  ChevronRight,
  LinkIcon,
  Eye,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { GanttColumnManager } from './GanttColumnManager';
import type { ViewMode, GanttColumnDef } from './types';

interface GanttToolbarProps {
  viewMode: ViewMode;
  viewStart: Date;
  viewEnd: Date;
  showBaseline: boolean;
  showCriticalPath: boolean;
  linkingFrom: string | null;
  selectedCount: number;
  columns: GanttColumnDef[];
  onSetViewMode: (v: ViewMode) => void;
  onNavigate: (dir: 'prev' | 'next' | 'today') => void;
  onToggleBaseline: (v: boolean) => void;
  onToggleCriticalPath: (v: boolean) => void;
  onCancelLinking: () => void;
  onToggleColumn: (key: string) => void;
  onResetColumns: () => void;
  onAddTask?: () => void;
}

export const GanttToolbar = memo(function GanttToolbar({
  viewMode,
  viewStart,
  viewEnd,
  showBaseline,
  showCriticalPath,
  linkingFrom,
  selectedCount,
  columns,
  onSetViewMode,
  onNavigate,
  onToggleBaseline,
  onToggleCriticalPath,
  onCancelLinking,
  onToggleColumn,
  onResetColumns,
  onAddTask,
}: GanttToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 gap-2 flex-wrap">
      {/* Left: Navigation */}
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => onNavigate('prev')}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs font-medium min-w-[160px] text-center">
          {format(viewStart, 'dd MMM', { locale: fr })} – {format(viewEnd, 'dd MMM yyyy', { locale: fr })}
        </span>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => onNavigate('next')}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onNavigate('today')}>
          Aujourd'hui
        </Button>
        {onAddTask && (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={onAddTask}>
            <Plus className="h-3.5 w-3.5" />
            Tâche
          </Button>
        )}
      </div>

      {/* Center: Indicators */}
      <div className="flex items-center gap-2">
        {linkingFrom && (
          <Badge variant="outline" className="text-xs gap-1 bg-primary/10">
            <LinkIcon className="h-3 w-3" />
            Cliquez une tâche cible
            <button className="ml-1 hover:text-destructive" onClick={onCancelLinking}>×</button>
          </Badge>
        )}
        {selectedCount > 1 && (
          <Badge variant="secondary" className="text-xs">
            {selectedCount} sélectionnées
          </Badge>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={showBaseline}
            onCheckedChange={(v) => onToggleBaseline(!!v)}
            className="h-3.5 w-3.5"
          />
          <Eye className="h-3 w-3" />
          Baseline
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={showCriticalPath}
            onCheckedChange={(v) => onToggleCriticalPath(!!v)}
            className="h-3.5 w-3.5"
          />
          <AlertTriangle className="h-3 w-3" />
          Critique
        </label>

        <GanttColumnManager
          columns={columns}
          onToggle={onToggleColumn}
          onReset={onResetColumns}
        />

        <Select value={viewMode} onValueChange={(v) => onSetViewMode(v as ViewMode)}>
          <SelectTrigger className="h-7 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Jour</SelectItem>
            <SelectItem value="week">Semaine</SelectItem>
            <SelectItem value="month">Mois</SelectItem>
            <SelectItem value="quarter">Trimestre</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
});
