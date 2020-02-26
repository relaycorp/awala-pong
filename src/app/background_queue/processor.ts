import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import {
  Certificate,
  EnvelopedData,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionlessEnvelopedData,
  SessionOriginatorKey,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import bufferToArray = require('buffer-to-arraybuffer');
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
    const privateKey = await this.privateKeyStore.fetchNodeKey(this.currentEndpointKeyId);

    const pongRecipientCertificate = Certificate.deserialize(
      bufferToArray(base64Decode(job.data.parcelSenderCertificate)),
    );

    const unwrappingResult = await this.unwrapPing(
      job.data.parcelPayload,
      privateKey,
      pongRecipientCertificate,
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
      pongRecipientCertificate,
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
    senderCertificate: Certificate,
    jobId: string | number,
  ): Promise<{ readonly ping: Ping; readonly originatorKey?: SessionOriginatorKey } | undefined> {
    const parcelPayload = bufferToArray(base64Decode(parcelPayloadBase64));

    // tslint:disable-next-line:no-let
    let decryptionResult;
    try {
      decryptionResult = await this.decryptServiceMessage(
        parcelPayload,
        recipientPrivateKey,
        senderCertificate,
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
    senderCertificate: Certificate,
  ): Promise<{ readonly message: ServiceMessage; readonly originatorKey?: SessionOriginatorKey }> {
    const parcelPayload = EnvelopedData.deserialize(parcelPayloadSerialized);

    // tslint:disable-next-line:no-let
    let originatorKey;
    // tslint:disable-next-line:no-let
    let privateKey;
    if (parcelPayload instanceof SessionlessEnvelopedData) {
      privateKey = recipientPrivateKey;
    } else {
      originatorKey = await (parcelPayload as SessionEnvelopedData).getOriginatorKey();

      const recipientSessionKeyId = (parcelPayload as SessionEnvelopedData).getRecipientKeyId();
      privateKey = await this.privateKeyStore.fetchSessionKey(
        recipientSessionKeyId,
        senderCertificate,
      );
    }

    const serviceMessageSerialized = await parcelPayload.decrypt(privateKey);
    const message = ServiceMessage.deserialize(Buffer.from(serviceMessageSerialized));
    return { message, originatorKey };
  }

  protected async generatePongParcelPayload(
    pingId: Buffer,
    recipientCertificateOrSessionKey: Certificate | SessionOriginatorKey,
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
      await this.privateKeyStore.saveSessionKey(
        encryptionResult.dhPrivateKey,
        Buffer.from(encryptionResult.dhKeyId),
        recipientCertificate,
      );
    }
    return Buffer.from(pongParcelPayload.serialize());
  }
}
