import { useEffect } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { ProjectStatus } from '@/lib/project-statuses';

export type Project = Database['public']['Tables']['soumissions']['Row'];

export const PROJECTS_QUERY_KEY = ['projects'] as const;

// ─── Realtime: single global subscription, ref-counted ────────────────
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let refCount = 0;

function patchCache(qc: QueryClient, payload: any) {
  qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (old = []) => {
    if (!old) return old;
    const { eventType, new: row, old: oldRow } = payload;
    if (eventType === 'INSERT' && row) {
      if (old.some((p) => p.id === row.id)) return old;
      return [row as Project, ...old];
    }
    if (eventType === 'UPDATE' && row) {
      return old.map((p) => (p.id === row.id ? { ...p, ...(row as Project) } : p));
    }
    if (eventType === 'DELETE' && oldRow) {
      return old.filter((p) => p.id !== (oldRow as Project).id);
    }
    return old;
  });
}

function mountRealtime(qc: QueryClient): () => void {
  refCount += 1;
  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel('projects-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'soumissions' },
        (payload) => patchCache(qc, payload),
      )
      .subscribe();
  }
  return () => {
    refCount -= 1;
    if (refCount <= 0 && realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
      refCount = 0;
    }
  };
}

// ─── Hooks ────────────────────────────────────────────────────────────
export interface UseProjectsOptions {
  statuses?: ProjectStatus[];
  enabled?: boolean;
}

export function useProjects(opts: UseProjectsOptions = {}) {
  const qc = useQueryClient();

  useEffect(() => mountRealtime(qc), [qc]);

  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('soumissions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
    select: (rows) =>
      opts.statuses
        ? rows.filter((r) => opts.statuses!.includes((r.status as ProjectStatus)))
        : rows,
  });
}

export function useProject(id?: string | null) {
  const { data } = useProjects({ enabled: !!id });
  return data?.find((p) => p.id === id) ?? null;
}

// Mutation hooks now live in `src/hooks/mutations/projectMutations.ts`.
// Re-exported here for backwards compatibility — existing imports keep working.
export {
  useUpdateProjectStatus,
  useUpdateProject,
  useArchiveProject,
  useBulkArchiveProjects,
  useUnarchiveProject,
  useDeleteProject,
  useBulkUpdateProjects,
} from './mutations/projectMutations';
