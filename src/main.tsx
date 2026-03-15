import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import '@lichess-org/chessground/assets/chessground.base.css'
// Board
import '@lichess-org/chessground/assets/chessground.brown.css'
// Pieces
import '@lichess-org/chessground/assets/chessground.cburnett.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
