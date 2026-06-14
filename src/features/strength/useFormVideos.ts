import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FormVideo } from '@/lib/database.types'

const BUCKET = 'form-videos'
const SIGNED_URL_TTL = 60 * 60 // 1 hour

// Storage keys can't carry ':' cleanly; custom keys are 'custom:<uuid>'.
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function extFor(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop() : ''
  if (fromName) return fromName.toLowerCase()
  if (file.type === 'video/quicktime') return 'mov'
  if (file.type === 'video/webm') return 'webm'
  return 'mp4'
}

// The current form video for one exercise + a fresh signed playback URL.
// One row per exercise (keep-last-1), so this is a single record or null.
export function useFormVideo(exerciseKey: string | undefined) {
  return useQuery({
    queryKey: ['formVideo', exerciseKey],
    enabled: !!exerciseKey,
    // Signed URL is valid 1h; refetch comfortably before it lapses.
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<{ row: FormVideo; url: string } | null> => {
      const { data, error } = await supabase
        .from('form_videos')
        .select('*')
        .eq('exercise_key', exerciseKey!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const row = data as FormVideo
      const { data: signed, error: sErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL)
      if (sErr) throw sErr
      return { row, url: signed.signedUrl }
    },
  })
}

// Upload a clip, point the (single) row at it, then delete the prior file.
export function useUploadFormVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      exercise_key: string
      file: File
      duration_sec?: number | null
    }): Promise<FormVideo> => {
      const { data: u } = await supabase.auth.getUser()
      const user_id = u.user?.id
      if (!user_id) throw new Error('Not signed in')

      // Existing clip (if any) so we can drop its file after replacing.
      const { data: prev } = await supabase
        .from('form_videos')
        .select('*')
        .eq('exercise_key', v.exercise_key)
        .maybeSingle()
      const prevPath = (prev as FormVideo | null)?.storage_path

      const path = `${user_id}/${safeKey(v.exercise_key)}/${crypto.randomUUID()}.${extFor(v.file)}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, v.file, {
          contentType: v.file.type || 'video/mp4',
          upsert: false,
        })
      if (upErr) throw upErr

      const row = {
        user_id,
        exercise_key: v.exercise_key,
        storage_path: path,
        duration_sec: v.duration_sec ?? null,
        size_bytes: v.file.size,
        created_at: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('form_videos')
        .upsert(row, { onConflict: 'user_id,exercise_key' })
        .select('*')
        .single()
      if (error) {
        // Don't leave an orphaned file if the row write fails.
        await supabase.storage.from(BUCKET).remove([path])
        throw error
      }

      // Keep-last-1: remove the previous file now the row points elsewhere.
      if (prevPath && prevPath !== path) {
        await supabase.storage.from(BUCKET).remove([prevPath])
      }
      return data as FormVideo
    },
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ['formVideo', data.exercise_key] }),
  })
}

export function useDeleteFormVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { exercise_key: string; storage_path: string }) => {
      await supabase.storage.from(BUCKET).remove([v.storage_path])
      const { error } = await supabase
        .from('form_videos')
        .delete()
        .eq('exercise_key', v.exercise_key)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['formVideo', v.exercise_key] }),
  })
}
