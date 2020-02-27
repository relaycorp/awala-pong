/* tslint:disable:no-let */
import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import {
  Certificate,
  derSerializePublicKey,
  EnvelopedData,
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueInitialDHKeyCertificate,
  OriginatorSessionKey,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import * as pohttp from '@relaycorp/relaynet-pohttp';
import { Job } from 'bull';

import { expectBuffersToEqual, generateStubNodeCertificate, getMockContext } from '../_test_utils';
import * as pingSerialization from '../pingSerialization';
import { base64Encode } from '../utils';
import { QueuedPing } from './QueuedPing';

const mockPino = { info: jest.fn() };
jest.mock('pino', () => jest.fn().mockImplementation(() => mockPino));
import { PingProcessor } from './processor';

afterAll(jest.restoreAllMocks);

describe('PingProcessor', () => {
  describe('deliverPongForPing', () => {
    const mockPrivateKeyStore = {
      fetchNodeKey: jest.fn(),
      fetchSessionKey: jest.fn(),
      saveSessionKey: jest.fn(),
    };

    const pingId = Buffer.from('a'.repeat(36));

    let recipientKeyPair: CryptoKeyPair;
    let recipientCertificate: Certificate;
    let senderKeyPair: CryptoKeyPair;
    let senderCertificate: Certificate;
    let serviceMessageSerialized: ArrayBuffer;
    let stubParcelPayload: EnvelopedData;
    let processor: PingProcessor;
    beforeAll(async () => {
      senderKeyPair = await generateRSAKeyPair();
      senderCertificate = await generateStubNodeCertificate(
        senderKeyPair.publicKey,
        senderKeyPair.privateKey,
      );

      recipientKeyPair = await generateRSAKeyPair();
      recipientCertificate = await generateStubNodeCertificate(
        recipientKeyPair.publicKey,
        recipientKeyPair.privateKey,
      );

      const serviceMessage = new ServiceMessage(
        'application/vnd.relaynet.ping-v1.ping',
        pingSerialization.serializePing(recipientCertificate, pingId),
      );
      serviceMessageSerialized = serviceMessage.serialize();
      stubParcelPayload = await SessionlessEnvelopedData.encrypt(
        serviceMessageSerialized,
        recipientCertificate,
      );

      processor = new PingProcessor(
        recipientCertificate.getSerialNumber(),
        (mockPrivateKeyStore as unknown) as VaultPrivateKeyStore,
      );
    });

    beforeEach(() => {
      jest.restoreAllMocks();

      mockPrivateKeyStore.fetchNodeKey.mockResolvedValue(recipientKeyPair.privateKey);

      jest.spyOn(pohttp, 'deliverParcel').mockResolvedValueOnce(
        // @ts-ignore
        undefined,
      );
    });

    test('The right node private key should be retrieved from the store', async () => {
      const job = await initJob();
      await processor.deliverPongForPing(job);

      expect(mockPrivateKeyStore.fetchNodeKey).toBeCalledTimes(2);
      expect(mockPrivateKeyStore.fetchNodeKey).toHaveBeenNthCalledWith(
        1,
        recipientCertificate.getSerialNumber(),
      );
      expect(mockPrivateKeyStore.fetchNodeKey).toHaveBeenNthCalledWith(
        2,
        recipientCertificate.getSerialNumber(),
      );
    });

    test('Failing to deserialize the ciphertext should be logged', async () => {
      const error = new Error('Nope');
      jest.spyOn(EnvelopedData, 'deserialize').mockImplementationOnce(() => {
        throw error;
      });

      const job = await initJob();
      await processor.deliverPongForPing(job);

      expect(mockPino.info).toBeCalledWith('Invalid service message', {
        err: error,
        jobId: job.id,
      });
    });

    test('Failing to unwrap the service message should be logged', async () => {
      const error = new Error('Nope');
      jest.spyOn(Parcel.prototype, 'unwrapPayload').mockImplementationOnce(() => {
        throw error;
      });

      const job = await initJob();
      await processor.deliverPongForPing(job);

      expect(mockPino.info).toBeCalledWith('Invalid service message', {
        err: error,
        jobId: job.id,
      });
    });

    test('Getting an invalid service message type should be logged', async () => {
      const messageType = 'application/invalid';
      const serviceMessage = new ServiceMessage(
        messageType,
        pingSerialization.serializePing(recipientCertificate, pingId),
      );
      jest
        .spyOn(Parcel.prototype, 'unwrapPayload')
        .mockResolvedValueOnce({ payload: serviceMessage });

      const job = await initJob();
      await processor.deliverPongForPing(job);

      expect(mockPino.info).toBeCalledWith('Invalid service message type', {
        jobId: job.id,
        messageType,
      });
      expect(pohttp.deliverParcel).not.toBeCalled();
    });

    test('Getting an invalid service message content should be logged', async () => {
      const error = new Error('Denied');
      jest.spyOn(pingSerialization, 'deserializePing').mockImplementationOnce(() => {
        throw error;
      });

      const job = await initJob();
      await processor.deliverPongForPing(job);

      expect(mockPino.info).toBeCalledWith('Invalid ping message', {
        err: error,
        jobId: job.id,
      });
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
          senderCertificate.getCommonName(),
        );
      });

      test('Parcel should be signed with PDA attached to ping message', () => {
        expect(deliveredParcel.senderCertificate.getCommonName()).toEqual(
          recipientCertificate.getCommonName(),
        );
      });

      test('Service message type should be application/vnd.relaynet.ping-v1.pong', () => {
        expect(ServiceMessage.prototype.serialize).toBeCalledTimes(1);
        const serviceMessage = getMockContext(ServiceMessage.prototype.serialize).instances[0];
        expect(serviceMessage).toHaveProperty('type', 'application/vnd.relaynet.ping-v1.pong');
      });

      test('Original ping id should be used as pong payload', () => {
        expect(ServiceMessage.prototype.serialize).toBeCalledTimes(1);
        const serviceMessage = getMockContext(ServiceMessage.prototype.serialize).instances[0];
        expectBuffersToEqual(serviceMessage.value, pingId);
      });

      test('Parcel payload should be encrypted with recipient certificate', () => {
        expect(SessionlessEnvelopedData.encrypt).toBeCalledTimes(1);
        const encryptCall = getMockContext(SessionlessEnvelopedData.encrypt).calls[0];
        expect(encryptCall[1].getCommonName()).toEqual(senderCertificate.getCommonName());
      });

      test('Parcel should be delivered to the specified gateway', () => {
        const deliverParcelCall = getMockContext(pohttp.deliverParcel).calls[0];
        expect(deliverParcelCall[0]).toEqual(stubGatewayAddress);
      });
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
      let recipientSessionKeyPair1: CryptoKeyPair;
      let recipientSessionCert1: Certificate;
      let stubSessionParcelPayload: SessionEnvelopedData;
      let stubJob: Job<QueuedPing>;
      beforeAll(async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        recipientSessionKeyPair1 = await generateECDHKeyPair();
        recipientSessionCert1 = await issueInitialDHKeyCertificate({
          issuerCertificate: recipientCertificate,
          issuerPrivateKey: recipientKeyPair.privateKey,
          subjectPublicKey: recipientSessionKeyPair1.publicKey,
          validityEndDate: tomorrow,
        });

        const encryptionResult = await SessionEnvelopedData.encrypt(
          serviceMessageSerialized,
          recipientSessionCert1,
        );
        stubSessionParcelPayload = encryptionResult.envelopedData;

        stubJob = await initJob({ parcelPayload: stubSessionParcelPayload });
      });

      beforeEach(() => {
        mockPrivateKeyStore.fetchSessionKey.mockResolvedValueOnce(
          recipientSessionKeyPair1.privateKey,
        );
      });

      test('The right DH private key should be retrieved and used for decryption', async () => {
        const decryptSpy = jest.spyOn(SessionEnvelopedData.prototype, 'decrypt');

        await processor.deliverPongForPing(stubJob);

        // Check key retrieval
        expect(mockPrivateKeyStore.fetchSessionKey).toBeCalledTimes(1);
        const getKeyCallArgs = mockPrivateKeyStore.fetchSessionKey.mock.calls[0];
        expect(getKeyCallArgs[0]).toEqual(recipientSessionCert1.getSerialNumber());
        expectBuffersToEqual(
          await getKeyCallArgs[1].serialize(),
          await senderCertificate.serialize(),
        );

        // Check use for decryption
        expect(decryptSpy).toBeCalledTimes(1);
        expect(decryptSpy).toBeCalledWith(recipientSessionKeyPair1.privateKey);
      });

      test('Pong message should be encrypted with public key from ping sender', async () => {
        const encryptSpy = jest.spyOn(SessionEnvelopedData, 'encrypt');

        await processor.deliverPongForPing(stubJob);

        expect(encryptSpy).toBeCalledTimes(1);
        expect(encryptSpy.mock.results[0].value).toResolve();

        // Check plaintext
        const encryptCallArgs = encryptSpy.mock.calls[0];
        const expectedPongMessage = new ServiceMessage(
          'application/vnd.relaynet.ping-v1.pong',
          pingId,
        );
        expectBuffersToEqual(encryptCallArgs[0], expectedPongMessage.serialize());

        // Check public key used
        const expectedOriginatorKey = await stubSessionParcelPayload.getOriginatorKey();
        const actualOriginatorKey = encryptCallArgs[1] as OriginatorSessionKey;
        expect(actualOriginatorKey).toHaveProperty('keyId', expectedOriginatorKey.keyId);
        expectBuffersToEqual(
          await derSerializePublicKey(actualOriginatorKey.publicKey),
          await derSerializePublicKey(expectedOriginatorKey.publicKey),
        );
      });

      test('New ephemeral keys should be saved', async () => {
        const encryptSpy = jest.spyOn(SessionEnvelopedData, 'encrypt');

        await processor.deliverPongForPing(stubJob);

        expect(mockPrivateKeyStore.saveSessionKey).toBeCalledTimes(1);
        const encryptCallResult = await encryptSpy.mock.results[0].value;
        expect(mockPrivateKeyStore.saveSessionKey).toBeCalledWith(
          encryptCallResult.dhPrivateKey,
          Buffer.from(encryptCallResult.dhKeyId),
          expect.anything(),
        );
        expect(
          senderCertificate.isEqual(mockPrivateKeyStore.saveSessionKey.mock.calls[0][2]),
        ).toBeTrue();
      });

      test('Retrieving an invalid originator key should be gracefully logged', async () => {
        const err = new Error('Denied');
        jest.spyOn(SessionEnvelopedData.prototype, 'getOriginatorKey').mockRejectedValueOnce(err);

        await processor.deliverPongForPing(stubJob);
        expect(mockPino.info).toBeCalledTimes(1);

        expect(mockPino.info).toBeCalledWith('Invalid service message', {
          err,
          jobId: stubJob.id,
        });
      });

      test('Use of unknown public key ids should be gracefully logged', async () => {
        const err = new Error('Denied');
        mockPrivateKeyStore.fetchSessionKey.mockReset();
        mockPrivateKeyStore.fetchSessionKey.mockRejectedValueOnce(err);

        await processor.deliverPongForPing(stubJob);

        expect(mockPino.info).toBeCalledTimes(1);
        expect(mockPino.info).toBeCalledWith('Invalid service message', {
          err,
          jobId: stubJob.id,
        });
      });
    });

    async function initJob(
      options: Partial<{
        readonly parcelPayload: EnvelopedData;
        readonly gatewayAddress: string;
      }> = {},
    ): Promise<Job<QueuedPing>> {
      const finalPayload = options.parcelPayload ?? stubParcelPayload;
      const parcel = new Parcel(
        '0-the-parcel-recipient',
        senderCertificate,
        Buffer.from(finalPayload.serialize()),
      );
      const data: QueuedPing = {
        gatewayAddress: options.gatewayAddress ?? 'dummy-gateway',
        parcel: base64Encode(await parcel.serialize(senderKeyPair.privateKey)),
      };
      // @ts-ignore
      return { data, id: 'random-id' };
    }
  });
});
