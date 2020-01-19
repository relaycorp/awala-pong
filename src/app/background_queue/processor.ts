import {
  Certificate,
  derDeserializeRSAPrivateKey,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import { Job } from 'bull';
import pino = require('pino');

import { VaultSessionStore } from '../channelSessionKeys';
import { deserializePing, Ping } from '../pingSerialization';
import { base64Decode } from '../utils';
import { QueuedPing } from './QueuedPing';

const logger = pino();

export class PingProcessor {
  constructor(
    protected readonly endpointPrivateKeyDer: Buffer,
    protected readonly sessionStore: VaultSessionStore,
  ) {}

  public async deliverPongForPing(job: Job<QueuedPing>): Promise<void> {
    // We should be supporting multiple keys so we can do key rotation.
    // See: https://github.com/relaycorp/relaynet-pong/issues/14
    const privateKey = await derDeserializeRSAPrivateKey(this.endpointPrivateKeyDer, {
      hash: { name: 'SHA-256' },
      name: 'RSA-PSS',
    });

    const ping = await unwrapPing(job.data.parcelPayload, privateKey, job.id);
    if (ping === undefined) {
      // Service message was invalid; errors were already logged.
      return;
    }

    const pongRecipientCertificate = Certificate.deserialize(
      bufferToArray(base64Decode(job.data.parcelSenderCertificate)),
    );
    const pongServiceMessage = await generatePongServiceMessage(ping.id, pongRecipientCertificate);
    const pongParcel = new Parcel(
      pongRecipientCertificate.getCommonName(),
      ping.pda,
      pongServiceMessage,
    );
    const parcelSerialized = await pongParcel.serialize(privateKey);
    await deliverParcel(job.data.gatewayAddress, parcelSerialized);
  }
}

async function unwrapPing(
  parcelPayloadBase64: string,
  privateKey: CryptoKey,
  jobId: string | number,
): Promise<Ping | undefined> {
  const parcelPayload = bufferToArray(base64Decode(parcelPayloadBase64));

  // tslint:disable-next-line:no-let
  let serviceMessage;
  try {
    serviceMessage = await extractServiceMessage(parcelPayload, privateKey);
  } catch (error) {
    // The sender didn't create a valid service message, so let's ignore it.
    logger.info('Invalid service message', { err: error, jobId });
    return;
  }

  if (serviceMessage.type !== 'application/vnd.relaynet.ping-v1.ping') {
    logger.info('Invalid service message type', {
      jobId,
      messageType: serviceMessage.type,
    });
    return;
  }

  try {
    return deserializePing(serviceMessage.value);
  } catch (error) {
    logger.info('Invalid ping message', { err: error, jobId });
    return;
  }
}

async function extractServiceMessage(
  parcelPayloadSerialized: ArrayBuffer,
  privateKey: CryptoKey,
): Promise<ServiceMessage> {
  const parcelPayload = SessionlessEnvelopedData.deserialize(
    parcelPayloadSerialized,
  ) as SessionlessEnvelopedData;
  const serviceMessageSerialized = await parcelPayload.decrypt(privateKey);
  return ServiceMessage.deserialize(Buffer.from(serviceMessageSerialized));
}

async function generatePongServiceMessage(
  pingId: Buffer,
  recipientCertificate: Certificate,
): Promise<ArrayBuffer> {
  const pongMessage = new ServiceMessage('application/vnd.relaynet.ping-v1.pong', pingId);
  const pongServiceMessage = await SessionlessEnvelopedData.encrypt(
    pongMessage.serialize(),
    recipientCertificate,
  );
  return pongServiceMessage.serialize();
}
