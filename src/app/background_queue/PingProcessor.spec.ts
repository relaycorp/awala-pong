import {
  Certificate,
  CertificationPath,
  derSerializePrivateKey,
  derSerializePublicKey,
  EnvelopedData,
  getIdFromIdentityKey,
  issueEndpointCertificate,
  MockPrivateKeyStore,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionKey,
  SessionKeyPair,
  SessionPrivateKeyData,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import * as pohttp from '@relaycorp/relaynet-pohttp';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { Job } from 'bull';
import { addDays, subMinutes, subSeconds } from 'date-fns';
import Keyv from 'keyv';

import { generatePingServiceMessage } from '../../testUtils/awala';
import { expectBuffersToEqual } from '../../testUtils/buffers';
import { makeInMemoryConfig } from '../../testUtils/config';
import { getMockContext, getMockInstance } from '../../testUtils/jest';
import { makeMockLogging, partialPinoLog } from '../../testUtils/logging';
import * as pingSerialization from '../pingSerialization';
import { base64Encode } from '../utilities/base64';
import { Config } from '../utilities/config/Config';
import { ConfigItem } from '../utilities/config/ConfigItem';
import { PingProcessor } from './PingProcessor';
import { QueuedPing } from './QueuedPing';

jest.mock('@relaycorp/relaynet-pohttp', () => {
  const actualPohttp = jest.requireActual('@relaycorp/relaynet-pohttp');
  return {
    ...actualPohttp,
    deliverParcel: jest.fn(),
  };
});

beforeEach(() => {
  getMockInstance(pohttp.deliverParcel).mockRestore();
});

const mockLogging = makeMockLogging();

afterAll(jest.restoreAllMocks);

const { config } = makeInMemoryConfig();

describe('deliverPongForPing', () => {
  const mockPrivateKeyStore = new MockPrivateKeyStore();
  let keyPairSet: NodeKeyPairSet;
  let certificatePath: PDACertPath;
  let pingSenderCertificate: Certificate;
  let recipientId: string;
  let recipientSessionKeyPair1: SessionKeyPair;
  beforeAll(async () => {
    keyPairSet = await generateIdentityKeyPairSet();
    certificatePath = await generatePDACertificationPath(keyPairSet);

    pingSenderCertificate = await issueEndpointCertificate({
      subjectPublicKey: keyPairSet.privateEndpoint.publicKey,
      issuerPrivateKey: keyPairSet.privateEndpoint.privateKey,
      validityEndDate: certificatePath.privateEndpoint.expiryDate,
    });

    recipientId = await getIdFromIdentityKey(keyPairSet.pdaGrantee.publicKey);

    recipientSessionKeyPair1 = await SessionKeyPair.generate();
  });
  beforeEach(async () => {
    await mockPrivateKeyStore.saveIdentityKey(recipientId, keyPairSet.pdaGrantee.privateKey);
    await config.set(ConfigItem.CURRENT_PRIVATE_ADDRESS, recipientId);

    await mockPrivateKeyStore.saveSessionKey(
      recipientSessionKeyPair1.privateKey,
      recipientSessionKeyPair1.sessionKey.keyId,
      recipientId,
    );
  });
  afterEach(() => {
    mockPrivateKeyStore.clear();
  });

  const pingId = 'the id';

  let serviceMessageSerialized: ArrayBuffer;
  let parcelPayload: Buffer;
  let pingSenderSessionKey: SessionKey;
  beforeAll(async () => {
    serviceMessageSerialized = generatePingServiceMessage(certificatePath, pingId);
    const { envelopedData } = await SessionEnvelopedData.encrypt(
      serviceMessageSerialized,
      recipientSessionKeyPair1.sessionKey,
    );
    pingSenderSessionKey = await envelopedData.getOriginatorKey();
    parcelPayload = Buffer.from(envelopedData.serialize());
  });

  let processor: PingProcessor;
  beforeEach(() => {
    processor = new PingProcessor(config, mockPrivateKeyStore, mockLogging.logger);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();

    jest.spyOn(pohttp, 'deliverParcel').mockResolvedValueOnce(undefined as any);
  });

  test('Error should be thrown if there is no current endpoint', async () => {
    const emptyConfig = new Config(new Keyv());
    processor = new PingProcessor(emptyConfig, mockPrivateKeyStore, mockLogging.logger);
    const job = await initJob();

    await expect(processor.deliverPongForPing(job)).rejects.toThrowWithMessage(
      Error,
      'There is no current endpoint',
    );
  });

  test('Error should be thrown if there is no current endpoint', async () => {
    mockPrivateKeyStore.clear();
    const job = await initJob();

    await expect(processor.deliverPongForPing(job)).rejects.toThrowWithMessage(
      Error,
      'Private key for current identity key is missing',
    );
  });

  test('Failing to deserialize the ciphertext should be logged', async () => {
    const error = new Error('Failed to deserialise');
    jest.spyOn(EnvelopedData, 'deserialize').mockImplementationOnce(() => {
      throw error;
    });

    const job = await initJob();
    await processor.deliverPongForPing(job);

    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Invalid service message', {
        err: expect.objectContaining({ message: error.message }),
        jobId: job.id,
      }),
    );
  });

  test('Failing to unwrap the service message should be logged', async () => {
    const error = new Error('Failed to unwrap');
    jest.spyOn(Parcel.prototype, 'unwrapPayload').mockImplementationOnce(() => {
      throw error;
    });

    const job = await initJob();
    await processor.deliverPongForPing(job);

    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Invalid service message', {
        err: expect.objectContaining({ message: error.message }),
        jobId: job.id,
      }),
    );
  });

  test('Getting an invalid service message type should be logged', async () => {
    const messageType = 'application/invalid';
    const serviceMessage = new ServiceMessage(
      messageType,
      pingSerialization.serializePing(new CertificationPath(certificatePath.pdaGrantee, [])),
    );
    jest
      .spyOn(Parcel.prototype, 'unwrapPayload')
      .mockResolvedValueOnce({ payload: serviceMessage, senderSessionKey: pingSenderSessionKey });

    const job = await initJob();
    await processor.deliverPongForPing(job);

    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Invalid service message type', { messageType, jobId: job.id }),
    );
    expect(pohttp.deliverParcel).not.toBeCalled();
  });

  test('Getting an invalid service message content should be logged', async () => {
    const error = new Error('Denied');
    jest.spyOn(pingSerialization, 'deserializePing').mockImplementationOnce(() => {
      throw error;
    });

    const job = await initJob();
    await processor.deliverPongForPing(job);

    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Invalid ping message', {
        err: expect.objectContaining({ message: error.message }),
        jobId: job.id,
      }),
    );
  });

  describe('Successful pong delivery', () => {
    const stubGatewayAddress = 'https://example.com';
    let deliveredParcel: Parcel;
    beforeEach(async () => {
      jest.spyOn(SessionEnvelopedData, 'encrypt');
      jest.spyOn(ServiceMessage.prototype, 'serialize');

      const job = await initJob({ gatewayAddress: stubGatewayAddress });
      jest.spyOn(Parcel.prototype, 'serialize');

      await processor.deliverPongForPing(job);

      expect(Parcel.prototype.serialize).toBeCalledTimes(1);
      deliveredParcel = getMockContext(Parcel.prototype.serialize).instances[0];
    });

    test('Parcel recipient should be sender of ping message', () => {
      expect(deliveredParcel.recipient.id).toEqual(pingSenderCertificate.getCommonName());
    });

    test('Ping sender certificate chain should be in pong sender chain', () => {
      const pongSenderChain = deliveredParcel.senderCaCertificateChain;
      const matchingCerts = pongSenderChain.filter(
        (c) =>
          c.isEqual(certificatePath.privateGateway) || c.isEqual(certificatePath.privateEndpoint),
      );
      expect(matchingCerts).toHaveLength(2);
    });

    test('Parcel should be signed with PDA attached to ping message', () => {
      expect(certificatePath.pdaGrantee.isEqual(deliveredParcel.senderCertificate)).toBeTrue();
    });

    test('Parcel creation date should be 5 minutes in the past to tolerate clock drift', () => {
      const cutoffDate = subMinutes(new Date(), 5);
      expect(deliveredParcel.creationDate).toBeBefore(cutoffDate);
      expect(deliveredParcel.creationDate).toBeAfter(subSeconds(cutoffDate, 5));
    });

    test('Parcel expiry date should be 14 days in the future', () => {
      const cutoffDate = addDays(new Date(), 14);
      expect(deliveredParcel.expiryDate).toBeBefore(cutoffDate);
      expect(deliveredParcel.expiryDate).toBeAfter(subSeconds(cutoffDate, 5));
    });

    describe('Channel session', () => {
      test('Pong message should be encrypted with public key from ping sender', async () => {
        expect(SessionEnvelopedData.encrypt).toBeCalledTimes(1);
        const encryptSpy = getMockContext(SessionEnvelopedData.encrypt);
        await expect(encryptSpy.results[0].value).toResolve();

        // Check plaintext
        const encryptCallArgs = encryptSpy.calls[0];
        const expectedPongMessage = new ServiceMessage(
          'application/vnd.awala.ping-v1.pong',
          Buffer.from(pingId),
        );
        expectBuffersToEqual(encryptCallArgs[0], expectedPongMessage.serialize());

        // Check public key used
        const actualOriginatorKey = encryptCallArgs[1] as SessionKey;
        expect(actualOriginatorKey).toHaveProperty('keyId', pingSenderSessionKey.keyId);
        expectBuffersToEqual(
          await derSerializePublicKey(actualOriginatorKey.publicKey),
          await derSerializePublicKey(pingSenderSessionKey.publicKey),
        );
      });

      test('New ephemeral keys should be saved', async () => {
        const encryptSpy = getMockContext(SessionEnvelopedData.encrypt);
        const encryptCallResult = await encryptSpy.results[0].value;
        const keyId = Buffer.from(encryptCallResult.dhKeyId);
        expect(mockPrivateKeyStore.sessionKeys).toHaveProperty(keyId.toString('hex'));
        expect(
          mockPrivateKeyStore.sessionKeys[keyId.toString('hex')],
        ).toEqual<SessionPrivateKeyData>({
          keySerialized: await derSerializePrivateKey(encryptCallResult.dhPrivateKey),
          nodeId: recipientId,
          peerId: await pingSenderCertificate.calculateSubjectId(),
        });
      });

      test('Retrieving an invalid originator key should be gracefully logged', async () => {
        const err = new Error('Denied');
        jest.spyOn(SessionEnvelopedData.prototype, 'getOriginatorKey').mockRejectedValueOnce(err);
        const job = await initJob();

        await processor.deliverPongForPing(job);

        expect(mockLogging.logs).toContainEqual(
          partialPinoLog('info', 'Invalid service message', {
            err: expect.objectContaining({ message: err.message }),
            jobId: job.id,
          }),
        );
      });

      test('Use of unknown public key ids should be gracefully logged', async () => {
        // tslint:disable-next-line:no-delete no-object-mutation
        delete mockPrivateKeyStore.sessionKeys[
          recipientSessionKeyPair1.sessionKey.keyId.toString('hex')
        ];
        const job = await initJob();

        await processor.deliverPongForPing(job);

        expect(mockLogging.logs).toContainEqual(
          partialPinoLog('info', 'Invalid service message', {
            err: expect.objectContaining({ type: UnknownKeyError.name }),
            jobId: job.id,
          }),
        );
      });
    });

    test('Service message type should be application/vnd.awala.ping-v1.pong', () => {
      expect(ServiceMessage.prototype.serialize).toBeCalledTimes(1);
      const serviceMessage = getMockContext(ServiceMessage.prototype.serialize).instances[0];
      expect(serviceMessage).toHaveProperty('type', 'application/vnd.awala.ping-v1.pong');
    });

    test('Original ping id should be used as pong payload', () => {
      expect(ServiceMessage.prototype.serialize).toBeCalledTimes(1);
      const serviceMessage = getMockContext(ServiceMessage.prototype.serialize).instances[0];
      expect(serviceMessage.content.toString()).toEqual(pingId);
    });

    test('Parcel should be delivered to the specified gateway', () => {
      const deliverParcelCall = getMockContext(pohttp.deliverParcel).calls[0];
      expect(deliverParcelCall[0]).toEqual(stubGatewayAddress);
    });

    test('Successful delivery should be logged', () => {
      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('info', 'Successfully delivered pong parcel', {
          publicGatewayAddress: stubGatewayAddress,
        }),
      );
    });
  });

  test('Pong should discarded if server rejects parcel as invalid', async () => {
    const error = new pohttp.PoHTTPInvalidParcelError('Nope');
    getMockInstance(pohttp.deliverParcel).mockRestore();
    jest.spyOn(pohttp, 'deliverParcel').mockRejectedValue(error);

    await expect(processor.deliverPongForPing(await initJob())).toResolve();

    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Discarding pong delivery because server refused parcel', {
        err: expect.objectContaining({ message: error.message }),
      }),
    );
  });

  test('Parcel delivery errors should be propagated', async () => {
    const error = new Error('Nope');
    getMockInstance(pohttp.deliverParcel).mockRestore();
    jest.spyOn(pohttp, 'deliverParcel').mockRejectedValue(error);

    await expect(processor.deliverPongForPing(await initJob())).rejects.toEqual(error);
  });

  async function initJob(
    options: Partial<{
      readonly parcelPayload: Buffer;
      readonly gatewayAddress: string;
    }> = {},
  ): Promise<Job<QueuedPing>> {
    const finalPayload = options.parcelPayload ?? parcelPayload;
    const parcel = new Parcel(
      { id: recipientId, internetAddress: 'ping.relaycorp.tech' },
      pingSenderCertificate,
      finalPayload,
      {
        senderCaCertificateChain: [certificatePath.privateGateway],
      },
    );
    const data: QueuedPing = {
      gatewayAddress: options.gatewayAddress ?? 'dummy-gateway',
      parcel: base64Encode(await parcel.serialize(keyPairSet.privateEndpoint.privateKey)),
    };
    return { data, id: 'random-id' } as any;
  }
});
