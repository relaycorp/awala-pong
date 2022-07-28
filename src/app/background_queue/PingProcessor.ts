import {
  Parcel,
  PrivateKeyStore,
  ServiceMessage,
  SessionEnvelopedData,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { deliverParcel, PoHTTPInvalidParcelError } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import { Job } from 'bull';
import { addDays, differenceInSeconds, subMinutes } from 'date-fns';
import { Logger } from 'pino';

import { deserializePing, Ping } from '../pingSerialization';
import { base64Decode } from '../utilities/base64';
import { Config } from '../utilities/config/Config';
import { ConfigItem } from '../utilities/config/ConfigItem';
import { QueuedPing } from './QueuedPing';

export class PingProcessor {
  constructor(
    protected readonly config: Config,
    protected readonly privateKeyStore: PrivateKeyStore,
    protected readonly logger: Logger,
  ) {}

  public async deliverPongForPing(job: Job<QueuedPing>): Promise<void> {
    const currentEndpointPrivateAddress = await this.config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS);
    if (!currentEndpointPrivateAddress) {
      throw new Error('There is no current endpoint');
    }

    const identityPrivateKey = await this.privateKeyStore.retrieveIdentityKey(
      currentEndpointPrivateAddress,
    );
    if (!identityPrivateKey) {
      throw new Error('Private key for current identity key is missing');
    }

    const pingParcel = await Parcel.deserialize(bufferToArray(base64Decode(job.data.parcel)));

    const unwrappingResult = await this.unwrapPing(pingParcel, job.id);
    if (unwrappingResult === undefined) {
      // Service message was invalid; errors were already logged.
      return;
    }
    const pongParcelSerialized = await this.makePongParcel(
      unwrappingResult.ping,
      currentEndpointPrivateAddress,
      await pingParcel.senderCertificate.calculateSubjectId(),
      identityPrivateKey,
      unwrappingResult.originatorKey,
    );
    try {
      await deliverParcel(job.data.gatewayAddress, pongParcelSerialized);
    } catch (err) {
      if (err instanceof PoHTTPInvalidParcelError) {
        this.logger.info({ err }, 'Discarding pong delivery because server refused parcel');
        return;
      }
      throw err;
    }
    this.logger.info(
      { publicGatewayAddress: job.data.gatewayAddress },
      'Successfully delivered pong parcel',
    );
  }

  protected async unwrapPing(
    pingParcel: Parcel,
    jobId: string | number,
  ): Promise<{ readonly ping: Ping; readonly originatorKey: SessionKey } | undefined> {
    let decryptionResult;
    try {
      decryptionResult = await pingParcel.unwrapPayload(this.privateKeyStore);
    } catch (error) {
      // The sender didn't create a valid service message, so let's ignore it.
      this.logger.info({ err: error, jobId }, 'Invalid service message');
      return;
    }

    const serviceMessage = decryptionResult.payload;

    if (serviceMessage.type !== 'application/vnd.awala.ping-v1.ping') {
      this.logger.info({ jobId, messageType: serviceMessage.type }, 'Invalid service message type');
      return;
    }

    let ping: Ping;
    try {
      ping = deserializePing(serviceMessage.content);
    } catch (error) {
      this.logger.info({ err: error, jobId }, 'Invalid ping message');
      return;
    }
    return { ping, originatorKey: decryptionResult.senderSessionKey };
  }

  protected async generatePongParcelPayload(
    pingId: string,
    recipientSessionKey: SessionKey,
    recipientPrivateAddress: string,
    senderPrivateAddress: string,
  ): Promise<Buffer> {
    const pongMessage = new ServiceMessage(
      'application/vnd.awala.ping-v1.pong',
      Buffer.from(pingId),
    );
    const pongMessageSerialized = pongMessage.serialize();

    const {
      dhPrivateKey,
      dhKeyId,
      envelopedData: pongParcelPayload,
    } = await SessionEnvelopedData.encrypt(pongMessageSerialized, recipientSessionKey);
    await this.privateKeyStore.saveSessionKey(
      dhPrivateKey,
      Buffer.from(dhKeyId),
      senderPrivateAddress,
      recipientPrivateAddress,
    );
    return Buffer.from(pongParcelPayload.serialize());
  }

  private async makePongParcel(
    ping: Ping,
    senderPrivateAddress: string,
    recipientPrivateAddress: string,
    identityPrivateKey: CryptoKey,
    originatorKey: SessionKey,
  ): Promise<ArrayBuffer> {
    const pongParcelPayload = await this.generatePongParcelPayload(
      ping.id,
      originatorKey,
      recipientPrivateAddress,
      senderPrivateAddress,
    );
    const now = new Date();
    const expiryDate = addDays(now, 14);
    const creationDate = subMinutes(now, 5);
    const pongParcel = new Parcel(
      { id: recipientPrivateAddress },
      ping.pdaPath.leafCertificate,
      pongParcelPayload,
      {
        creationDate,
        senderCaCertificateChain: ping.pdaPath.certificateAuthorities,
        ttl: differenceInSeconds(expiryDate, creationDate),
      },
    );
    return pongParcel.serialize(identityPrivateKey);
  }
}
