import {
  Certificate,
  derDeserializeRSAPrivateKey,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionlessEnvelopedData,
  SessionOriginatorKey,
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

    const pongRecipientCertificate = Certificate.deserialize(
      bufferToArray(base64Decode(job.data.parcelSenderCertificate)),
    );

    const pongRecipientPublicKey = await pongRecipientCertificate.getPublicKey();
    const unwrappingResult = await this.unwrapPing(
      job.data.parcelPayload,
      privateKey,
      pongRecipientPublicKey,
      job.id,
    );
    if (unwrappingResult === undefined) {
      // Service message was invalid; errors were already logged.
      return;
    }

    const ping = unwrappingResult.ping;
    const pongParcelPayload = await this.generatePongParcelPayload(
      ping.id,
      unwrappingResult.originatorKey ?? pongRecipientCertificate,
      pongRecipientPublicKey,
    );
    const pongParcel = new Parcel(
      pongRecipientCertificate.getCommonName(),
      ping.pda,
      pongParcelPayload,
    );
    const parcelSerialized = await pongParcel.serialize(privateKey);
    await deliverParcel(job.data.gatewayAddress, parcelSerialized);
  }

  protected async unwrapPing(
    parcelPayloadBase64: string,
    recipientPrivateKey: CryptoKey,
    senderPublicKey: CryptoKey,
    jobId: string | number,
  ): Promise<{ readonly ping: Ping; readonly originatorKey?: SessionOriginatorKey } | undefined> {
    const parcelPayload = bufferToArray(base64Decode(parcelPayloadBase64));

    // tslint:disable-next-line:no-let
    let decryptionResult;
    try {
      decryptionResult = await this.decryptServiceMessage(
        parcelPayload,
        recipientPrivateKey,
        senderPublicKey,
      );
    } catch (error) {
      // The sender didn't create a valid service message, so let's ignore it.
      logger.info('Invalid service message', { err: error, jobId });
      return;
    }

    const serviceMessage = decryptionResult.message;

    if (serviceMessage.type !== 'application/vnd.relaynet.ping-v1.ping') {
      logger.info('Invalid service message type', {
        jobId,
        messageType: serviceMessage.type,
      });
      return;
    }

    // tslint:disable-next-line:no-let
    let ping: Ping;
    try {
      ping = deserializePing(serviceMessage.value);
    } catch (error) {
      logger.info('Invalid ping message', { err: error, jobId });
      return;
    }
    return { ping, originatorKey: decryptionResult.originatorKey };
  }

  protected async decryptServiceMessage(
    parcelPayloadSerialized: ArrayBuffer,
    recipientPrivateKey: CryptoKey,
    senderPublicKey: CryptoKey,
  ): Promise<{ readonly message: ServiceMessage; readonly originatorKey?: SessionOriginatorKey }> {
    const parcelPayload = SessionlessEnvelopedData.deserialize(parcelPayloadSerialized);

    // tslint:disable-next-line:no-let
    let originatorKey;
    // tslint:disable-next-line:no-let
    let privateKey;
    if (parcelPayload instanceof SessionlessEnvelopedData) {
      privateKey = recipientPrivateKey;
    } else {
      originatorKey = await (parcelPayload as SessionEnvelopedData).getOriginatorKey();

      const recipientSessionKeyId = (parcelPayload as SessionEnvelopedData).getRecipientKeyId();
      privateKey = await this.sessionStore.getPrivateKey(recipientSessionKeyId, senderPublicKey);
    }

    const serviceMessageSerialized = await parcelPayload.decrypt(privateKey);
    const message = ServiceMessage.deserialize(Buffer.from(serviceMessageSerialized));
    return { message, originatorKey };
  }

  protected async generatePongParcelPayload(
    pingId: Buffer,
    recipientCertificateOrSessionKey: Certificate | SessionOriginatorKey,
    recipientPublicKey: CryptoKey,
  ): Promise<ArrayBuffer> {
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
      await this.sessionStore.savePrivateKey(
        encryptionResult.dhPrivateKey,
        encryptionResult.dhKeyId,
        recipientPublicKey,
      );
    }
    return pongParcelPayload.serialize();
  }
}
