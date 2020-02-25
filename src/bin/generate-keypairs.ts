// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import { base64Encode } from '../app/utils';

import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import {
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueInitialDHKeyCertificate,
  issueNodeCertificate,
} from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';

const NODE_CERTIFICATE_TTL_DAYS = 180;
const SESSION_CERTIFICATE_TTL_DAYS = 60;

const PONG_ENDPOINT_KEY_ID = getEnvVar('ENDPOINT_KEY_ID')
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
const sessionStore = new VaultPrivateKeyStore(vaultUrl, vaultToken, vaultKvPrefix);

async function main(): Promise<void> {
  try {
    await sessionStore.fetchNodeKey(PONG_ENDPOINT_KEY_ID);
    console.warn(`Endpoint key ${PONG_ENDPOINT_KEY_ID} already exists`);
    return;
  } catch (error) {
    console.log(`Endpoint key will be created because it doesn't already exist`);
  }

  const endpointKeyPair = await generateRSAKeyPair();

  const nodeCertendDate = new Date();
  nodeCertendDate.setDate(nodeCertendDate.getDate() + NODE_CERTIFICATE_TTL_DAYS);
  const endpointCertificate = await issueNodeCertificate({
    isCA: true,
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: endpointKeyPair.publicKey,
    validityEndDate: nodeCertendDate,
  });

  await sessionStore.saveNodeKey(endpointKeyPair.privateKey, PONG_ENDPOINT_KEY_ID);

  const initialSessionKeyPair = await generateECDHKeyPair();
  const sessionCertEndDate = new Date();
  sessionCertEndDate.setDate(sessionCertEndDate.getDate() + SESSION_CERTIFICATE_TTL_DAYS);
  const initialKeyCertificate = await issueInitialDHKeyCertificate({
    dhPublicKey: initialSessionKeyPair.publicKey,
    nodeCertificate: endpointCertificate,
    nodePrivateKey: endpointKeyPair.privateKey,
    validityEndDate: sessionCertEndDate,
  });

  console.log(
    JSON.stringify({
      endpointCertificate: base64Encode(endpointCertificate.serialize()),
      initialSessionCertificate: base64Encode(initialKeyCertificate.serialize()),
      keyPairId: PONG_ENDPOINT_KEY_ID,
    }),
  );
}

main();
