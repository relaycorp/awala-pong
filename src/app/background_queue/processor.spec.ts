/* tslint:disable:no-let */
import {
  Certificate,
  generateRSAKeyPair,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { Job } from 'bull';
import WebCrypto from 'node-webcrypto-ossl';

import { generateStubNodeCertificate, mockEnvVars } from '../_test_utils';
import * as pingSerialization from '../pingSerialization';

const crypto = new WebCrypto();

const mockPino = { info: jest.fn() };
jest.mock('pino', () => jest.fn().mockImplementation(() => mockPino));
import processPing from './processor';

afterAll(jest.restoreAllMocks);

describe('processPing', () => {
  const pingId = Buffer.from('a'.repeat(36));
  let recipientPrivateKeyPem: string;
  let senderCertificate: Certificate;
  let serviceMessageEncrypted: ArrayBuffer;
  let stubJobData: {
    readonly gatewayAddress: string;
    readonly senderCertificate: string;
    readonly serviceMessageCiphertext: string;
  };
  beforeAll(async () => {
    const senderKeyPair = await generateRSAKeyPair();
    senderCertificate = await generateStubNodeCertificate(
      senderKeyPair.publicKey,
      senderKeyPair.privateKey,
    );

    const recipientKeyPair = await generateRSAKeyPair();
    const recipientCertificate = await generateStubNodeCertificate(
      recipientKeyPair.publicKey,
      recipientKeyPair.privateKey,
    );

    const serviceMessage = new ServiceMessage(
      'application/vnd.relaynet.ping-v1.ping',
      pingSerialization.serializePing(recipientCertificate, pingId),
    );
    serviceMessageEncrypted = (
      await SessionlessEnvelopedData.encrypt(serviceMessage.serialize(), recipientCertificate)
    ).serialize();

    stubJobData = {
      gatewayAddress: 'dummy-gateway',
      senderCertificate: Buffer.from(senderCertificate.serialize()).toString('base64'),
      serviceMessageCiphertext: Buffer.from(serviceMessageEncrypted).toString('base64'),
    };

    recipientPrivateKeyPem = await exportPrivateKeyToPem(recipientKeyPair.privateKey);
  });

  beforeEach(() => {
    jest.restoreAllMocks();

    mockEnvVars({ ENDPOINT_PRIVATE_KEY: recipientPrivateKeyPem });
  });

  test('Failing to deserialize the ciphertext should be logged', async () => {
    const error = new Error('Nope');
    jest.spyOn(SessionlessEnvelopedData, 'deserialize').mockImplementationOnce(() => {
      throw error;
    });

    const job = initJob(stubJobData);
    await processPing(job);

    expect(mockPino.info).toBeCalledWith('Invalid service message', {
      err: error,
      jobId: job.id,
    });
  });

  test('Failing to decrypt a message should be logged', async () => {
    const error = new Error('Nope');
    jest.spyOn(SessionlessEnvelopedData.prototype, 'decrypt').mockImplementationOnce(() => {
      throw error;
    });

    const job = initJob(stubJobData);
    await processPing(job);

    expect(mockPino.info).toBeCalledWith('Invalid service message', {
      err: error,
      jobId: job.id,
    });
  });

  test('Failing to deserialize the plaintext should be logged', async () => {
    const error = new Error('Nope');
    jest.spyOn(ServiceMessage, 'deserialize').mockImplementationOnce(() => {
      throw error;
    });

    const job = initJob(stubJobData);
    await processPing(job);

    expect(mockPino.info).toBeCalledWith('Invalid service message', {
      err: error,
      jobId: job.id,
    });
  });

  test('Getting an invalid service message type should be logged', async () => {
    const messageType = 'application/invalid';
    jest
      .spyOn(ServiceMessage, 'deserialize')
      .mockReturnValueOnce(new ServiceMessage(messageType, Buffer.from('foo')));

    const job = initJob(stubJobData);
    await processPing(job);

    expect(mockPino.info).toBeCalledWith('Invalid service message type', {
      jobId: job.id,
      messageType,
    });
  });

  test('Getting an invalid service message content should be logged', async () => {
    const error = new Error('Denied');
    jest.spyOn(pingSerialization, 'deserializePing').mockImplementationOnce(() => {
      throw error;
    });

    const job = initJob(stubJobData);
    await processPing(job);

    expect(mockPino.info).toBeCalledWith('Invalid ping message', {
      err: error,
      jobId: job.id,
    });
  });

  describe('Pong response', () => {
    test.todo('Original ping id should be used as pong payload');

    test.todo('Service message type should be application/vnd.relaynet.ping-v1.pong');

    test.todo('Parcel should be signed with PDA attached to ping message');

    test.todo('Parcel should be delivered to the specified gateway');
  });
});

function initJob(data: { readonly [key: string]: string }): Job {
  // @ts-ignore
  return { data, id: 'random-id' };
}

async function exportPrivateKeyToPem(privateKey: CryptoKey): Promise<string> {
  const recipientPrivateKeyBuffer = await crypto.subtle.exportKey(
    'pkcs8',
    privateKey as NodeWebcryptoOpenSSL.CryptoKey,
  );
  const recipientPrivateKeyBase64 = Buffer.from(recipientPrivateKeyBuffer).toString('base64');
  return [
    '-----BEGIN PRIVATE KEY-----',
    ...(recipientPrivateKeyBase64.match(/.{1,64}/g) as readonly string[]),
    '-----END PRIVATE KEY-----',
  ].join('\n');
}
