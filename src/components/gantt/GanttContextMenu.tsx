/**
 * GanttContextMenu — right-click context menu for task actions.
 */
import React, { memo, useEffect, useRef } from 'react';
import {
  Copy,
  Trash2,
  LinkIcon,
  Eye,
  EyeOff,
  FolderOpen,
  ArrowRightLeft,
  Save,
  Building2,
} from 'lucide-react';
import type { ContextMenuState, ContextMenuAction, GanttTask } from './types';

export interface ExtraMenuItem {
  action: ContextMenuAction;
  label: string;
  icon: React.ElementType;
  dividerBefore?: boolean;
}

interface GanttContextMenuProps {
  state: ContextMenuState;
  task: GanttTask;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
  extraItems?: ExtraMenuItem[];
}

const MENU_ITEMS: Array<{
  action: ContextMenuAction;
  label: string;
  icon: React.ElementType;
  dividerAfter?: boolean;
  condition?: (task: GanttTask) => boolean;
}> = [
  /* Manual creation desactivée — les projets apparaissent automatiquement
     depuis les soumissions acceptées. Seul le lien QBO reste disponible. */
  { action: 'duplicate', label: 'Dupliquer', icon: Copy },
  { action: 'convert-phase', label: 'Convertir en phase', icon: ArrowRightLeft, condition: t => t.type !== 'phase' },
  { action: 'convert-group', label: 'Convertir en groupe', icon: ArrowRightLeft, condition: t => t.type !== 'group' },
  { action: 'create-dependency', label: 'Créer une dépendance', icon: LinkIcon },
  { action: 'add-qbo-project', label: 'Lier un projet QBO', icon: Building2 },
  { action: 'create-baseline', label: 'Créer une baseline', icon: Save, dividerAfter: true },
  { action: 'toggle-hidden', label: 'Masquer/Afficher', icon: EyeOff },
  { action: 'open-details', label: 'Ouvrir les détails', icon: FolderOpen, dividerAfter: true },
  { action: 'delete', label: 'Supprimer', icon: Trash2 },
];

export const GanttContextMenu = memo(function GanttContextMenu({
  state,
  task,
  onAction,
  onClose,
  extraItems,
}: GanttContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: state.x, y: state.y });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position after render to keep menu within viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = state.x;
    let y = state.y;
    if (y + rect.height > vh - 8) y = Math.max(8, vh - rect.height - 8);
    if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
    setPos({ x, y });
  }, [state.x, state.y]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    zIndex: 100,
  };

  return (
    <div
      ref={ref}
      className="bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] animate-in fade-in-0 zoom-in-95"
      style={style}
    >
      {MENU_ITEMS.map((item) => {
        if (item.condition && !item.condition(task)) return null;
        return (
          <React.Fragment key={item.action}>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent text-left transition-colors"
              onClick={() => { onAction(item.action); onClose(); }}
            >
              <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{item.label}</span>
            </button>
            {item.dividerAfter && <div className="h-px bg-border mx-2 my-0.5" />}
          </React.Fragment>
        );
      })}
      {extraItems && extraItems.length > 0 && (
        <>
          {extraItems.map((item) => (
            <React.Fragment key={item.action}>
              {item.dividerBefore && <div className="h-px bg-border mx-2 my-0.5" />}
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent text-left transition-colors font-medium text-primary"
                onClick={() => { onAction(item.action); onClose(); }}
              >
                <item.icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </>
      )}
    </div>
  );
});
