import { HTTPInjectOptions, HTTPMethod } from 'fastify';

import { makeServer } from './server';

const serverInstance = makeServer();

const validRequestOptions: HTTPInjectOptions = {
  headers: {
    'Content-Type': 'application/vnd.relaynet.parcel',
    'X-Relaynet-Gateway': 'rng+https://example.com',
  },
  method: 'POST',
  payload: {},
  url: '/',
};

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
      headers: { ...validRequestOptions.headers, 'Content-Type': 'application/json' },
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

    test('Any schema other than rng+https should be refused', async () => {
      const response = await serverInstance.inject({
        ...validRequestOptions,
        headers: { ...validRequestOptions.headers, 'X-Relaynet-Gateway': 'https://example.com' },
      });

      expect(response).toHaveProperty('statusCode', 400);
      expect(JSON.parse(response.payload)).toHaveProperty('message', validationErrorMessage);
    });
  });

  test.todo('Request body should be a valid RAMF-serialized parcel');

  describe('Valid parcel delivery', () => {
    test.todo('202 response should be returned');

    test.todo('Parcel payload and metadata should be sent to background queue');
  });
});
