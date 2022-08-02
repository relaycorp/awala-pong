import { getIdFromIdentityKey, MockPrivateKeyStore, Recipient } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { subDays } from 'date-fns';
import { FastifyInstance, HTTPInjectOptions, HTTPMethod } from 'fastify';

import { generatePingParcel, PONG_ENDPOINT_INTERNET_ADDRESS } from '../../testUtils/awala';
import { mockConfigInitFromEnv } from '../../testUtils/config';
import { configureMockEnvVars } from '../../testUtils/envVars';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLogging, partialPinoLog } from '../../testUtils/logging';
import * as pongQueue from '../background_queue/queue';
import { QueuedPing } from '../background_queue/QueuedPing';
import * as vault from '../backingServices/vault';
import { base64Encode } from '../utilities/base64';
import { ENV_VARS } from './_test_utils';
import { makeServer } from './server';

configureMockEnvVars(ENV_VARS);
mockConfigInitFromEnv();

const mockLogging = makeMockLogging();
let serverInstance: FastifyInstance;
beforeEach(async () => {
  serverInstance = await makeServer(mockLogging.logger);
});

const validRequestOptions: HTTPInjectOptions = {
  headers: {
    'Content-Type': 'application/vnd.awala.parcel',
    Host: `pohttp-${PONG_ENDPOINT_INTERNET_ADDRESS}`,
  },
  method: 'POST',
  payload: {},
  url: '/',
};

let keyPairSet: NodeKeyPairSet;
let certificatePath: PDACertPath;
let pongEndpointId: string;
let pingParcelRecipient: Recipient;
beforeAll(async () => {
  keyPairSet = await generateIdentityKeyPairSet();
  certificatePath = await generatePDACertificationPath(keyPairSet);

  pongEndpointId = await getIdFromIdentityKey(keyPairSet.pdaGrantee.publicKey);
  pingParcelRecipient = {
    id: pongEndpointId,
    internetAddress: PONG_ENDPOINT_INTERNET_ADDRESS,
  };
  const payload = await generatePingParcel(
    pingParcelRecipient,
    certificatePath.privateEndpoint,
    keyPairSet,
    certificatePath,
  );
  // tslint:disable-next-line:no-object-mutation
  validRequestOptions.payload = payload;
  // tslint:disable-next-line:readonly-keyword no-object-mutation
  (validRequestOptions.headers as { [key: string]: string })['Content-Length'] =
    payload.byteLength.toString();
});

const mockPrivateKeyStore = new MockPrivateKeyStore();
mockSpy(jest.spyOn(vault, 'initVaultKeyStore'), () => mockPrivateKeyStore);
beforeEach(async () => {
  await mockPrivateKeyStore.saveIdentityKey(pongEndpointId, keyPairSet.pdaGrantee.privateKey);
});
afterEach(() => {
  mockPrivateKeyStore.clear();
});

const pongQueueAddSpy = jest.fn();
const pongQueueIsReadySpy = jest.fn();
jest
  .spyOn(pongQueue, 'initQueue')
  .mockReturnValue({ add: pongQueueAddSpy, isReady: pongQueueIsReadySpy } as any);
beforeEach(() => {
  pongQueueAddSpy.mockReset();
  pongQueueIsReadySpy.mockReset();
});

afterAll(() => {
  jest.restoreAllMocks();
});

test.each(['PUT', 'PATCH', 'DELETE'] as readonly HTTPMethod[])(
  '%s requests should be refused',
  async (method) => {
    const response = await serverInstance.inject({
      ...validRequestOptions,
      method,
    });

    expect(response).toHaveProperty('statusCode', 405);
    expect(response).toHaveProperty('headers.allow', 'HEAD, GET, POST');
  },
);

