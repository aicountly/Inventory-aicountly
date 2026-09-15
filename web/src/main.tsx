import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
// Books design language first (Tailwind + the shared token layer), then the
// dark-mode retrofit that remaps hardcoded light utilities under `.dark`, then
// the legacy Inventory stylesheet — which stays last until the final
// hand-styled screen is converted. The two variable sets do not collide:
// Books uses --color-* / --workspace-bg, Inventory uses bare --bg / --fg.
import './theme/tokens.css'
import './theme/primitives.css'
import './theme/dark-overrides.css'
import './index.css'
// The hand-written component styles for the screens that have not been
// converted yet. They used to be pulled in by layout/AppLayout.tsx, which the
// new shell replaced; importing them here keeps every un-converted screen
// styled no matter which shell renders it. Remove each line as the last
// screen using that stylesheet is converted (`grep -rn "<class>" src`).
import './components/ui.css'
import './pages/dashboard.css'
// Last: re-points the legacy zinc variables at the semantic tokens above, so
// an un-converted screen follows the chosen accent and the `.dark` toggle
// instead of its own `prefers-color-scheme` palette.
import './theme/legacy-bridge.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
