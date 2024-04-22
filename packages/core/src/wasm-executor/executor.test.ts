import * as Comlink from 'comlink'
import { HexString } from '@polkadot/util/types'
import { TypeRegistry } from '@polkadot/types'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import _ from 'lodash'
import path from 'node:path'

import { LightClient } from './light-client.js'
import { WELL_KNOWN_KEYS, upgradeGoAheadSignal } from '../utils/proof.js'
import {
  calculateStateRoot,
  createProof,
  decodeProof,
  emptyTaskHandler,
  getAuraSlotDuration,
  getRuntimeVersion,
  getWorker,
} from './index.js'

const getCode = _.memoize(() => {
  const code = String(readFileSync(path.join(__dirname, '../../../e2e/blobs/acala-runtime-2101.txt'))).trim()
  expect(code.length).toBeGreaterThan(2)
  return code as HexString
})

describe('wasm', () => {
  it('get runtime version from wasm runtime', async () => {
    const expectedRuntimeVersion = {
      specName: 'acala',
      implName: 'acala',
      authoringVersion: 1,
      specVersion: 2101,
      implVersion: 0,
      apis: [
        ['0xdf6acb689907609b', 4],
        ['0x37e397fc7c91f5e4', 1],
        ['0x40fe3ad401f8959a', 6],
        ['0xd2bc9897eed08f15', 3],
        ['0xf78b278be53f454c', 2],
        ['0xdd718d5cc53262d4', 1],
        ['0xab3c0572291feb8b', 1],
        ['0xbc9d89904f5b923f', 1],
        ['0x37c8bb1350a9a2a8', 1],
        ['0x6ef953004ba30e59', 1],
        ['0x955e168e0cfb3409', 1],
        ['0xe3df3f2aa8a5cc57', 2],
        ['0xea93e3f16f3d6962', 2],
      ],
      transactionVersion: 1,
      stateVersion: 0,
    }

    expect(await getRuntimeVersion(getCode())).toMatchObject(expectedRuntimeVersion)
  })

  it.each([0, 1])('calculate state root', async (trie_version) => {
    const a = await calculateStateRoot(
      [['0x5301bf5ff0298f5c7b93a446709f8e885f772afdd0d8ba3d4d559a06f0742f12', '0x01']],
      trie_version,
    )
    const b = await calculateStateRoot(
      [['0x5301bf5ff0298f5c7b93a446709f8e885f772afdd0d8ba3d4d559a06f0742f12', '0x02']],
      trie_version,
    )
    expect(a).to.not.eq(b)
  })

  it('decode & create proof works', async () => {
    // from acala chain
    const ROOT_TRIE_HASH = '0xc4bd32387544ab722ffc280ca525f0359173139012e105f5a3d6b2dfac3ad2df' as HexString
    const NODES: HexString[] = [
      '0x00005000005000000a00000000c8000000c800000a0000000a000000c8000000640000000000500000c800000700e8764817020040010a0000000000000000c0220fca950300000000000000000000c0220fca9503000000000000000000e8030000009001000a00000000000000009001008070000000000000000000000a000000050000000500000001000000010500000001c800000006000000580200005802000002000000280000000000000002000000010000000700c817a8040200400101020000000f000000',
      '0x01083c38641effe2a1c267fb16654d73afd072e5bbbb58a3cee00b6f07858d7868',
      '0x3e4f36708366b722d0070000e803000003f50fd37f063300671e2f276d68e91876612ab72ad7518ddb6a159e75ca4b16',
      '0x3e77dfdb8adb10f78f10a5df8742c545227579e09749f3e34ab4be628887563a60cd6e0666115abb30f6c64d6974e547',
      '0x3efb7902b430328be8030000490800004dadd5f43a937f4c5eb47f59c654d1e046f84d4305e32a1b5a1c07cb5e98a4a4',
      '0x3f00037b9ae336e44cf849080000e8030000e0d7f768f4e294e98d72b6afb1f2be787f1e522839f0f1fa6e6a6e06c21eaa1a',
      '0x3f0004b49d95320d9021994c850f25b8e3856ecf132adf7df9da5c37b50e50cb822f98025966c632faf46fd2995dd810aa9a',
      '0x3f000e04d2a15ab51127e8030000d0070000c016f7b201902c32853411774f3455d4a9f1cdc39eaeba8add29d4f8fa5c1fc1',
      '0x56ff6f7d467b87a9e803000080f217a51bf18a93d44906f8a3dbd8f60acb609b03c9ade7e38532e3f5f18f70e8',
      '0x5e414cb008e0e61e46722aa60abdd672802527aaef690b1334e4ec1bd567ea892286dc1265510ad57d74dd8628d4c47ad4',
      '0x5ee678799d3eff024253b90e84927cc680cc322cfedfa300d9bec6649d65f16273941d0e2f90a4c0d7173dd7c95bb02597',
      '0x800003808d3dcddf32e0537396621a5e3c9f7c48711b3dc99fe0957c8d8aa40dd7bcbbfc806a999e171342923a40a8b7f771c0174126485eac3b9f6087efe466899d7f5b97',
      '0x80001480d1c5dfd27a348dfe6d0bbba95e4c43019bd078a4bf616f6a982a6b7eab2c932080c5c3fb9143839ec1e62ace0d5f5a99d1bc410e3475c3220c568c828ac1ec31db',
      '0x8000608085f0f0216381144ea3a558c4eda8b7cd9dcb81b356269854924a9a93f325e30d4c5e7b9012096b41c4eb3aaf947f6ea429080000',
      '0x8000c0787694c040f5e73d9b7addd6cb603d15d331275d2a59e7bf2be50700000401485e4993f016e2d2f8e5f43be7bb2594860400',
      '0x80011080560567e298648a00e284dd3aa6af7a6b44eeea0db71197c0941184a30bec0a29800ebe650369ce0e3ce85b22816181f598cc6ecf7a3b22314357ab4181b9ccb867',
      '0x80011080cb5eb4cf3afaba1f4917b3a0b2a8949d14ead0ee197ed5ceb842f1dc4b077e8e8005551fedbc45ab8f835e91805bbd64583ae54ab15760d3228b76f9632ff4ecd3',
      '0x8004048021eae20fa68120da02a53f0a0a5e7755a8e3b674d1fb8a6f8dedabe09dcd648680c6a25ca6e9e85472aa01a7013074fb43bd96870ad8ddc5172bd7f0fb53ca4c04',
      '0x80046c80ad1360802f1a5bda0485e9560fd64c10e2517793cc0f318d9c47106e5555ac9080c5745910b5760c4a4f135943e551953d3dabb94e5279514d6ab6eaf17b91cf02808f83f0d8e6399e9f9d10c3c89b614e318848dfb7ecead89b137ab1fe2fa968f980bd397676b56857ae2ee2924120773a6c85d455db59762a5c8af55311daaa0e8780afe040305e535e290a394db265d697fbea9a5becfe4f83d28f226401e93e19de',
      '0x8008208040e364eaa7582164dd4954f9f8fc6889f8bdcbba89330c742dd2a4d0c1269ce1485ead6eef5c4b1c68eaa71ea17a02d9de0400',
      '0x801117806083fccc5ad9489e8fffd469466a4206a743d8dbbc8fb301059daa1d198c862880c422e1f201f01cbd2e5a02303d1c03861cfb338cad0b46c286a5a5268370943a8059237d2c3b2a6b77e8b42443bd7dc205ac3711cb4ea61c39f1e3e2b390a1ad74803f4fa21075c619be6f35e540a60b9c09863350b81cde368d6bc7a2ee1f9b77a2801ca178ca77250980616043a7d1a6e1a8a6e37587a71125c6c6966cec508bfaaf80a76019270812b3d9faa22404cc1f020c8625d4a1157a39497d41315637afadf2',
      '0x80400880fcbcbf063b26c6ca3a99f87239764ca9486c4fdb97f4808b4be0f2759783027c801b47726a6ce63798e9e1d888c24987228b80f6b83d08d385852fc116a70870cd',
      '0x804400800e02ff424c2cdbf55c38745a90c09d2beffeaf62d52f740f1832a3d20030b70e801b993ab9de16296bba47f118a7a1126ae6d0dd26d5b8ffa637e7fecd355869cc',
      '0x806100802b73884ad51a8fbc991a561eafdeb661547c392fc7b7c1308720426047334a56802bcbb911d0ee8dc29b6daf7f708abe95a6a0567eda7ea3eb221f49574f9588cb8082f82603ceab935eebad4301b38f9b2e4e4a00d3b07e82b33cb0fccd7078b8f0',
      '0x80881480b069eee40f11fc5d317ca13781e07aee384b05f34cc871c13dc374da0b678871807d18616411a5bfcd48e9dfa123d1a3cecbe573b6429c581566808d17e99371178058bcc3c531d3f1c3f4b597cb634f35bc289c6bfb7ac75fbf9e6bf0dc3f816095803b5d80223a4e8537a252fbfc55c623601f2fc28988d50d3b24bb2b572dcf07f7',
      '0x80ffff802591f85f4575a1012d08f28f540fc46be19b95789c68251e8b4e58a5b1d38f4e80e2e1ff0102a59573499c93eab4e40477cdcf4aa943cf47cc9566c9fcb9fbaa6f8069d15839ce8b12d9bf37f71bb55a414f3fef17639b3411610938de934d33a2578018e2f0343e0209f3b610d739f5a32238addc413f0c995813f44d8b79b5123ad78031ee189b2cceb0b7aa26d146c419f1cc92f4cad1175cafeab167f4e60b3a92fb80352c2c9c93a9307db295ab2bb3cf75ba90e5bd6f17a35829b3eee70e1d0f11c78059ec5cbc14930b43f021aea4c5c7d76628707fca554c99fcad26287c561e1fae809aff84bd2c7c5fbd26d7060441da82ee121a6769ff1ad8d8486da33c6b8de68680302b1973a7fcd94411ee507fd8386e3220a1e43a3b4638f90b67f63bdb1d31f080e329dbb967a6ffed82a76a123e3ca2c840ae7561e575b9ca47b15281cbd539f6803cf414393b7f6254ec03e3bbfc681d9d10336e071ab7db932b7b492cbf5a23ef80cc2e9c1a5052aee1841b9a0659921081de61b69bf3828cea88e38b40f1f638328090c8f435a864b533689a5c644e1f1334ed8b70470c18a4a61c119de55b925cbf80a0fabbe4e174dd722dbeb8dbea7c2ad4202db3452d3c7a1b46465c476ed8dfab80c254cbbcb1c9b23b31a7a9493aea310a02701821d53c662a1ab2f532d8bbcebb80ba09b896b3bf8bebaae13ee3acd42eecccf741a459de4d13a039cc38ff6f8537',
      '0x9d007f03cfdce586301014700e2c2593d1408037558a1fb12a1518eaed1ab20fd9dfb969195c0558e6968e803fcdd49b22a665505f0e7b9012096b41c4eb3aaf947f6ea429080100685f0d9ef3b78afddab7f5c7142131132ad4200700000000000000585f02275f64c354954352b71eea39cfaca210070000004c5f0ec2d17a76153ff51817f12d9cfc3c7f0400',
      '0x9d0da05ca59913bc38a8630590f2627c17cc80ada96cb0f23bab44fe7f72a35a0289a82412bab9df1f65a38a376e407564447080c208804fb9b3b0d5906eb36f941e821db3f79cb3210ca8aa4c0560dcc27980534c5f0a351b6a99a5b21324516e668bb86a570400505f0e7b9012096b41c4eb3aaf947f6ea42908000080d3d7e5b33909b7506ff3f4288e07480c887d770ad83279449ad897c52e860981806cd0f6c81a62ca3f64b814ca60b557a6d6f5ef9c8dbb343e43b70904fe6342408089da5fa144156e408c4304495a7fb1a7aaa35c5e84e2aee48a1cc46fce8a2d4380faa229c2dbfea7ecf83e772ea2bc6e7bf8f77ff9b247e7ac953be64c15c498d6',
      '0x9e710b30bd2eab0352ddcc26417aa1945fd380f902c7e36a12b97ee922975f8e193d8ac274f92e57bf4864a7f9d8a8310d42778054f8bc9c35c04bc8f8fb8b55ad9798ee5bdd0ce883abbe1cf2b8dccf6b63bae38068dc915f635f57b9645aa8cbf2b4767b7f463e3bd2dc5a9d059d8c619f20ee7d80e27fb4ee6d6de3115c5799ec359a290e0938017f364155a386ed7cd679535f2f80b410d238b5ea7604f4adbf263a38dbfa89c95d81628847f95eb667e8d0e935914c5f03c716fb8fff3de61a883bb76adb34a20400806e5300961d28a5392da3972bb0bdb8ca9be82405b6ad11168c7f65564335f05d80b51f79412da4b52f974b1863428a781abdf82fcfe5303f0ee9f6055163e05cb880d2313d845e5c3d686852cf3f674db12f44774e297fa99264d5372698f060e9eb80055f06e3df73a3b5c54ed6142b4ec2c469ae150d186720efad34e5b1d90002c28025c5e33656aa3c4a3f46ff0c2320415b595aa720141804e4b93ce1a5cb018cd6',
      '0x9e7fefc408aac59dbfe80a72ac8e3ce5468e8035c03cbd95c5beb698a3b87d99f275ce56ed9b570834bf0d97b445b32053c63a80cec0c3cac8e7976ba95ceba6ea1ed254a411a934f67250111a7ab0f1b7de297e80b9d6c0fdb4ef08ec7c391136b89a9def4ea1d6e236f3ef3dfe887ea2cece7b9780c09d1302a5612a61a89fe350ef7ba0eb641142e2bb5056de32fb714646c8918f80df275436695ad25cd3a5fe90404dc65cb87c295d8734e0d80842290e937781ce805293d6044895954b1e64a93afce17f36caa6f13b56d79f59e78bc260b874af128016905a55c43e598bd30656aef40d387fd8e349e52c9d893d3305522076ecbd2d',
      '0x9eb6f36e027abb2091cfb5110ab5087ff96e685f06155b3cd9a8c9e5e9a23fd5dc13a5ed205d49a91000000000685f08316cbf8fa0da822a20ac1c55bf1be320a262000000000000505f0e7b9012096b41c4eb3aaf947f6ea429080000804b52af07ae7c144ab840c935473b347354f231fb3a80d2f3ea71a772fefb5dae800246d6515636d2cd5e0e9e8be46c0416b4ec028c97ccaad1f835886c072e605e80b06947b43b690f37d4acce3df0061e956e4b4249d58b80519935833c2c4eb0e6800d49fef039517cc312c00412803ca1df50ac6d90c50541f649a9c85b83c0fdd8800925b33e802ae211ff9608cd17a70d58f6c881a8413bff52f2082d5d1aea523f80c76e141fe5b370031f4af2b88d2b5763508b85f07354ad316889470c91b1a7c7805e2c5f935807eab33eca8578985b079ef17d879194d0e558ae161c12e5becba3685f090e2fbf2d792cb324bffa9427fe1f0e20705be100ae5de100',
      '0x9ede3d8a54d27e44a9d5ce189618f22d3008505f0e7b9012096b41c4eb3aaf947f6ea4290804004c5f03b4123b2e186e07fb7bad5dda5f55c0040080b1aeb762fd53930254c3606ea053a0ed0c27dcb366a5f76a0287a614a2778141',
      '0x9ef78c98723ddc9073523ef3beefda0c100480fbf608307552459576f89f9453c05cc6c82ae6409cc1e41428d26aea1437e38080100bb2edb0d5bbda8059b7f4aaebea91668deeb094fb253085ecfe50f3a03411',
      '0x9f012b746dcf32e843354583c9702cc02040884c5703f5a4efb16ffa83d00700001404e80300005c5706ff6f7d467b87a9e80300002408d0070000490800004c570c7327a2a48bf2b1490800001404e8030000',
      '0x9f06604cff828a6e3f579ca6c59ace013d1060800ae7a4a0f7860d3f239f9a32598051e047ce7e2b3b5cd03658db5e641b7804b48027975fc7eea2230de9550571d1b818a3db2fe6189783b2a074b30645f4640e7c80afa7b241af9586d7e3be5d39d8c6f94456af57ae16ff5ebe0cb4247df3c33245',
      '0x9f0d3719f5b0b12c7105c073c50744594840884c5703f5a4efb16ffa83d00700001404e80300005c5706ff6f7d467b87a9e80300002408d0070000490800004c570c7327a2a48bf2b1490800001404e8030000',
      '0xe803000000900100009001000000000000000000019610eef1fd7494a38c96c564cf855c1721bf19d1405009c127639ce7d5355f2e00c0220fca950300000000000000000000c0220fca9503000000000000000000',
      '0xe80300000090010000900100000000000000000001fbed1abf9b42096280ced5be808f91c477e4f35aa778310f01e7148b7cdec90d00c0220fca950300000000000000000000c0220fca9503000000000000000000',
      '0xe80300000090010000900100010000000b0000000111f3c34f5c109cdd47e1d6fea8733bd9b41380f8f79fbe4c7e8b9b106ac67fb100c0220fca950300000000000000000000c0220fca9503000000000000000000',
      '0xe80300000090010000900100010000000b000000017c405a6532420945ce44b138c81ad47e030c8886a344b3f021a5f5ebe744f4ab00c0220fca950300000000000000000000c0220fca9503000000000000000000',
    ]

    const registry = new TypeRegistry()
    const paraId = registry.createType('u32', 1000)

    const upgradeKey = upgradeGoAheadSignal(paraId)

    const originalDecoded = await decodeProof(ROOT_TRIE_HASH, NODES)
    expect(originalDecoded).toMatchSnapshot()
    expect(originalDecoded[upgradeKey]).toBeUndefined()

    const config = registry.createType('HostConfiguration', originalDecoded[WELL_KNOWN_KEYS.ACTIVE_CONFIG])
    expect(config.toJSON()).toMatchSnapshot()

    const goAhead = registry.createType('UpgradeGoAhead', 'GoAhead')
    const { trieRootHash, nodes } = await createProof(NODES, [
      [WELL_KNOWN_KEYS.ACTIVE_CONFIG, originalDecoded[WELL_KNOWN_KEYS.ACTIVE_CONFIG]],
      [WELL_KNOWN_KEYS.CURRENT_BLOCK_RANDOMNESS, originalDecoded[WELL_KNOWN_KEYS.CURRENT_BLOCK_RANDOMNESS]],
      [upgradeKey, goAhead.toHex()],
    ])
    expect(trieRootHash).toMatchSnapshot()
    expect(nodes).toMatchSnapshot()
    const decoded = await decodeProof(trieRootHash, nodes)
    expect(decoded).toMatchSnapshot()
    expect(decoded[upgradeKey]).toBe('0x01')
  })

  it('get aura slot duration', async () => {
    const slotDuration = await getAuraSlotDuration(getCode())
    expect(slotDuration).eq(12000)
  })

  it('handles panic', async () => {
    const worker = await getWorker()

    await expect(() =>
      worker.remote.testing(
        Comlink.proxy({
          ...emptyTaskHandler,
          getStorage: () => {
            throw new Error('panic')
          },
        }),
        '0x0000',
      ),
    ).rejects.toThrowError('panic')

    // ensure the worker is still good
    const slotDuration = await getAuraSlotDuration(getCode())
    expect(slotDuration).eq(12000)
  })

  it('LightClient works', async () => {
    const lightClient = new LightClient({
      genesisBlockHash: '0xfc41b9bd8ef8fe53d58c7ea67c794c7ec9a73daf05e6d54b14ff6342c99ba64c',
      bootnodes: [
        '/dns/acala-bootnode-4.aca-api.network/tcp/30334/ws/p2p/12D3KooWBLwm4oKY5fsbkdSdipHzYJJHSHhuoyb1eTrH31cidrnY',
      ],
    })
    await lightClient.isReady

    const block = await lightClient.queryBlock('0x15177d4bdc975077b85261c09503bf40932aae9d3a7a2e948870afe3432976be')
    expect(block).toMatchSnapshot()

    const storage = await Promise.all(
      [
        '0x45323df7cc47150b3930e2666b0aa313c522231880238a0c56021b8744a00743',
        '0x26aa394eea5630e07c48ae0c9558cef734abf5cb34d6244378cddbf18e849d96',
        '0x45323df7cc47150b3930e2666b0aa31362f8058e9dc65b738fce4a22e26fa4f2',
      ].map((key) =>
        lightClient.queryStorage(
          [key as HexString],
          '0x15177d4bdc975077b85261c09503bf40932aae9d3a7a2e948870afe3432976be',
        ),
      ),
    )
    expect(storage).toMatchSnapshot()
  }, 10000)
})
