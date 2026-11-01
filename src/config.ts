/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { CHAIN } from '@/lib/network'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(CHAIN.id, CHAIN.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [CHAIN, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [CHAIN.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
