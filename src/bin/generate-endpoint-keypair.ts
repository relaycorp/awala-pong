// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import { base64Encode } from '../app/utils';

import { generateRSAKeyPair, issueNodeCertificate } from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';

import { VaultPrivateKeyStore } from '../app/vaultPrivateKeyStore';

const CERTIFICATE_TTL_DAYS = 30;

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
  const endpointKeyPair = await generateRSAKeyPair();

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + CERTIFICATE_TTL_DAYS);
  const endpointCertificate = await issueNodeCertificate({
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: endpointKeyPair.publicKey,
    validityEndDate: endDate,
  });

  await sessionStore.saveNodeKey(
    endpointKeyPair.privateKey,
    endpointCertificate.getSerialNumberHex(),
  );
  // tslint:disable-next-line:no-console
  console.log(
    JSON.stringify({
      certificate: base64Encode(endpointCertificate.serialize()),
      keyPairId: endpointCertificate.getSerialNumberHex(),
    }),
  );
}

main();
