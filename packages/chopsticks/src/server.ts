import { AddressInfo, WebSocket, WebSocketServer } from 'ws'
import { ResponseError, SubscriptionManager } from '@acala-network/chopsticks-core'
import { z } from 'zod'
import http from 'node:http'

import { defaultLogger, truncate } from './logger.js'

const httpLogger = defaultLogger.child({ name: 'http' })
const wsLogger = defaultLogger.child({ name: 'ws' })

const singleRequest = z.object({
  id: z.number(),
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.array(z.any()).default([]),
})

const batchRequest = z.array(singleRequest)

const requestSchema = z.union([singleRequest, batchRequest])

export type Handler = (
  data: { method: string; params: string[] },
  subscriptionManager: SubscriptionManager,
) => Promise<any>

const parseRequest = (request: string) => {
  try {
    return JSON.parse(request)
  } catch (e) {
    return undefined
  }
}

const readBody = (request: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const bodyParts: any[] = []
    request
      .on('data', (chunk) => {
        bodyParts.push(chunk)
      })
      .on('end', () => {
        resolve(Buffer.concat(bodyParts).toString())
      })
  })

const subscriptionManager = {
  subscribe: () => {
    throw new Error('Subscription is not supported')
  },
  unsubscribe: () => {
    throw new Error('Subscription is not supported')
  },
}

export const createServer = async (handler: Handler, port: number) => {
  let wss: WebSocketServer | undefined
  let listenPort: number | undefined

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        throw new Error('Only POST method is supported')
      }
      const body = await readBody(req)
      const parsed = await requestSchema.safeParseAsync(parseRequest(body))

      if (!parsed.success) {
        httpLogger.error('Invalid request: %s', body)
        throw new Error('Invalid request: ' + body)
      }

      httpLogger.trace({ req: parsed.data }, 'Received request')

      let response: any
      if (Array.isArray(parsed.data)) {
        response = await Promise.all(parsed.data.map((req) => handler(req, subscriptionManager)))
      } else {
        response = await handler(parsed.data, subscriptionManager)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify(response))
      res.end()
    } catch (err: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            message: err.message,
          },
        }),
      )
      res.end()
    }
  })

  for (let i = 0; i < 10; i++) {
    const preferPort = port ? port + i : undefined
    wsLogger.debug('Try starting on port %d', preferPort)
    const success = await new Promise<boolean>((resolve) => {
      server.listen(preferPort, () => {
        wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 * 100 })
        listenPort = (server.address() as AddressInfo).port
        resolve(true)
      })
      server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          server.close()
          resolve(false)
        }
      })
    })
    if (success) {
      break
    }
  }

  if (!wss || !listenPort) {
    throw new Error(`Failed to create WebsocketServer at port ${port}`)
  }

  wss.on('connection', (ws) => {
    wsLogger.debug('New connection')

    const send = (data: object) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    }

    const subscriptions: Record<string, (subid: string) => void> = {}
    const subscriptionManager = {
      subscribe: (method: string, subid: string, onCancel: () => void = () => {}) => {
        subscriptions[subid] = onCancel
        return (data: object) => {
          if (subscriptions[subid]) {
            wsLogger.trace({ method, subid, data: truncate(data) }, 'Subscription notification')
            send({
              jsonrpc: '2.0',
              method,
              params: {
                result: data,
                subscription: subid,
              },
            })
          }
        }
      },
      unsubscribe: (subid: string) => {
        if (subscriptions[subid]) {
          subscriptions[subid](subid)
          delete subscriptions[subid]
        }
      },
    }

    const processRequest = async (req: Zod.infer<typeof singleRequest>) => {
      wsLogger.trace(
        {
          id: req.id,
          method: req.method,
        },
        'Received message',
      )

      try {
        const resp = await handler(req, subscriptionManager)
        wsLogger.trace(
          {
            id: req.id,
            method: req.method,
            result: truncate(resp),
          },
          'Response for request',
        )
        return {
          id: req.id,
          jsonrpc: '2.0',
          result: resp ?? null,
        }
      } catch (e) {
        wsLogger.info('Error handling request: %o', (e as Error).stack)
        return {
          id: req.id,
          jsonrpc: '2.0',
          error: e instanceof ResponseError ? e : { code: -32603, message: `Internal ${e}` },
        }
      }
    }

    ws.on('close', () => {
      wsLogger.debug('Connection closed')
      for (const [subid, onCancel] of Object.entries(subscriptions)) {
        onCancel(subid)
      }
      ws.removeAllListeners()
    })
    ws.on('error', () => {
      wsLogger.debug('Connection error')
      for (const [subid, onCancel] of Object.entries(subscriptions)) {
        onCancel(subid)
      }
      ws.removeAllListeners()
    })

    ws.on('message', async (message) => {
      const parsed = await requestSchema.safeParseAsync(parseRequest(message.toString()))
      if (!parsed.success) {
        wsLogger.error('Invalid request: %s', message)
        send({
          id: null,
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid JSON Request',
          },
        })
        return
      }

      const { data: req } = parsed
      if (Array.isArray(req)) {
        wsLogger.trace({ req }, 'Received batch request')
        const resp = await Promise.all(req.map(processRequest))
        send(resp)
      } else {
        wsLogger.trace({ req }, 'Received single request')
        const resp = await processRequest(req)
        send(resp)
      }
    })
  })

  return {
    port: listenPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss?.clients.forEach((socket) => socket.close())
        wss?.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      }),
  }
}
