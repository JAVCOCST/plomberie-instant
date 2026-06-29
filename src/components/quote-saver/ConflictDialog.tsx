import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onKeepMine: () => void;
  onReload: () => void;
  onClose: () => void;
  /** Optional: who edited it remotely. */
  remoteEditorLabel?: string;
}

/**
 * Vague A placeholder. The full optimistic-concurrency flow lands in Vague C
 * (realtime conflict detection + updated_at compare). This stub is exported
 * here so the parent can wire `<ConflictDialog open={false} … />` today
 * without a separate import sweep when Vague C arrives.
 */
const ConflictDialog: React.FC<Props> = ({ open, onKeepMine, onReload, onClose, remoteEditorLabel }) => (
  <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Soumission modifiée ailleurs</DialogTitle>
        <DialogDescription>
          {remoteEditorLabel
            ? `Cette soumission a été modifiée par ${remoteEditorLabel}.`
            : "Cette soumission a été modifiée depuis une autre session."}
          {' '}Choisissez la version à conserver.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onKeepMine}>Garder mes modifications</Button>
        <Button onClick={onReload}>Recharger la version distante</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default ConflictDialog;
