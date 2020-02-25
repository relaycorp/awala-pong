/* istanbul ignore file */
// Can't unit test this file because logic runs at the module level. I don't like this about Bull.

import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import { Job } from 'bull';
import { get as getEnvVar } from 'env-var';
import pino = require('pino');

import { PingProcessor } from './processor';
import { QueuedPing } from './QueuedPing';

const endpointKeyIdBase64 = getEnvVar('ENDPOINT_KEY_ID')
  .required()
  .asString();

const vaultUrl = getEnvVar('VAULT_URL')
  .required()
  .asString();
const vaultToken = getEnvVar('VAULT_TOKEN')
  .required()
  .asString();
const vaultKvPrefix = getEnvVar('VAULT_KV_PREFIX')
  .required()
  .asString();
const privateKeyStore = new VaultPrivateKeyStore(vaultUrl, vaultToken, vaultKvPrefix);

const processor = new PingProcessor(Buffer.from(endpointKeyIdBase64, 'base64'), privateKeyStore);

const logger = pino();

export default async function(job: Job<QueuedPing>): Promise<void> {
  try {
    return await processor.deliverPongForPing(job);
  } catch (err) {
    // tslint:disable-next-line:no-console
    logger.error({ err }, 'Error processing job');
    throw err;
  }
}
