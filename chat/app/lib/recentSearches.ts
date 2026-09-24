/**
 * The last few searches, per device (localStorage), newest first. Saved when
 * a search is submitted or one of its results is opened — not on every
 * keystroke of an as-you-type search.
 */
const KEY = 'sasonica.chat.recentSearches'
const MAX = 8

export function recentSearches(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX) : []
  } catch {
    return []
  }
}

export function rememberSearch(q: string): string[] {
  const text = q.trim()
  if (!text) return recentSearches()
  const next = [text, ...recentSearches().filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(0, MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // This visit only.
  }
  return next
}

export function forgetSearches() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing kept anyway.
  }
}

/**
 * What is in the search box, kept as it is typed: leaving the screen any way
 * (the back arrow, a tab, the app closed) and coming back to ⌕ finds the
 * same words. The ✕ empties it.
 */
const DRAFT_KEY = 'sasonica.chat.searchDraft'

export function searchDraft(): string {
  try {
    return window.localStorage.getItem(DRAFT_KEY) || ''
  } catch {
    return ''
  }
}

export function keepSearchDraft(text: string) {
  try {
    if (text.trim()) window.localStorage.setItem(DRAFT_KEY, text)
    else window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // This visit only.
  }
}
