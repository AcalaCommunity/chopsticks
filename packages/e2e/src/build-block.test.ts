import { afterAll, describe, expect, it } from 'vitest'

import { TypeRegistry } from '@polkadot/types'
import { decodeProof } from '@acala-network/chopsticks-core'
import { setupAll } from './helper.js'
import { upgradeRestrictionSignal } from '@acala-network/chopsticks-core/utils/proof.js'

const KUSAMA_STORAGE = {
  FellowshipCollective: {
    $removePrefix: ['IdToIndex', 'IndexToId', 'MemberCount', 'Members'],
    Voting: [],
  },
  ParasDisputes: {
    $removePrefix: ['disputes'],
  },
}

describe.runIf(process.env.CI || process.env.RUN_ALL).each([
  { chain: 'Polkadot', endpoint: ['wss://rpc.ibp.network/polkadot', 'wss://polkadot-rpc.dwellir.com'] },
  { chain: 'Statemint', endpoint: 'wss://statemint-rpc.dwellir.com' },
  { chain: 'Polkadot Collectives', endpoint: 'wss://sys.ibp.network/collectives-polkadot' },
  { chain: 'Acala', endpoint: 'wss://acala-rpc.aca-api.network' },

  {
    chain: 'Kusama',
    endpoint: ['wss://kusama-rpc.dwellir.com', 'wss://rpc.ibp.network/kusama', 'wss://kusama-rpc.polkadot.io'],
    storage: KUSAMA_STORAGE,
  },
  { chain: 'Statemine', endpoint: 'wss://statemine-rpc-tn.dwellir.com' },
  {
    chain: 'Karura',
    endpoint: 'wss://karura-rpc.aca-api.network',
  },
  { chain: 'Westend', endpoint: 'wss://westend-rpc.polkadot.io' },
  { chain: 'Westmint', endpoint: 'wss://westmint-rpc.polkadot.io' },
  { chain: 'Westend Collectives', endpoint: 'wss://sys.ibp.network/collectives-westend' },
])('Latest $chain can build blocks', async ({ endpoint, storage }) => {
  const { setupPjs, teardownAll } = await setupAll({ endpoint })

  afterAll(async () => {
    await teardownAll()
  })

  it('build blocks', { timeout: 300_000, retry: 1 }, async () => {
    const { chain, ws, teardown } = await setupPjs()
    storage && (await ws.send('dev_setStorage', [storage]))
    const blockNumber = chain.head.number
    await ws.send('dev_newBlock', [{ count: 2 }])
    expect(chain.head.number).eq(blockNumber + 2)
    await teardown()
  })

  it('build block using unsafeBlockHeight', async () => {
    const { chain, ws, teardown } = await setupPjs()
    storage && (await ws.send('dev_setStorage', [storage]))
    const blockNumber = chain.head.number
    const unsafeBlockHeight = blockNumber + 100

    // unsafeBlockHeight works
    await ws.send('dev_newBlock', [{ count: 2, unsafeBlockHeight }])
    expect(chain.head.number).eq(unsafeBlockHeight + 1)

    // unsafeBlockHeight using earlier block throw error but won't crash
    await expect(ws.send('dev_newBlock', [{ unsafeBlockHeight: blockNumber - 1 }])).rejects.toThrowError(
      '1: unsafeBlockHeight must be greater than current block height',
    )
    expect(chain.head.number).eq(unsafeBlockHeight + 1)

    await teardown()
  })

  it('build block using relayChainStateOverrides', async () => {
    const { ws, api, teardown } = await setupPjs()
    const registry = new TypeRegistry()
    const paraId = registry.createType('u32', 1000)

    const keyToOverride = upgradeRestrictionSignal(paraId)
    const value = '0x00'
    const relayChainStateOverrides = [[keyToOverride, value]]

    await ws.send('dev_newBlock', [{ relayChainStateOverrides }])
    const block = await api.rpc.chain.getBlock()
    const setValidationData = block.block.extrinsics
      .filter(({ method }) => method.method == 'setValidationData')[0]
      .method.toJSON().args.data

    const relayParentStorageRoot = setValidationData.validationData.relayParentStorageRoot
    const trieNodes = setValidationData.relayChainState.trieNodes

    const relayChainState = await decodeProof(relayParentStorageRoot, trieNodes)

    expect(relayChainState[keyToOverride]).to.be.eq(value)

    await teardown()
  })
})
