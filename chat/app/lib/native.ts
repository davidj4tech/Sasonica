/**
 * Inside Sasonica Next (the Capacitor Android shell) or a plain browser.
 * Capacitor injects `window.Capacitor` into its WebView; nothing here
 * imports it, so the web build carries no Capacitor code.
 */
type AppInfo = { version?: string; build?: string }
type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { App?: { getInfo?: () => Promise<AppInfo> } }
}

function cap(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True inside the Android shell. */
export function isNativeShell(): boolean {
  try {
    return !!cap()?.isNativePlatform?.()
  } catch {
    return false
  }
}

/**
 * The shell's own version ("1.2.0 (12)"), when its App plugin is there to
 * ask; null in a browser or when it is not.
 */
export async function nativeVersion(): Promise<string | null> {
  if (!isNativeShell()) return null
  try {
    const info = await cap()?.Plugins?.App?.getInfo?.()
    if (!info?.version) return null
    return info.build && info.build !== info.version ? `${info.version} (${info.build})` : info.version
  } catch {
    return null
  }
}
