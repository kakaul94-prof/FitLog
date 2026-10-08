import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FormVideo } from '@/lib/database.types'

const BUCKET = 'form-videos'
const SIGNED_URL_TTL = 60 * 60 // 1 hour

/** Clips kept per exercise; a save past this replaces one the user picks. */
export const MAX_CLIPS = 3

export type FormClip = { row: FormVideo; url: string }

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

// An exercise's clips, newest first, each with a fresh signed playback URL.
export function useFormVideos(exerciseKey: string | undefined) {
  return useQuery({
    queryKey: ['formVideos', exerciseKey],
    enabled: !!exerciseKey,
    // Signed URLs are valid 1h; refetch comfortably before they lapse.
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<FormClip[]> => {
      const { data, error } = await supabase
        .from('form_videos')
        .select('*')
        .eq('exercise_key', exerciseKey!)
        .order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as FormVideo[]
      if (!rows.length) return []
      const { data: signed, error: sErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(
          rows.map((r) => r.storage_path),
          SIGNED_URL_TTL,
        )
      if (sErr) throw sErr
      return rows.map((row, i) => ({ row, url: signed[i]?.signedUrl ?? '' }))
    },
  })
}

// Upload a clip as a new row, or — with replace_id — repoint that row at the
// new file (one atomic update) and then delete the file it used to hold.
export function useUploadFormVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      exercise_key: string
      file: File
      duration_sec?: number | null
      replace_id?: string
    }): Promise<FormVideo> => {
      const { data: u } = await supabase.auth.getUser()
      const user_id = u.user?.id
      if (!user_id) throw new Error('Not signed in')

      let prevPath: string | undefined
      if (v.replace_id) {
        const { data: prev } = await supabase
          .from('form_videos')
          .select('storage_path')
          .eq('id', v.replace_id)
          .maybeSingle()
        prevPath = (prev as { storage_path: string } | null)?.storage_path
      }

      const path = `${user_id}/${safeKey(v.exercise_key)}/${crypto.randomUUID()}.${extFor(v.file)}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, v.file, {
          contentType: v.file.type || 'video/mp4',
          upsert: false,
        })
      if (upErr) throw upErr

      const fields = {
        storage_path: path,
        duration_sec: v.duration_sec ?? null,
        size_bytes: v.file.size,
        created_at: new Date().toISOString(),
      }
      const { data, error } = v.replace_id
        ? await supabase
            .from('form_videos')
            .update(fields)
            .eq('id', v.replace_id)
            .select('*')
            .single()
        : await supabase
            .from('form_videos')
            .insert({ ...fields, user_id, exercise_key: v.exercise_key })
            .select('*')
            .single()
      if (error) {
        // Don't leave an orphaned file if the row write fails.
        await supabase.storage.from(BUCKET).remove([path])
        throw error
      }

      if (prevPath && prevPath !== path) {
        await supabase.storage.from(BUCKET).remove([prevPath])
      }
      return data as FormVideo
    },
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ['formVideos', data.exercise_key] }),
  })
}

export function useDeleteFormVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: FormVideo) => {
      await supabase.storage.from(BUCKET).remove([v.storage_path])
      const { error } = await supabase
        .from('form_videos')
        .delete()
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['formVideos', v.exercise_key] }),
  })
}
