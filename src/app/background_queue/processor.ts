import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import {
  Certificate,
  OriginatorSessionKey,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { deliverParcel, PoHTTPInvalidParcelError } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import { Job } from 'bull';
import pino = require('pino');

import { deserializePing, Ping } from '../pingSerialization';
import { base64Decode } from '../utils';
import { QueuedPing } from './QueuedPing';

const logger = pino();

export class PingProcessor {
  constructor(
    protected readonly currentEndpointKeyId: Buffer,
    protected readonly privateKeyStore: VaultPrivateKeyStore,
  ) {}

  public async deliverPongForPing(job: Job<QueuedPing>): Promise<void> {
    // We should be supporting multiple keys so we can do key rotation.
    // See: https://github.com/relaycorp/relaynet-pong/issues/14
    const keyPair = await this.privateKeyStore.fetchNodeKey(this.currentEndpointKeyId);

    const pingParcel = await Parcel.deserialize(bufferToArray(base64Decode(job.data.parcel)));

    const unwrappingResult = await this.unwrapPing(pingParcel, job.id);
    if (unwrappingResult === undefined) {
      // Service message was invalid; errors were already logged.
      return;
    }

    const ping = unwrappingResult.ping;
    const pongParcelPayload = await this.generatePongParcelPayload(
      ping.id,
      unwrappingResult.originatorKey ?? pingParcel.senderCertificate,
      pingParcel.senderCertificate,
    );
    const pongParcel = new Parcel(
      pingParcel.senderCertificate.getCommonName(),
      ping.pda,
      pongParcelPayload,
      {
        senderCaCertificateChain: [
          pingParcel.senderCertificate,
          ...pingParcel.senderCaCertificateChain,
        ],
      },
    );
    const parcelSerialized = await pongParcel.serialize(keyPair.privateKey);
    try {
      await deliverParcel(job.data.gatewayAddress, parcelSerialized);
    } catch (err) {
      if (err instanceof PoHTTPInvalidParcelError) {
        logger.info({ err }, 'Discarding pong delivery because server refused parcel');
        return;
      }
      throw err;
    }
  }

  protected async unwrapPing(
    pingParcel: Parcel,
    jobId: string | number,
  ): Promise<{ readonly ping: Ping; readonly originatorKey?: OriginatorSessionKey } | undefined> {
    // tslint:disable-next-line:no-let
    let decryptionResult;
    try {
      decryptionResult = await pingParcel.unwrapPayload(this.privateKeyStore);
    } catch (error) {
      // The sender didn't create a valid service message, so let's ignore it.
      logger.info({ err: error, jobId }, 'Invalid service message');
      return;
    }

    const serviceMessage = decryptionResult.payload;

    if (serviceMessage.type !== 'application/vnd.relaynet.ping-v1.ping') {
      logger.info({ jobId, messageType: serviceMessage.type }, 'Invalid service message type');
      return;
    }

    // tslint:disable-next-line:no-let
    let ping: Ping;
    try {
      ping = deserializePing(serviceMessage.value);
    } catch (error) {
      logger.info({ err: error, jobId }, 'Invalid ping message');
      return;
    }
    return { ping, originatorKey: decryptionResult.senderSessionKey };
  }

  protected async generatePongParcelPayload(
    pingId: Buffer,
    recipientCertificateOrSessionKey: Certificate | OriginatorSessionKey,
    recipientCertificate: Certificate,
  ): Promise<Buffer> {
    const pongMessage = new ServiceMessage('application/vnd.relaynet.ping-v1.pong', pingId);
    const pongMessageSerialized = pongMessage.serialize();

    // tslint:disable-next-line:no-let
    let pongParcelPayload;
    if (recipientCertificateOrSessionKey instanceof Certificate) {
      pongParcelPayload = await SessionlessEnvelopedData.encrypt(
        pongMessageSerialized,
        recipientCertificateOrSessionKey,
      );
    } else {
      const encryptionResult = await SessionEnvelopedData.encrypt(
        pongMessageSerialized,
        recipientCertificateOrSessionKey,
      );
      pongParcelPayload = encryptionResult.envelopedData;
      await this.privateKeyStore.saveSubsequentSessionKey(
        encryptionResult.dhPrivateKey,
        Buffer.from(encryptionResult.dhKeyId),
        recipientCertificate,
      );
    }
    return Buffer.from(pongParcelPayload.serialize());
  }
}
