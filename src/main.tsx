import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { boot } from './boot'
import { SharePlayer } from './ui/SharePlayer'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')
// `?player=<shareId>` turns the same single-file build into the public story player (share pages).
const playerId = new URLSearchParams(location.search).get('player')
void boot().then(() => {
  createRoot(root).render(
    <StrictMode>{playerId ? <SharePlayer shareId={playerId} /> : <App />}</StrictMode>
  )
})
