/**
 * What the Android shell needs from the app's life, rendered once in root:
 * a tap on a "New reply" notification opens that thread, and once paired the
 * app asks (once) to be allowed to post them. Nothing on the web.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { hasCredential } from '../api/auth'
import { askNotificationPermission, isNative, onNotificationTap } from '../lib/native'

export function NativeHooks() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => onNotificationTap((session) => navigate(`/t/${encodeURIComponent(session)}`)), [navigate])
  useEffect(() => {
    if (isNative() && location.pathname !== '/pairing' && hasCredential()) void askNotificationPermission()
  }, [location.pathname])
  return null
}
