import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'fitlog-theme'
// theme-color meta drives the mobile browser / installed-PWA chrome; keep these
// roughly in sync with --background in index.css.
const META_COLOR = { light: '#16a34a', dark: '#15201b' } as const

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* localStorage unavailable */
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

export function applyResolvedTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', META_COLOR[resolved])
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* localStorage unavailable */
  }
  applyResolvedTheme(resolveTheme(theme))
}

/** Re-apply the theme when the OS preference changes (only affects 'system'). */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getStoredTheme() === 'system') applyResolvedTheme(resolveTheme('system'))
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** Theme state + setter for the settings UI. */
export function useTheme(): readonly [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const update = useCallback((t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }, [])
  return [theme, update] as const
}
