// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import {
  generateECDHKeyPair,
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
  issueEndpointCertificate,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as getEnvVar } from 'env-var';
import { initVaultKeyStore } from '../app/backingServices/vault';
import { Config } from '../app/utilities/config/Config';
import { ConfigItem } from '../app/utilities/config/ConfigItem';

const NODE_CERTIFICATE_TTL_DAYS = 180;

const PONG_ENDPOINT_KEY_ID_BASE64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();
const PONG_ENDPOINT_SESSION_KEY_ID_BASE64 = getEnvVar('ENDPOINT_SESSION_KEY_ID')
  .required()
  .asString();

const privateKeyStore = initVaultKeyStore();

async function main(): Promise<void> {
  const config = Config.initFromEnv();
  try {
    await createIdentityKeyIfMissing(config);
    await createInitialSessionKeyIfMissing(config);
  } finally {
    config.close();
  }
}

async function createIdentityKeyIfMissing(config: Config): Promise<void> {
  const endpointKeyId = Buffer.from(PONG_ENDPOINT_KEY_ID_BASE64, 'base64');
  try {
    const nodeKey = await privateKeyStore.fetchNodeKey(endpointKeyId);
    console.log(`Identity key ${PONG_ENDPOINT_KEY_ID_BASE64} already exists`);

    // TODO: Remove once https://github.com/relaycorp/relaynet-pong/pull/610 is merged
    await config.set(
      ConfigItem.CURRENT_PRIVATE_ADDRESS,
      await getPrivateAddressFromIdentityKey(await nodeKey.certificate.getPublicKey()),
    );
  } catch (error) {
    console.log(`Identity key will be created because it doesn't already exist`);
    const identityPublicKey = await createIdentityKey(endpointKeyId);
    await config.set(
      ConfigItem.CURRENT_PRIVATE_ADDRESS,
      await getPrivateAddressFromIdentityKey(identityPublicKey),
    );
  }
}

async function createInitialSessionKeyIfMissing(config: Config): Promise<void> {
  const endpointSessionKeyId = Buffer.from(PONG_ENDPOINT_SESSION_KEY_ID_BASE64, 'base64');
  try {
    await privateKeyStore.fetchInitialSessionKey(endpointSessionKeyId);
    console.log(`Session key ${PONG_ENDPOINT_SESSION_KEY_ID_BASE64} already exists`);
  } catch (_) {
    console.log(`Session key will be created because it doesn't already exist`);
    const initialSessionKeyPair = await generateECDHKeyPair();
    await privateKeyStore.saveInitialSessionKey(
      initialSessionKeyPair.privateKey,
      endpointSessionKeyId,
    );
  }
  await config.set(ConfigItem.INITIAL_SESSION_KEY_ID, PONG_ENDPOINT_SESSION_KEY_ID_BASE64);
}

async function createIdentityKey(endpointKeyId: Buffer): Promise<CryptoKey> {
  const endpointKeyPair = await generateRSAKeyPair();

  const nodeCertEndDate = new Date();
  nodeCertEndDate.setDate(nodeCertEndDate.getDate() + NODE_CERTIFICATE_TTL_DAYS);
  const endpointCertificate = await issueEndpointCertificate({
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: endpointKeyPair.publicKey,
    validityEndDate: nodeCertEndDate,
  });
  // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
  // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
  // tslint:disable-next-line:no-object-mutation
  (endpointCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex =
    bufferToArray(endpointKeyId);

  await privateKeyStore.saveNodeKey(endpointKeyPair.privateKey, endpointCertificate);

  return endpointKeyPair.publicKey;
}

main();
