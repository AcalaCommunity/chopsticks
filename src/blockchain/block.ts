import { DecoratedMeta } from '@polkadot/types/metadata/decorate/types'
import { Header } from '@polkadot/types/interfaces'
import { Metadata, TypeRegistry } from '@polkadot/types'
import { StorageEntry } from '@polkadot/types/primitive/types'
import {
  compactStripLength,
  hexToString,
  hexToU8a,
  objectSpread,
  stringPascalCase,
  stringToHex,
  u8aToHex,
} from '@polkadot/util'
import { expandMetadata } from '@polkadot/types/metadata'
import { getSpecExtensions, getSpecHasher, getSpecTypes } from '@polkadot/types-known/util'
import type { ExtDef } from '@polkadot/types/extrinsic/signedExtensions/types'
import type { HexString } from '@polkadot/util/types'

import { Blockchain } from '.'
import { RemoteStorageLayer, StorageLayer, StorageLayerProvider, StorageValueKind } from './storage-layer'
import { ResponseError } from '../rpc/shared'
import { TaskResponseCall } from '../task'
import { get_metadata, get_runtime_version } from '../../executor/pkg/executor'
import { storageKeyMaker } from '../utils/set-storage'

export interface Decorated extends DecoratedMeta {
  key(storage: StorageEntry, ...keys: any[]): string
}

export type RuntimeVersion = {
  specName: string
  implName: string
  authoringVersion: number
  specVersion: number
  implVersion: number
  apis: [HexString, number][]
  transactionVersion: number
  stateVersion: number
}

export class Block {
  #chain: Blockchain

  #header?: Header | Promise<Header>
  #parentBlock?: Block | Promise<Block | undefined>
  #extrinsics?: string[] | Promise<string[]>

  #wasm?: Promise<HexString>
  #runtimeVersion?: Promise<RuntimeVersion>
  #metadata?: Promise<HexString>
  #registry?: Promise<TypeRegistry>
  #decorated?: Promise<Decorated>

  #baseStorage: StorageLayerProvider
  #storages: StorageLayer[]

  constructor(
    chain: Blockchain,
    public readonly number: number,
    public readonly hash: string,
    parentBlock?: Block,
    block?: { header: Header; extrinsics: string[]; storage?: StorageLayerProvider }
  ) {
    this.#chain = chain
    this.#parentBlock = parentBlock
    this.#header = block?.header
    this.#extrinsics = block?.extrinsics
    this.#baseStorage = block?.storage ?? new RemoteStorageLayer(chain.api, hash, chain.db)
    this.#storages = []
  }

