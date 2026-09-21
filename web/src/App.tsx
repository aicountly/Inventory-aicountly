import { useEffect } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { AccessProvider } from './access/AccessContext'
import { useAuth } from './auth/AuthProvider'
import { CompanyProvider } from './company/CompanyContext'
import SignIn from './pages/SignIn'
import { KeyboardProvider } from './keyboard/KeyboardProvider'
import { AppRoutes } from './router'
import { ThemeProvider } from './theme/ThemeProvider'
import { ToastProvider } from './ui/ToastContext'
import { initAnalytics, trackPageView } from './utils/analytics'
import './App.css'

initAnalytics()

/** One GA4 page view per client-side navigation. */
function RouteAnalytics() {
  const location = useLocation()
  useEffect(() => {
    trackPageView(location.pathname)
  }, [location.pathname])
  return null
}

/**
 * Sign-in stays exactly as it was: the portal callback lands on /auth/callback,
 * the SPA history fallback serves this document, and AuthProvider consumes the
 * token at boot. Only once the session exists does the router — and with it the
 * company / financial-year / branch scope and the user's permissions — mount.
 */
export default function App() {
  const { status } = useAuth()

  useEffect(() => {
    if (status === 'signed-out') trackPageView('/sign-in', 'Sign in')
  }, [status])

  if (status === 'authenticated') {
    return (
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <CompanyProvider>
              <AccessProvider>
                {/* Inside AccessProvider, not above it: the keyboard handler has
                    to know what the user may do before it runs a command, and
                    a shortcut that fires because permissions were not loaded yet
                    is a shortcut that ignores permissions. Nothing between the
                    two registers a keyboard scope, so the move costs nothing. */}
                <KeyboardProvider>
                  <RouteAnalytics />
                  <AppRoutes />
                </KeyboardProvider>
              </AccessProvider>
            </CompanyProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    )
  }
  if (status === 'signed-out') return <SignIn />

  return (
    <main className="screen">
      <div className="panel">
        <p className="message">Signing you in…</p>
      </div>
    </main>
  )
}