describe('Health check', () => {
  test('A plain simple HEAD request should provide some diagnostic information', async () => {
    const response = await serverInstance.inject({ method: 'HEAD', url: '/' });

    expect(response).toHaveProperty('statusCode', 200);
    expect(response).toHaveProperty('headers.content-type', 'text/plain');
  });

  test('A plain simple GET request should provide some diagnostic information', async () => {
    const response = await serverInstance.inject({ method: 'GET', url: '/' });

    expect(response).toHaveProperty('statusCode', 200);
    expect(response).toHaveProperty('headers.content-type', 'text/plain');
    expect(response.payload).toContain('Success');
    expect(response.payload).toContain('PoHTTP');
  });

  test('A 503 response should be returned when the queue is not ready', async () => {
    pongQueueIsReadySpy.mockRejectedValueOnce(new Error('Not ready'));

    const response = await serverInstance.inject({ method: 'GET', url: '/' });

    expect(response).toHaveProperty('statusCode', 503);
    expect(response).toHaveProperty('headers.content-type', 'text/plain');
    expect(response.payload).toContain('unavailable');
  });
});

describe('receiveParcel', () => {
  test('Content-Type other than application/vnd.awala.parcel should be refused', async () => {
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

  test('Request body should be refused if it is not a valid RAMF-serialized parcel', async () => {
    const payload = Buffer.from('');
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 403);
    expect(JSON.parse(response.payload)).toHaveProperty(
      'message',
      'Payload is not a valid RAMF-serialized parcel',
    );
  });

  test('Parcel should be refused if it is well-formed but invalid', async () => {
    const yesterday = subDays(new Date(), 1);
    const payload = await generatePingParcel(
      pingParcelRecipient,
      certificatePath.privateEndpoint,
      keyPairSet,
      certificatePath,
      yesterday,
    );
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 403);
    expect(JSON.parse(response.payload)).toHaveProperty(
      'message',
      'Parcel is well-formed but invalid',
    );
  });

  test('Parcel should be ignored if recipient private address does not match', async () => {
    const invalidRecipient = { ...pingParcelRecipient, id: `${pingParcelRecipient.id}abc` };
    const payload = await generatePingParcel(
      invalidRecipient,
      certificatePath.privateEndpoint,
      keyPairSet,
      certificatePath,
    );
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 202);
    expect(JSON.parse(response.payload)).toBeEmptyObject();
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Parcel is bound for recipient with different private address', {
        recipient: invalidRecipient,
      }),
    );
  });

  test('Parcel should be refused if recipient Internet address does not match', async () => {
    const invalidRecipient = {
      ...pingParcelRecipient,
      internetAddress: `not-${PONG_ENDPOINT_INTERNET_ADDRESS}`,
    };
    const payload = await generatePingParcel(
      invalidRecipient,
      certificatePath.privateEndpoint,
      keyPairSet,
      certificatePath,
    );
    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: { ...validRequestOptions.headers, 'Content-Length': payload.byteLength.toString() },
      payload,
    });

    expect(response).toHaveProperty('statusCode', 403);
    expect(JSON.parse(response.payload)).toHaveProperty('message', 'Invalid parcel recipient');
    expect(mockLogging.logs).toContainEqual(
      partialPinoLog('info', 'Parcel is bound for recipient with different Internet address', {
        recipient: invalidRecipient,
      }),
    );
  });

  describe('Valid parcel delivery', () => {
    test('202 response should be returned', async () => {
      const response = await serverInstance.inject(validRequestOptions);

      expect(response).toHaveProperty('statusCode', 202);
      expect(JSON.parse(response.payload)).toEqual({});
    });

    test('Parcel should be sent to background queue', async () => {
      await serverInstance.inject(validRequestOptions);

      expect(pongQueueAddSpy).toBeCalledTimes(1);
      const expectedMessageData: QueuedPing = {
        parcel: base64Encode(validRequestOptions.payload as Buffer),
      };
      expect(pongQueueAddSpy).toBeCalledWith(expectedMessageData);
    });

    test('Failing to queue the ping message should result in a 500 response', async () => {
      const error = new Error('Oops');
      pongQueueAddSpy.mockRejectedValueOnce(error);

      const response = await serverInstance.inject(validRequestOptions);

      expect(response).toHaveProperty('statusCode', 500);
      expect(JSON.parse(response.payload)).toEqual({
        message: 'Could not queue ping message for processing',
      });

      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('error', 'Failed to queue ping message', {
          err: expect.objectContaining({ message: error.message }),
        }),
      );
    });
  });
});
