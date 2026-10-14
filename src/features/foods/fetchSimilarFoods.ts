import { supabase } from '@/lib/supabase'
import type { Food } from '@/lib/database.types'
import type { FoodDraft } from '@/lib/foodDraft'
import { findSimilarFoods, type SimilarFood } from '@/lib/similarFoods'

/**
 * Library foods that look like a scanned draft — same barcode, same name and
 * brand, or near-identical nutrition — checked before a barcode or label scan
 * opens the new-food form, so a re-scan can reuse the saved copy instead of
 * adding a duplicate. One pull of the live library (single user, so it's
 * small), then the pure matcher in lib/similarFoods.
 */
export async function fetchSimilarFoods(
  draft: FoodDraft,
  barcode: string | null,
): Promise<SimilarFood<Food>[]> {
  const { data, error } = await supabase
    .from('foods')
    .select('*')
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return findSimilarFoods(
    {
      name: draft.name,
      brand: draft.brand || null,
      barcode,
      serving_grams: draft.serving_grams,
      nutrients: draft.nutrients,
    },
    (data ?? []) as Food[],
  )
}
