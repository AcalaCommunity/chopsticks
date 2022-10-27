# Chopsticks

Create parallel reality of your Substrate network.

## Install

Make sure you have setup Rust environment (>= 1.64).

- Clone repository with submodules ([smoldot](https://github.com/paritytech/smoldot))
  - `git clone --recurse-submodules https://github.com/AcalaNetwork/chopsticks.git && cd chopsticks`
- Install deps
  - `yarn`
- Build wasm
  - `yarn build-wasm`

## Run

- Replay latest block

  - `yarn start run-block --endpoint=wss://acala-rpc-2.aca-api.network/ws`
  - This will replay the last block and print out the changed storages

- Run a test node
  - `yarn start dev --endpoint=wss://acala-rpc-2.aca-api.network/ws`
  - You have a test node running at `ws://localhost:8000`
  - You can use [Polkadot.js Apps](https://polkadot.js.org/apps/) to connect to this node
  - Submit any transaction to produce a new block in the in parallel reality

Next step:

- Disable signature verification
- API for arbitrary storage override
