/* istanbul ignore file */
// Can't unit test this file because logic runs at the module level. I don't like this about Bull.

import { Job } from 'bull';
import { get as getEnvVar } from 'env-var';
import pino = require('pino');
import { initVaultKeyStore } from '../backingServices/vault';

import { PingProcessor } from './processor';
import { QueuedPing } from './QueuedPing';

const endpointKeyIdBase64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();

const privateKeyStore = initVaultKeyStore();

const processor = new PingProcessor(Buffer.from(endpointKeyIdBase64, 'base64'), privateKeyStore);

const logger = pino();

export default async function (job: Job<QueuedPing>): Promise<void> {
  try {
    return await processor.deliverPongForPing(job);
  } catch (err) {
    // tslint:disable-next-line:no-console
    logger.error({ err }, 'Error processing job');
    throw err;
  }
}
