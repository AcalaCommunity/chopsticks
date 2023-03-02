import { hexToU8a } from '@polkadot/util'

import { Blockchain } from '../blockchain'
import { compactHex, getParaId } from '../utils'
import { logger } from '.'

export const connectUpward = async (parachain: Blockchain, relaychain: Blockchain) => {
  const meta = await parachain.head.meta
  const paraId = await getParaId(parachain)
  const upwardMessagesKey = compactHex(meta.query.parachainSystem.upwardMessages())

  await parachain.headState.subscribeStorage([upwardMessagesKey], async (_head, pairs) => {
    const value = pairs[0][1]
    if (!value) return

    const meta = await relaychain.head.meta

    const upwardMessages = meta.registry.createType('Vec<Bytes>', hexToU8a(value))
    if (upwardMessages.length === 0) return

    const queueSize = meta.registry.createType('(u32, u32)', [
      upwardMessages.length,
      upwardMessages.map((x) => x.byteLength).reduce((s, i) => s + i, 0),
    ])
    const needsDispatch = meta.registry.createType('Vec<u32>', [paraId])

    logger.debug({ [paraId.toNumber()]: upwardMessages.toJSON(), queueSize: queueSize.toJSON() }, 'upward_message')

    // TODO: make sure we append instead of replace
    relaychain.head.pushStorageLayer().setAll([
      [compactHex(meta.query.ump.needsDispatch()), needsDispatch.toHex()],
      [compactHex(meta.query.ump.relayDispatchQueues(paraId)), upwardMessages.toHex()],
      [compactHex(meta.query.ump.relayDispatchQueueSize(paraId)), queueSize.toHex()],
    ])

    await relaychain.newBlock()
  })
}
