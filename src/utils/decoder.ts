import '@polkadot/types-codec'
import { Block } from '../blockchain/block'
import { HexString } from '@polkadot/util/types'
import { StorageEntry } from '@polkadot/types/primitive/types'
import { StorageKey } from '@polkadot/types'
import { create } from 'jsondiffpatch'
import { hexToU8a, u8aToHex } from '@polkadot/util'
import _ from 'lodash'

const diffPatcher = create({ array: { detectMove: false } })

const cache: Record<HexString, StorageEntry> = {}

const getStorageEntry = async (block: Block, key: HexString) => {
  for (const [prefix, storageEntry] of Object.entries(cache)) {
    if (key.startsWith(prefix)) return storageEntry
  }
  const meta = await block.meta
  for (const module of Object.values(meta.query)) {
    for (const storage of Object.values(module)) {
      const keyPrefix = u8aToHex(storage.keyPrefix())
      if (key.startsWith(keyPrefix)) {
        cache[keyPrefix] = storage
        return storage
      }
    }
  }
  throw new Error(`Cannot find key ${key}`)
}

export const decodeKey = async (block: Block, key: HexString): Promise<[StorageEntry | undefined, StorageKey]> => {
  const meta = await block.meta
  const storage = await getStorageEntry(block, key).catch(() => undefined)
  const decodedKey = meta.registry.createType('StorageKey', key)
  if (storage) {
    decodedKey.setMeta(storage.meta)
  }
  return [storage, decodedKey]
}

export const decodeKeyValue = async (block: Block, key: HexString, value?: HexString | null) => {
  const meta = await block.meta
  const [entry, storageKey] = await decodeKey(block, key)

  if (!entry) {
    return { [key]: value }
  }

  const decodedValue = meta.registry.createType(storageKey.outputType, hexToU8a(value))

  switch (storageKey.args.length) {
    case 2: {
      return {
        [entry.section]: {
          [entry.method]: {
            [storageKey.args[0].toString()]: {
              [storageKey.args[1].toString()]: decodedValue.toHuman(),
            },
          },
        },
      }
    }
    case 1: {
      return {
        [entry.section]: {
          [entry.method]: {
            [storageKey.args[0].toString()]: decodedValue.toHuman(),
          },
        },
      }
    }
    default:
      return {
        [entry.section]: {
          [entry.method]: decodedValue.toHuman(),
        },
      }
  }
}

export const decodeStorageDiff = async (block: Block, diff: [HexString, HexString | null][]) => {
  const parent = await block.parentBlock
  if (!parent) throw new Error('Cannot find parent block')

  const oldState = {}
  const newState = {}
  for (const [key, value] of diff) {
    _.merge(oldState, await decodeKeyValue(block, key as HexString, (await parent.get(key)) as any))
    _.merge(newState, await decodeKeyValue(block, key as HexString, value))
  }
  return [oldState, newState, diffPatcher.diff(oldState, newState)]
}
