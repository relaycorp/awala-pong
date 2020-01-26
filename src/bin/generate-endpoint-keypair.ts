// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import { base64Encode } from '../app/utils';

import { generateRSAKeyPair, issueNodeCertificate } from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';

import { VaultPrivateKeyStore } from '../app/vaultPrivateKeyStore';

const CERTIFICATE_TTL_DAYS = 30;

const PONG_ENDPOINT_KEY_ID = getEnvVar('ENDPOINT_KEY_ID').asString();
const vaultUrl = getEnvVar('VAULT_URL')
  .required()
  .asString();
const vaultToken = getEnvVar('VAULT_TOKEN')
  .required()
  .asString();
const vaultKvPrefix = getEnvVar('VAULT_KV_PREFIX')
  .required()
  .asString();
const sessionStore = new VaultPrivateKeyStore(vaultUrl, vaultToken, vaultKvPrefix);

async function main(): Promise<void> {
  if (PONG_ENDPOINT_KEY_ID) {
    try {
      await sessionStore.fetchNodeKey(PONG_ENDPOINT_KEY_ID);
      console.warn(`Endpoint key ${PONG_ENDPOINT_KEY_ID} already exists`);
      return;
    } catch (error) {
      console.log(`Endpoint key ${PONG_ENDPOINT_KEY_ID} doesn't exist so it'll be created`);
    }
  }

  const endpointKeyPair = await generateRSAKeyPair();

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + CERTIFICATE_TTL_DAYS);
  const endpointCertificate = await issueNodeCertificate({
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: endpointKeyPair.publicKey,
    validityEndDate: endDate,
  });

  const keyId = endpointCertificate.getSerialNumberHex();

  await sessionStore.saveNodeKey(endpointKeyPair.privateKey, keyId);

  console.log(
    JSON.stringify({
      certificate: base64Encode(endpointCertificate.serialize()),
      keyPairId: keyId,
    }),
  );
}

main();
