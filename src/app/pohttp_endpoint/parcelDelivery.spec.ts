import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import { FastifyInstance, HTTPInjectOptions, HTTPMethod } from 'fastify';

import { generatePingParcel } from '../../testUtils/awala';
import { mockConfigInitFromEnv } from '../../testUtils/config';
import { configureMockEnvVars } from '../../testUtils/envVars';
import { makeMockLogging, partialPinoLog } from '../../testUtils/logging';
import * as pongQueue from '../background_queue/queue';
import { QueuedPing } from '../background_queue/QueuedPing';
import { base64Encode } from '../utilities/base64';
import { ENV_VARS, ENDPOINT_INTERNET_ADDRESS } from './_test_utils';
import { makeServer } from './server';

const mockEnvVars = configureMockEnvVars(ENV_VARS);
mockConfigInitFromEnv();

const mockLogging = makeMockLogging();
let serverInstance: FastifyInstance;
beforeEach(async () => {
  serverInstance = await makeServer(mockLogging.logger);
});

const validRequestOptions: HTTPInjectOptions = {
  headers: {
    'Content-Type': 'application/vnd.awala.parcel',
    Host: `pohttp-${ENDPOINT_INTERNET_ADDRESS}`,
    'X-Awala-Gateway': 'https://gateway.example',
  },
  method: 'POST',
  payload: {},
  url: '/',
};
let keyPairSet: NodeKeyPairSet;
let certificatePath: PDACertPath;
beforeAll(async () => {
  keyPairSet = await generateIdentityKeyPairSet();
  certificatePath = await generatePDACertificationPath(keyPairSet);

  const payload = await generatePingParcel(
    `https://${ENDPOINT_INTERNET_ADDRESS}`,
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

  describe('X-Awala-Gateway request header', () => {
    const validationErrorMessage = 'X-Awala-Gateway should be set to a valid PoHTTP endpoint';

    test('X-Awala-Gateway should not be absent', async () => {
      const allHeaders = validRequestOptions.headers as { readonly [key: string]: string };
      const headers = Object.keys(allHeaders)
        .filter((h) => h !== 'X-Awala-Gateway')
        .reduce((a, h) => ({ ...a, [h]: allHeaders[h] }), {});
      const response = await serverInstance.inject({ ...validRequestOptions, headers });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });

    test('X-Awala-Gateway should not be an invalid URI', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Awala-Gateway': 'foo@example.com' },
      });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });

    test('Any schema other than "https" should be refused', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Awala-Gateway': 'http://example.com' },
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

    expect(response).toHaveProperty('statusCode', 403);
    expect(JSON.parse(response.payload)).toHaveProperty(
      'message',
      'Payload is not a valid RAMF-serialized parcel',
    );
  });

  test('Parcel should be refused if it is well-formed but invalid', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const payload = await generatePingParcel(
      `https://${ENDPOINT_INTERNET_ADDRESS}/`,
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

  test('Parcel should be refused if target is not current endpoint', async () => {
    const payload = await generatePingParcel(
      'https://invalid.com/endpoint',
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
        gatewayAddress: (validRequestOptions.headers as { readonly [k: string]: string })[
          'X-Awala-Gateway'
        ],
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

  test('Non-TLS URLs should be allowed when POHTTP_TLS_REQUIRED=false', async () => {
    mockEnvVars({ ...ENV_VARS, POHTTP_TLS_REQUIRED: 'false' });
    const stubPayload = await generatePingParcel(
      `http://${ENDPOINT_INTERNET_ADDRESS}`,
      certificatePath.privateEndpoint,
      keyPairSet,
      certificatePath,
    );

    const response = await serverInstance.inject({
      ...validRequestOptions,
      headers: {
        ...validRequestOptions.headers,
        'Content-Length': stubPayload.byteLength.toString(),
        'X-Awala-Gateway': 'http://example.com',
      },
      payload: stubPayload,
    });

    expect(response).toHaveProperty('statusCode', 202);
  });
});