  get header(): Header | Promise<Header> {
    if (!this.#header) {
      this.#header = Promise.all([this.registry, this.#chain.api.getHeader(this.hash)]).then(([registry, header]) =>
        registry.createType('Header', header)
      )
    }
    return this.#header
  }

  get extrinsics(): string[] | Promise<string[]> {
    if (!this.#extrinsics) {
      this.#extrinsics = this.#chain.api.getBlock(this.hash).then((b) => b.block.extrinsics)
    }
    return this.#extrinsics
  }

  get parentBlock(): undefined | Block | Promise<Block | undefined> {
    if (this.number === 0) {
      return undefined
    }
    if (!this.#parentBlock) {
      this.#parentBlock = Promise.resolve(this.header).then((h) => this.#chain.getBlock(h.parentHash.toHex()))
    }
    return this.#parentBlock
  }

  get storage(): StorageLayerProvider {
    return this.#storages[this.#storages.length - 1] ?? this.#baseStorage
  }

  async get(key: string): Promise<string | undefined> {
    const val = await this.storage.get(key, true)
    switch (val) {
      case StorageValueKind.Deleted:
        return undefined
      default:
        return val
    }
  }

  async getKeysPaged(options: { prefix?: string; startKey?: string; pageSize: number }): Promise<string[]> {
    const layer = new StorageLayer(this.storage)
    await layer.fold()

    const prefix = options.prefix ?? '0x'
    const startKey = options.startKey ?? prefix
    const pageSize = options.pageSize

    return layer.getKeysPaged(prefix, pageSize, startKey)
  }

  pushStorageLayer(): StorageLayer {
    const layer = new StorageLayer(this.storage)
    this.#storages.push(layer)
    return layer
  }

  popStorageLayer(): void {
    this.#storages.pop()
  }

  async storageDiff(): Promise<Record<string, string>> {
    const storage = {}

    for (const layer of this.#storages) {
      await layer.mergeInto(storage)
    }

    return storage
  }

  get wasm() {
    const getWasm = async (): Promise<HexString> => {
      const wasmKey = stringToHex(':code')
      const wasm = await this.get(wasmKey)
      if (!wasm) {
        throw new Error('No wasm found')
      }
      return wasm as HexString
    }

    if (!this.#wasm) {
      this.#wasm = getWasm()
    }

    return this.#wasm
  }

  setWasm(wasm: HexString): void {
    const wasmKey = stringToHex(':code')
    this.pushStorageLayer().set(wasmKey, wasm)
    this.#wasm = Promise.resolve(wasm)
    this.#registry = undefined
  }

  get registry(): Promise<TypeRegistry> {
    if (!this.#registry) {
      this.#registry = Promise.all([
        this.metadata,
        this.#chain.api.chainProperties,
        this.#chain.api.chain,
        this.runtimeVersion,
      ]).then(([data, properties, chain, version]) => {
        const registry = new TypeRegistry(this.hash)
        registry.setChainProperties(registry.createType('ChainProperties', properties))
        registry.register(getSpecTypes(registry, chain, version.specName, version.specVersion))
        registry.setHasher(getSpecHasher(registry, chain, version.specName))
        registry.setMetadata(
          new Metadata(registry, data),
          undefined,
          objectSpread<ExtDef>({}, getSpecExtensions(registry, chain, version.specName), {})
        )
        return registry
      })
    }
    return this.#registry
  }

  get runtimeVersion(): Promise<RuntimeVersion> {
    if (!this.#runtimeVersion) {
      this.#runtimeVersion = this.wasm.then(get_runtime_version).then((version) => {
        version.specName = hexToString(version.specName)
        version.implName = hexToString(version.implName)
        return version
      })
    }
    return this.#runtimeVersion
  }

  get metadata(): Promise<HexString> {
    if (!this.#metadata) {
      this.#metadata = this.wasm
        .then((code) => get_metadata(code))
        .then((data) => u8aToHex(compactStripLength(hexToU8a(data))[1]))
    }
    return this.#metadata
  }

  get decorated(): Promise<Decorated> {
    if (!this.#decorated) {
      this.#decorated = Promise.all([this.registry, this.metadata]).then(([registry, metadataStr]) => {
        const metadata = new Metadata(registry, metadataStr)
        const decorated = expandMetadata(registry, metadata)
        const keyMaker = storageKeyMaker(registry, metadata.asLatest)
        return {
          ...decorated,
          key(storage: StorageEntry, ...keys: any[]): string {
            const { makeKey } = keyMaker(stringPascalCase(storage.section), stringPascalCase(storage.method))
            return makeKey(...keys).toHex()
          },
        }
      })
    }
    return this.#decorated
  }

  async call(method: string, args: string): Promise<TaskResponseCall['Call']> {
    const wasm = await this.wasm
    const res = await new Promise<TaskResponseCall['Call']>((resolve, reject) => {
      this.#chain.tasks.addAndRunTask(
        {
          Call: {
            blockHash: this.hash,
            wasm,
            calls: [[method, args]],
          },
        },
        (r) => {
          if ('Call' in r) {
            resolve(r.Call)
          } else if ('Error' in r) {
            reject(new ResponseError(1, r.Error))
          } else {
            reject(new ResponseError(1, 'Unexpected response'))
          }
        }
      )
    })
    return res
  }
}
