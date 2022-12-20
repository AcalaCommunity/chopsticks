import { ProviderInterface } from '@polkadot/rpc-provider/types'

import { Api } from '@chopsticks/api'
import { Blockchain } from '@chopsticks/blockchain'
import { defaultLogger } from '@chopsticks/logger'

export const logger = defaultLogger.child({ name: 'rpc' })

export class ResponseError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.message = message
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
    }
  }
}

export interface Context {
  chain: Blockchain
  api: Api
  ws: ProviderInterface
}

export interface SubscriptionManager {
  subscribe: (method: string, subid: string, onCancel?: () => void) => (data: any) => void
  unsubscribe: (subid: string) => void
}

export type Handler = (
  context: Context,
  params: any[],
  subscriptionManager: SubscriptionManager
) => Promise<object | string | number | void | undefined | null>
export type Handlers = Record<string, Handler>
