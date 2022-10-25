import { Handlers } from '../shared'

const handlers: Handlers = {
  system_chain: async (context) => {
    return context.api.rpc.system.chain()
  },
  system_properties: async (context) => {
    return context.api.rpc.system.properties()
  },
  system_name: async (context) => {
    return context.api.rpc.system.name()
  },
  system_version: async (_context) => {
    return 'chopsticks-1.1.0'
  },
  system_health: async () => {
    return {
      peers: 0,
      isSyncing: false,
      shouldhVePeers: false,
    }
  },
}

export default handlers
