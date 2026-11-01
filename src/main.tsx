/*
 *  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
 *  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 *  ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 *  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
 *
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { MotionConfig } from 'framer-motion'
import ErrorBoundary from './components/ErrorBoundary'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import { LangProvider } from './lib/LangContext'
import './index.css'

const queryClient = new QueryClient()

// Lite mode (set in index.html before first paint) turns off motion for low-end phones / reduced-motion users.
const lite = document.documentElement.classList.contains('lite')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>
          <LangProvider>
            <MotionConfig reducedMotion={lite ? 'always' : 'user'}>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </MotionConfig>
          </LangProvider>
          <Toaster position="top-center" />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

