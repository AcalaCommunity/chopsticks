import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { testingPairs } from './helper'

import networks from './networks'

describe('upgrade', async () => {
  const { alice } = testingPairs()
  const acala = await networks.acala({
    blockNumber: 2000000,
  })
  const { api, dev, chain } = acala

  afterAll(async () => {
    await acala.teardown()
  })

  it('setCode works', async () => {
    await dev.setStorage({
      Sudo: {
        Key: alice.address,
      },
      System: {
        Account: [[[alice.address], { data: { free: 1000 * 1e12 } }]],
      },
    })

    const runtime = readFileSync(path.join(__dirname, '../../blobs/acala-runtime-2101.txt')).toString().trim()

    expect(await chain.head.runtimeVersion).toContain({ specVersion: 2096 })
    await api.tx.sudo.sudoUncheckedWeight(api.tx.system.setCode(runtime), '0').signAndSend(alice)
    await dev.newBlock()
    await dev.newBlock()
    expect(await chain.head.runtimeVersion).toContain({ specVersion: 2101 })
  })
})
