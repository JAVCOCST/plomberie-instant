import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { PROJECTS_QUERY_KEY, type Project } from '@/hooks/useProjects';
import type { ProjectStatus } from '@/lib/project-statuses';
import {
  invalidateProjects,
  isMissingColumnError,
  patchManyProjectCache,
  patchProjectCache,
  removeProjectsFromCache,
  restoreProjects,
  snapshotProjects,
  withMutationLog,
} from './_internal';

type SoumissionUpdate = Database['public']['Tables']['soumissions']['Update'];

// ─────────────────────────────────────────────────────────────────────
// Status update
// ─────────────────────────────────────────────────────────────────────
export function useUpdateProjectStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      withMutationLog('updateProjectStatus', async () => {
        const { error } = await supabase
          .from('soumissions')
          .update({ status })
          .eq('id', id);
        if (error) throw error;
      }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      patchProjectCache(qc, id, { status } as Partial<Project>);
      return { prev };
    },
    onError: (_e, _v, ctx) => restoreProjects(qc, ctx?.prev),
    onSettled: () => invalidateProjects(qc),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Generic update
// ─────────────────────────────────────────────────────────────────────
export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SoumissionUpdate> }) =>
      withMutationLog('updateProject', async () => {
        const { error } = await supabase.from('soumissions').update(patch).eq('id', id);
        if (error) throw error;
      }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      patchProjectCache(qc, id, patch as Partial<Project>);
      return { prev };
    },
    onError: (_e, _v, ctx) => restoreProjects(qc, ctx?.prev),
    onSettled: () => invalidateProjects(qc),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Archive (with archived_at fallback to status='archived')
// ─────────────────────────────────────────────────────────────────────
async function archiveOnServer(ids: string[]): Promise<{ usedFallback: boolean }> {
  const ts = new Date().toISOString();
  const query = ids.length === 1
    ? (supabase.from('soumissions') as any).update({ archived_at: ts }).eq('id', ids[0])
    : (supabase.from('soumissions') as any).update({ archived_at: ts }).in('id', ids);
  const { error } = await query;
  if (!error) return { usedFallback: false };
  if (!isMissingColumnError(error, 'archived_at')) throw error;
  // Fallback: legacy schema without archived_at column → use status='archived'
  const fb = ids.length === 1
    ? await supabase.from('soumissions').update({ status: 'archived' } as any).eq('id', ids[0])
    : await supabase.from('soumissions').update({ status: 'archived' } as any).in('id', ids);
  if (fb.error) throw fb.error;
  return { usedFallback: true };
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      withMutationLog('archiveProject', async () => {
        const { usedFallback } = await archiveOnServer([id]);
        return { usedFallback };
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      patchProjectCache(qc, id, { archived_at: new Date().toISOString() } as Partial<Project>);
      return { prev };
    },
    onError: (_e, _id, ctx) => restoreProjects(qc, ctx?.prev),
    onSuccess: (res, id) => {
      if (res?.usedFallback) {
        patchProjectCache(qc, id, { status: 'archived', archived_at: null } as Partial<Project>);
      }
    },
    onSettled: () => invalidateProjects(qc),
  });
}

export function useBulkArchiveProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      withMutationLog('bulkArchiveProjects', async () => {
        if (ids.length === 0) return { usedFallback: false };
        return await archiveOnServer(ids);
      }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      patchManyProjectCache(qc, ids, { archived_at: new Date().toISOString() } as Partial<Project>);
      return { prev };
    },
    onError: (_e, _ids, ctx) => restoreProjects(qc, ctx?.prev),
    onSuccess: (res, ids) => {
      if (res?.usedFallback) {
        patchManyProjectCache(qc, ids, { status: 'archived', archived_at: null } as Partial<Project>);
      }
    },
    onSettled: () => invalidateProjects(qc),
  });
}

export function useUnarchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, originalStatus }: { id: string; originalStatus: string }) =>
      withMutationLog('unarchiveProject', async () => {
        const { error } = await (supabase.from('soumissions') as any)
          .update({ archived_at: null })
          .eq('id', id);
        if (!error) return;
        if (!isMissingColumnError(error, 'archived_at')) throw error;
        const fb = await supabase.from('soumissions').update({ status: originalStatus } as any).eq('id', id);
        if (fb.error) throw fb.error;
      }),
    onMutate: async ({ id, originalStatus }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      patchProjectCache(qc, id, { archived_at: null, status: originalStatus } as Partial<Project>);
      return { prev };
    },
    onError: (_e, _v, ctx) => restoreProjects(qc, ctx?.prev),
    onSettled: () => invalidateProjects(qc),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      withMutationLog('deleteProject', async () => {
        const { error } = await supabase.from('soumissions').delete().eq('id', id);
        if (error) throw error;
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      removeProjectsFromCache(qc, [id]);
      return { prev };
    },
    onError: (_e, _id, ctx) => restoreProjects(qc, ctx?.prev),
    onSettled: () => invalidateProjects(qc),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Bulk update (heterogeneous patches)
// ─────────────────────────────────────────────────────────────────────
export function useBulkUpdateProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: Array<{ id: string; patch: Partial<SoumissionUpdate> }>) =>
      withMutationLog('bulkUpdateProjects', async () => {
        // Run in parallel; first error throws → triggers rollback.
        await Promise.all(
          entries.map(async ({ id, patch }) => {
            const { error } = await supabase.from('soumissions').update(patch).eq('id', id);
            if (error) throw error;
          }),
        );
      }),
    onMutate: async (entries) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prev = snapshotProjects(qc);
      for (const { id, patch } of entries) {
        patchProjectCache(qc, id, patch as Partial<Project>);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => restoreProjects(qc, ctx?.prev),
    onSettled: () => invalidateProjects(qc),
  });
}