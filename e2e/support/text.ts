/** Escape a literal string for use inside a RegExp (names can contain "(", "/", …). */
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Matches an accessible name that starts with `text`. */
export const startsWith = (text: string) => new RegExp(`^${escapeRegExp(text)}`)
