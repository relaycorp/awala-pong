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
    );
    const parcelSerialized = await pongParcel.serialize(privateKey);
    await deliverParcel(job.data.gatewayAddress, parcelSerialized);
  }

  protected async unwrapPing(
    pingParcel: Parcel,
    jobId: string | number,
  ): Promise<{ readonly ping: Ping; readonly originatorKey?: SessionOriginatorKey } | undefined> {
    // tslint:disable-next-line:no-let
    let decryptionResult;
    try {
      decryptionResult = await this.decryptServiceMessage(pingParcel);
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
    pingParcel: Parcel,
  ): Promise<{ readonly message: ServiceMessage; readonly originatorKey?: SessionOriginatorKey }> {
    const parcelPayload = EnvelopedData.deserialize(bufferToArray(pingParcel.payloadSerialized));
    const originatorKey =
      parcelPayload instanceof SessionEnvelopedData
        ? await parcelPayload.getOriginatorKey()
        : undefined;

    // TODO: REMOVE
    const recipientKeyId = parcelPayload.getRecipientKeyId();
    // tslint:disable-next-line:no-console
    console.log('BADGER', {
      envelopedDataType: parcelPayload.constructor.name,
      recipientKeyId: recipientKeyId.toString('base64'),
    });

    const message = await pingParcel.unwrapPayload(this.privateKeyStore);
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
