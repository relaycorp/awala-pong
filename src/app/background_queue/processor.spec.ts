import {
  Certificate,
  derSerializePrivateKey,
  derSerializePublicKey,
  EnvelopedData,
  generateECDHKeyPair,
  MockPrivateKeyStore,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionKey,
  SessionlessEnvelopedData,
  SubsequentSessionPrivateKeyData,
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

import { generatePingServiceMessage, generateStubNodeCertificate } from '../../testUtils/awala';
import { expectBuffersToEqual } from '../../testUtils/buffers';
import { getMockContext, getMockInstance } from '../../testUtils/jest';
import { makeMockLogging, MockLogging, partialPinoLog } from '../../testUtils/logging';
import * as pingSerialization from '../pingSerialization';
import { base64Encode } from '../utilities/base64';
import { QueuedPing } from './QueuedPing';

jest.mock('@relaycorp/relaynet-pohttp', () => {
  const actualPohttp = jest.requireActual('@relaycorp/relaynet-pohttp');
  return {
    ...actualPohttp,
    deliverParcel: jest.fn(),
  };
});

import { PingProcessor } from './processor';

beforeEach(() => {
  getMockInstance(pohttp.deliverParcel).mockRestore();
});

let mockLogging: MockLogging;
beforeEach(() => {
  mockLogging = makeMockLogging();
});

afterAll(jest.restoreAllMocks);

describe('PingProcessor', () => {
  describe('deliverPongForPing', () => {
    let mockPrivateKeyStore: MockPrivateKeyStore;
    beforeEach(() => {
      mockPrivateKeyStore = new MockPrivateKeyStore();
    });

    const pingId = 'the id';

    let keyPairSet: NodeKeyPairSet;
    let certificatePath: PDACertPath;
    let pingRecipientCertificate: Certificate;
    let pingSenderCertificate: Certificate;
    let serviceMessageSerialized: ArrayBuffer;
    let stubParcelPayload: Buffer;
    beforeAll(async () => {
      keyPairSet = await generateIdentityKeyPairSet();
      certificatePath = await generatePDACertificationPath(keyPairSet);

      pingSenderCertificate = await generateStubNodeCertificate(
        keyPairSet.privateEndpoint.publicKey,
        keyPairSet.privateEndpoint.privateKey,
      );

      pingRecipientCertificate = await generateStubNodeCertificate(
        keyPairSet.pdaGrantee.publicKey,
        keyPairSet.pdaGrantee.privateKey,
      );

      serviceMessageSerialized = generatePingServiceMessage(certificatePath, pingId);
      const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
        serviceMessageSerialized,
        pingRecipientCertificate,
      );
      stubParcelPayload = Buffer.from(serviceMessageEncrypted.serialize());
    });

    let processor: PingProcessor;
    beforeEach(() => {
      processor = new PingProcessor(
        pingRecipientCertificate.getSerialNumber(),
        mockPrivateKeyStore as any,
        mockLogging.logger,
      );
    });

    beforeEach(async () => {
      jest.restoreAllMocks();

      await mockPrivateKeyStore.registerNodeKey(
        keyPairSet.pdaGrantee.privateKey,
        pingRecipientCertificate,
      );

      jest.spyOn(pohttp, 'deliverParcel').mockResolvedValueOnce(
        // @ts-ignore
        undefined,
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
        pingSerialization.serializePing(pingRecipientCertificate, []),
      );
      jest
        .spyOn(Parcel.prototype, 'unwrapPayload')
        .mockResolvedValueOnce({ payload: serviceMessage });

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
        jest.spyOn(SessionlessEnvelopedData, 'encrypt');
        jest.spyOn(ServiceMessage.prototype, 'serialize');

        const job = await initJob({ gatewayAddress: stubGatewayAddress });
        jest.spyOn(Parcel.prototype, 'serialize');

        await processor.deliverPongForPing(job);

        expect(Parcel.prototype.serialize).toBeCalledTimes(1);
        deliveredParcel = getMockContext(Parcel.prototype.serialize).instances[0];
      });

      test('Parcel recipient should be sender of ping message', () => {
        expect(deliveredParcel).toHaveProperty(
          'recipientAddress',
          pingSenderCertificate.getCommonName(),
        );
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

      test('Parcel payload should be encrypted with recipient certificate', () => {
        expect(SessionlessEnvelopedData.encrypt).toBeCalledTimes(1);
        const encryptCall = getMockContext(SessionlessEnvelopedData.encrypt).calls[0];
        expect(encryptCall[1].getCommonName()).toEqual(pingSenderCertificate.getCommonName());
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
      // @ts-ignore
      pohttp.deliverParcel.mockRestore();
      jest.spyOn(pohttp, 'deliverParcel').mockImplementation(async () => {
        throw error;
      });

      await expect(processor.deliverPongForPing(await initJob())).toResolve();

      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('info', 'Discarding pong delivery because server refused parcel', {
          err: expect.objectContaining({ message: error.message }),
        }),
      );
    });

    test('Parcel delivery errors should be propagated', async () => {
      const error = new Error('Nope');
      // @ts-ignore
      pohttp.deliverParcel.mockRestore();
      jest.spyOn(pohttp, 'deliverParcel').mockImplementation(async () => {
        throw error;
      });

      await expect(processor.deliverPongForPing(await initJob())).rejects.toEqual(error);
    });

    describe('Channel session', () => {
      const recipientSessionKeyId1 = Buffer.from('recipient session key id');

      let recipientSessionKeyPair1: CryptoKeyPair;
      let stubSessionOriginatorKey: SessionKey;
      let stubSessionParcelPayload: Buffer;
      let stubJob: Job<QueuedPing>;
      beforeAll(async () => {
        recipientSessionKeyPair1 = await generateECDHKeyPair();
        const { envelopedData } = await SessionEnvelopedData.encrypt(serviceMessageSerialized, {
          keyId: recipientSessionKeyId1,
          publicKey: recipientSessionKeyPair1.publicKey,
        });
        stubSessionOriginatorKey = await envelopedData.getOriginatorKey();
        stubSessionParcelPayload = Buffer.from(envelopedData.serialize());

        stubJob = await initJob({ parcelPayload: stubSessionParcelPayload });
      });

      beforeEach(async () => {
        await mockPrivateKeyStore.registerInitialSessionKey(
          recipientSessionKeyPair1.privateKey,
          recipientSessionKeyId1,
        );
      });

      test('Pong message should be encrypted with public key from ping sender', async () => {
        const encryptSpy = jest.spyOn(SessionEnvelopedData, 'encrypt');

        await processor.deliverPongForPing(stubJob);

        expect(encryptSpy).toBeCalledTimes(1);
        await expect(encryptSpy.mock.results[0].value).toResolve();

        // Check plaintext
        const encryptCallArgs = encryptSpy.mock.calls[0];
        const expectedPongMessage = new ServiceMessage(
          'application/vnd.awala.ping-v1.pong',
          Buffer.from(pingId),
        );
        expectBuffersToEqual(encryptCallArgs[0], expectedPongMessage.serialize());

        // Check public key used
        const actualOriginatorKey = encryptCallArgs[1] as SessionKey;
        expect(actualOriginatorKey).toHaveProperty('keyId', stubSessionOriginatorKey.keyId);
        expectBuffersToEqual(
          await derSerializePublicKey(actualOriginatorKey.publicKey),
          await derSerializePublicKey(stubSessionOriginatorKey.publicKey),
        );
      });

      test('New ephemeral keys should be saved', async () => {
        const encryptSpy = jest.spyOn(SessionEnvelopedData, 'encrypt');

        await processor.deliverPongForPing(stubJob);

        const encryptCallResult = await encryptSpy.mock.results[0].value;
        const keyId = Buffer.from(encryptCallResult.dhKeyId);
        expect(mockPrivateKeyStore.keys).toHaveProperty(keyId.toString('hex'));
        expect(
          mockPrivateKeyStore.keys[keyId.toString('hex')],
        ).toEqual<SubsequentSessionPrivateKeyData>({
          keyDer: await derSerializePrivateKey(encryptCallResult.dhPrivateKey),
          peerPrivateAddress: await pingSenderCertificate.calculateSubjectPrivateAddress(),
          type: 'session-subsequent',
        });
      });

      test('Retrieving an invalid originator key should be gracefully logged', async () => {
        const err = new Error('Denied');
        jest.spyOn(SessionEnvelopedData.prototype, 'getOriginatorKey').mockRejectedValueOnce(err);

        await processor.deliverPongForPing(stubJob);

        expect(mockLogging.logs).toContainEqual(
          partialPinoLog('info', 'Invalid service message', {
            err: expect.objectContaining({ message: err.message }),

            jobId: stubJob.id,
          }),
        );
      });

      test('Use of unknown public key ids should be gracefully logged', async () => {
        // tslint:disable-next-line:no-delete no-object-mutation
        delete mockPrivateKeyStore.keys[recipientSessionKeyId1.toString('hex')];

        await processor.deliverPongForPing(stubJob);

        expect(mockLogging.logs).toContainEqual(
          partialPinoLog('info', 'Invalid service message', {
            err: expect.objectContaining({ type: UnknownKeyError.name }),
            jobId: stubJob.id,
          }),
        );
      });
    });

    async function initJob(
      options: Partial<{
        readonly parcelPayload: Buffer;
        readonly gatewayAddress: string;
      }> = {},
    ): Promise<Job<QueuedPing>> {
      const finalPayload = options.parcelPayload ?? stubParcelPayload;
      const parcel = new Parcel(
        'https://ping.relaycorp.tech',
        pingSenderCertificate,
        finalPayload,
        { senderCaCertificateChain: [certificatePath.privateGateway] },
      );
      const data: QueuedPing = {
        gatewayAddress: options.gatewayAddress ?? 'dummy-gateway',
        parcel: base64Encode(await parcel.serialize(keyPairSet.privateEndpoint.privateKey)),
      };
      // @ts-ignore
      return { data, id: 'random-id' };
    }
  });
});
