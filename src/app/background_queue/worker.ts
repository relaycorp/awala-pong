/* istanbul ignore file */
// Can't unit test this file because logic runs at the module level. I don't like this about Bull.

import { Job } from 'bull';

import { initVaultKeyStore } from '../backingServices/vault';
import { Config } from '../utilities/config/Config';
import { makeLogger } from '../utilities/logging';

import { PingProcessor } from './PingProcessor';
import { QueuedPing } from './QueuedPing';

const config = Config.initFromEnv();
const privateKeyStore = initVaultKeyStore();

const logger = makeLogger();
const processor = new PingProcessor(config, privateKeyStore, logger);

export default async function (job: Job<QueuedPing>): Promise<void> {
  try {
    return await processor.deliverPongForPing(job);
  } catch (err) {
    logger.error({ err }, 'Error processing job');
    throw err;
  }
}
