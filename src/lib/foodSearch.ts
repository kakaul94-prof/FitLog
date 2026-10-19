// Food search: every word the user types must appear in the food's name OR its
// brand, in any order. So "boom chicka pop" finds "Sweet & Salty Kettle Corn ·
// Boom Chicka Pop", and punctuation ("&", "-", "'") never blocks a match.

/** Lowercased, de-duplicated letter/digit runs of a query. Punctuation splits. */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return [...new Set(words)]
}

/** Client-side match (Recent / Frequent tabs) — mirrors `foodSearchFilter`. */
export function matchesFoodSearch(
  food: { name: string; brand: string | null },
  words: string[],
): boolean {
  if (!words.length) return true
  const hay = `${food.name} ${food.brand ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** PostgREST `or` filter for the same match, or null for an empty query.
 *  Words are letters/digits only, so they can't break the filter syntax. */
export function foodSearchFilter(words: string[]): string | null {
  if (!words.length) return null
  const each = words.map((w) => `or(name.ilike.*${w}*,brand.ilike.*${w}*)`)
  return `and(${each.join(',')})`
}

/** Splits `text` into plain and matched runs so the row can highlight why a
 *  food matched. Overlapping matches merge into one run. */
export function highlightSegments(
  text: string,
  words: string[],
): { text: string; hit: boolean }[] {
  const lower = text.toLowerCase()
  // A few characters change length when lowercased; skip highlighting then.
  if (!words.length || lower.length !== text.length) return [{ text, hit: false }]
  const hits = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) {
      hits.fill(true, i, i + w.length)
    }
  }
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === hits[i]) last.text += text[i]
    else out.push({ text: text[i], hit: hits[i] })
  }
  return out
}
