import {
  generateRSAKeyPair,
  issueNodeCertificate,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { HTTPInjectOptions, HTTPMethod } from 'fastify';

import * as pongQueue from '../background_queue/queue';
import { makeServer } from './server';

const serverInstance = makeServer();

const validRequestOptions: HTTPInjectOptions = {
  headers: {
    'Content-Type': 'application/vnd.relaynet.parcel',
    'X-Relaynet-Gateway': 'https://gateway.example',
  },
  method: 'POST',
  payload: {},
  url: '/',
};
beforeAll(async () => {
  const payload = await generateStubParcel('https://localhost/');
  // tslint:disable-next-line:no-object-mutation
  validRequestOptions.payload = payload;
  // tslint:disable-next-line:readonly-keyword no-object-mutation
  (validRequestOptions.headers as { [key: string]: string })[
    'Content-Length'
  ] = payload.byteLength.toString();
});

const pongQueueAddSpy = jest.fn();
const pongQueueSpy = jest.spyOn(pongQueue, 'initQueue').mockReturnValue(
  // @ts-ignore
  { add: pongQueueAddSpy },
);

afterAll(() => {
  pongQueueSpy.mockRestore();
});

describe('receiveParcel', () => {
  test.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'] as readonly HTTPMethod[])(
    '%s requests should be refused',
    async method => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers },
        method,
      });

      expect(response).toHaveProperty('statusCode', 405);
      expect(response).toHaveProperty('headers.allow', 'POST');
    },
  );

  test('Content-Type other than application/vnd.relaynet.parcel should be refused', async () => {
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: {
        ...validRequestOptions.headers,
        'Content-Length': '2',
        'Content-Type': 'application/json',
      },
      payload: {},
    });

    expect(response).toHaveProperty('statusCode', 415);
  });

  describe('X-Relaynet-Gateway request header', () => {
    const validationErrorMessage = 'X-Relaynet-Gateway should be set to a valid PoHTTP endpoint';

    test('X-Relaynet-Gateway should not be absent', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Relaynet-Gateway': undefined },
      });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });

    test('X-Relaynet-Gateway should not be an invalid URI', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Relaynet-Gateway': 'foo@example.com' },
      });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });

    test('Any schema other than "https" should be refused', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Relaynet-Gateway': 'http://example.com' },
      });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });
  });

  test('Request body should be refused if it is not a valid RAMF-serialized parcel', async () => {
    const payload = Buffer.from('');
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 400);
    expect(JSON.parse(response.payload)).toHaveProperty(
      'message',
      'Payload is not a valid RAMF-serialized parcel',
    );
  });

  test('Parcel should be refused if target is not current endpoint', async () => {
    const payload = await generateStubParcel('https://invalid.com/endpoint');
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 400);
    expect(JSON.parse(response.payload)).toHaveProperty('message', 'Invalid parcel recipient');
  });

  describe('Valid parcel delivery', () => {
    test('202 response should be returned', async () => {
      const response = await serverInstance.inject(validRequestOptions);

      expect(response).toHaveProperty('statusCode', 202);
      expect(JSON.parse(response.payload)).toEqual({});
    });

    test('Parcel payload and metadata should be sent to background queue', async () => {
      await serverInstance.inject(validRequestOptions);

      expect(pongQueueAddSpy).toBeCalledTimes(1);
      const parcel = await Parcel.deserialize(validRequestOptions.payload as ArrayBuffer);
      const expectedMessageData = {
        gatewayAddress: (validRequestOptions.headers as { readonly [k: string]: string })[
          'X-Relaynet-Gateway'
        ],
        senderCertificate: base64Encode(parcel.senderCertificate.serialize()),
        serviceMessageCiphertext: base64Encode(parcel.payloadSerialized),
      };
      expect(pongQueueAddSpy).toBeCalledWith(expectedMessageData);
    });
  });
});

async function generateStubParcel(recipientAddress: string): Promise<ArrayBuffer> {
  const senderKeyPair = await generateRSAKeyPair();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const senderCertificate = await issueNodeCertificate({
    issuerPrivateKey: senderKeyPair.privateKey,
    serialNumber: 1,
    subjectPublicKey: senderKeyPair.publicKey,
    validityEndDate: tomorrow,
  });

  const recipientKeyPair = await generateRSAKeyPair();
  const recipientCertificate = await issueNodeCertificate({
    issuerPrivateKey: recipientKeyPair.privateKey,
    serialNumber: 2,
    subjectPublicKey: recipientKeyPair.publicKey,
    validityEndDate: tomorrow,
  });
  const serviceMessage = new ServiceMessage(
    'application/vnd.relaynet.ping.ping',
    Buffer.from('abc'),
  );
  const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
    serviceMessage.serialize(),
    recipientCertificate,
  );
  const parcel = new Parcel(
    recipientAddress,
    senderCertificate,
    serviceMessageEncrypted.serialize(),
  );

  return Buffer.from(await parcel.serialize(senderKeyPair.privateKey));
}

function base64Encode(payload: ArrayBuffer): string {
  return Buffer.from(payload).toString('base64');
}
