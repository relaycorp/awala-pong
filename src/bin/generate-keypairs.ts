// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import {
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueEndpointCertificate,
  issueInitialDHKeyCertificate,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as getEnvVar } from 'env-var';
import { initVaultKeyStore } from '../app/backingServices/vault';

import { base64Encode } from '../app/utils';

const NODE_CERTIFICATE_TTL_DAYS = 180;
const SESSION_CERTIFICATE_TTL_DAYS = 60;

const PONG_ENDPOINT_KEY_ID_BASE64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();
const PONG_ENDPOINT_SESSION_KEY_ID_BASE64 = getEnvVar('ENDPOINT_SESSION_KEY_ID')
  .required()
  .asString();

const sessionStore = initVaultKeyStore();

async function main(): Promise<void> {
  const endpointKeyId = Buffer.from(PONG_ENDPOINT_KEY_ID_BASE64, 'base64');
  try {
    await sessionStore.fetchNodeKey(endpointKeyId);
    console.warn(`Endpoint key ${PONG_ENDPOINT_KEY_ID_BASE64} already exists`);
    return;
  } catch (error) {
    console.log(`Endpoint key will be created because it doesn't already exist`);
  }

  const endpointKeyPair = await generateRSAKeyPair();

  const nodeCertendDate = new Date();
  nodeCertendDate.setDate(nodeCertendDate.getDate() + NODE_CERTIFICATE_TTL_DAYS);
  const endpointCertificate = await issueEndpointCertificate({
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: endpointKeyPair.publicKey,
    validityEndDate: nodeCertendDate,
  });
  // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
  // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
  // tslint:disable-next-line:no-object-mutation
  (endpointCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex = bufferToArray(
    endpointKeyId,
  );

  await sessionStore.saveNodeKey(endpointKeyPair.privateKey, endpointCertificate);

  const initialSessionKeyPair = await generateECDHKeyPair();
  const sessionCertEndDate = new Date();
  sessionCertEndDate.setDate(sessionCertEndDate.getDate() + SESSION_CERTIFICATE_TTL_DAYS);
  const initialKeyCertificate = await issueInitialDHKeyCertificate({
    issuerCertificate: endpointCertificate,
    issuerPrivateKey: endpointKeyPair.privateKey,
    subjectPublicKey: initialSessionKeyPair.publicKey,
    validityEndDate: sessionCertEndDate,
  });
  const endpointSessionKeyId = Buffer.from(PONG_ENDPOINT_SESSION_KEY_ID_BASE64, 'base64');
  // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
  // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
  // tslint:disable-next-line:no-object-mutation
  (initialKeyCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex = bufferToArray(
    endpointSessionKeyId,
  );
  await sessionStore.saveInitialSessionKey(initialSessionKeyPair.privateKey, initialKeyCertificate);

  console.log(
    JSON.stringify({
      endpointCertificate: base64Encode(endpointCertificate.serialize()),
      initialSessionCertificate: base64Encode(initialKeyCertificate.serialize()),
      keyPairId: PONG_ENDPOINT_KEY_ID_BASE64,
      sessionKeyPairId: PONG_ENDPOINT_SESSION_KEY_ID_BASE64,
    }),
  );
}

main();
