import { useState, useCallback, useEffect } from 'react';
import type { GanttColumnDef } from '../types';
import { DEFAULT_COLUMNS } from '../types';

const STORAGE_KEY = 'gantt_column_prefs';

function loadPrefs(): GanttColumnDef[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as GanttColumnDef[];
    const keyMap = new Map(saved.map(c => [c.key, c]));
    return DEFAULT_COLUMNS.map(def => { const s = keyMap.get(def.key); return s ? { ...def, visible: s.visible, width: s.width } : def; });
  } catch { return null; }
}

export function useColumnConfig() {
  const [columns, setColumns] = useState<GanttColumnDef[]>(() => loadPrefs() || DEFAULT_COLUMNS);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns.map(c => ({ key: c.key, visible: c.visible, width: c.width })))); }, [columns]);
  const toggleColumn = useCallback((key: string) => { setColumns(prev => prev.map(c => (c.key === key ? { ...c, visible: !c.visible } : c))); }, []);
  const resetColumns = useCallback(() => { setColumns(DEFAULT_COLUMNS); localStorage.removeItem(STORAGE_KEY); }, []);
  const visibleColumns = columns.filter(c => c.visible);
  const totalWidth = visibleColumns.reduce((s, c) => s + c.width, 0);
  return { columns, visibleColumns, totalWidth, toggleColumn, resetColumns };
}
