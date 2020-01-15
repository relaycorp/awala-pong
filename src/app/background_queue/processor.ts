import {
  Certificate,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import { Job } from 'bull';
import { get as getEnvVar } from 'env-var';
import WebCrypto from 'node-webcrypto-ossl';
import pino = require('pino');

import { deserializePing, Ping } from '../pingSerialization';

const logger = pino();

const crypto = new WebCrypto();

export interface PingProcessingMessage {
  readonly gatewayAddress: string;
  readonly parcelId: string;
  readonly senderCertificate: string;
  readonly serviceMessageCiphertext: string;
}

export default async function processPing(job: Job): Promise<void> {
  const queueMessage = job.data as PingProcessingMessage;

  // We should be supporting multiple keys so we can do key rotation.
  // See: https://github.com/relaycorp/relaynet-pong/issues/14
  const privateKeyPem = getEnvVar('ENDPOINT_PRIVATE_KEY')
    .required()
    .asString();
  const privateKey = await convertPemPrivateKeyToWebCrypto(privateKeyPem);

  // tslint:disable-next-line:no-let
  let serviceMessage;
  try {
    serviceMessage = await extractServiceMessage(queueMessage.serviceMessageCiphertext, privateKey);
  } catch (error) {
    // The sender didn't create a valid service message, so let's ignore it.
    logger.info('Invalid service message', { err: error, jobId: job.id });
    return;
  }

  if (serviceMessage.type !== 'application/vnd.relaynet.ping-v1.ping') {
    logger.info('Invalid service message type', {
      jobId: job.id,
      messageType: serviceMessage.type,
    });
    return;
  }

  // tslint:disable-next-line:no-let
  let ping: Ping;
  try {
    ping = deserializePing(serviceMessage.value);
  } catch (error) {
    logger.info('Invalid ping message', { err: error, jobId: job.id });
    return;
  }

  const pongMessage = new ServiceMessage('application/vnd.relaynet.ping-v1.pong', ping.id);
  const pongRecipientCertificate = Certificate.deserialize(
    bufferToArray(base64ToDer(queueMessage.senderCertificate)),
  );
  const pongServiceMessage = await SessionlessEnvelopedData.encrypt(
    pongMessage.serialize(),
    pongRecipientCertificate,
  );
  const pongParcel = new Parcel(
    pongRecipientCertificate.getCommonName(),
    ping.pda,
    pongServiceMessage.serialize(),
  );
  const parcelSerialized = await pongParcel.serialize(privateKey);
  await deliverParcel(queueMessage.gatewayAddress, parcelSerialized);
}

async function extractServiceMessage(
  serviceMessageCiphertextBase64: string,
  privateKey: CryptoKey,
): Promise<ServiceMessage> {
  // Keep base64-to-der conversion outside try/catch: An invalid base64 encoding would be our fault.
  const serviceMessageCiphertextSerialized = bufferToArray(
    Buffer.from(serviceMessageCiphertextBase64, 'base64'),
  );
  const serviceMessageCiphertext = SessionlessEnvelopedData.deserialize(
    serviceMessageCiphertextSerialized,
  ) as SessionlessEnvelopedData;
  const serviceMessageSerialized = await serviceMessageCiphertext.decrypt(privateKey);
  return ServiceMessage.deserialize(Buffer.from(serviceMessageSerialized));
}

async function convertPemPrivateKeyToWebCrypto(privateKeyPem: string): Promise<CryptoKey> {
  const privateKeyBase64 = privateKeyPem.replace(/(-----(BEGIN|END) PRIVATE KEY-----|\n)/g, '');
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToDer(privateKeyBase64),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    true,
    ['sign'],
  );
}

function base64ToDer(base64Value: string): Buffer {
  return Buffer.from(base64Value, 'base64');
}
