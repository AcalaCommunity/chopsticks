import { z } from 'zod'
import _ from 'lodash'
import type { Argv } from 'yargs'

import { configSchema, getYargsOptions } from '../../schema/index.js'
import { fetchStorages, logger } from '../../utils/fetch-storages.js'

const schema = z.object({
  ..._.pick(configSchema.shape, ['endpoint', 'block', 'db']),
})

export const cli = (y: Argv) => {
  y.command({
    command: 'fetch-storages [items..]',
    aliases: ['fetch-storage'],
    describe: 'Fetch and save storages',
    builder: (yargs) => yargs.options(getYargsOptions(schema.shape)),
    handler: async (argv) => {
      const config = schema.parse(argv)
      if (!config.endpoint) throw new Error('endpoint is required')
      if (!config.block) throw new Error('block is required')
      if (!argv.items) throw new Error('fetch-storages items are required')

      try {
        await fetchStorages({
          block: config.block,
          endpoint: config.endpoint,
          dbPath: config.db ?? 'db.sqlite',
          config: argv.items as any,
        })
        process.exit(0)
      } catch (e) {
        logger.error(e, 'Error when fetching storages')
        process.exit(1)
      }
    },
  })
}
