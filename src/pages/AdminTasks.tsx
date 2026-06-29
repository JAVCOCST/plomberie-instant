import React from 'react';
import { ListChecks } from 'lucide-react';
import MobileTodoList from '@/components/admin/MobileTodoList';

/** Dedicated Tasks page (the to-do list used to live cramped in the sidebar). */
const AdminTasks: React.FC = () => (
  <div style={{ padding: '16px 14px', maxWidth: 760, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <ListChecks size={22} style={{ color: '#a5b4fc' }} />
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Tâches</h1>
        <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>Liste des tâches de l'équipe</p>
      </div>
    </div>
    <div style={{ borderRadius: 12, border: '1px solid hsl(230,20%,14%)', background: 'hsl(230,22%,8%)', overflow: 'hidden' }}>
      <MobileTodoList />
    </div>
  </div>
);

export default AdminTasks;
