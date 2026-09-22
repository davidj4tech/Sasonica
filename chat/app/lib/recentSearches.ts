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
