import envVar from 'env-var';

import { getMockContext } from '../_test_utils';
import * as server from './server';

import fastify = require('fastify');

const mockFastify = { addContentTypeParser: jest.fn(), listen: jest.fn(), register: jest.fn() };
jest.mock('fastify', () => jest.fn().mockImplementation(() => mockFastify));

afterAll(() => {
  jest.restoreAllMocks();
});

describe('makeServer', () => {
  test('Logger should be enabled', () => {
    server.makeServer();

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('logger', true);
  });

  test('X-Request-Id should be the default request id header', () => {
    server.makeServer();

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('requestIdHeader', 'X-Request-Id');
  });

  test('Custom request id header can be set via PONG_REQUEST_ID_HEADER variable', () => {
    const requestIdHeader = 'X-Id';
    // tslint:disable-next-line:no-object-mutation
    process.env.PONG_REQUEST_ID_HEADER = requestIdHeader;

    server.makeServer();

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('requestIdHeader', requestIdHeader);
  });

  test('Content-Type application/vnd.relaynet.parcel should be supported', () => {
    server.makeServer();

    expect(mockFastify.addContentTypeParser).toBeCalledTimes(1);
    const addContentTypeParserCallArgs = getMockContext(mockFastify.addContentTypeParser).calls[0];
    expect(addContentTypeParserCallArgs[0]).toEqual('application/vnd.relaynet.parcel');
    expect(addContentTypeParserCallArgs[1]).toEqual({ parseAs: 'buffer' });

    // It shouldn't actually parse the body just yet:
    const parser = addContentTypeParserCallArgs[2];
    const stubBody = {};
    expect(parser({}, stubBody)).resolves.toBe(stubBody);
  });

  test('fastify-url-data should be registered', () => {
    server.makeServer();

    expect(mockFastify.register).toBeCalledWith(require('fastify-url-data'));
  });

  test('Routes should be loaded', () => {
    server.makeServer();

    expect(mockFastify.register).toBeCalledWith(require('./routes').default);
  });

  test('Server instance should be returned', () => {
    const serverInstance = server.makeServer();

    expect(serverInstance).toBe(mockFastify);
  });
});

describe('runServer', () => {
  test('Server returned by server.makeServer() should be used', async () => {
    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
  });

  test('Port 3000 should be used by default', async () => {
    await server.runServer();

    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('port', 3000);
  });

  test('Custom port can be set via PONG_PORT environment variable', async () => {
    const customPort = '3001';
    jest.spyOn(envVar, 'get').mockImplementation((...args: readonly any[]) => {
      const originalEnvVar = jest.requireActual('env-var');
      const env = originalEnvVar.from({ PONG_PORT: customPort });

      return env.get(...args);
    });

    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('port', parseInt(customPort, 10));
  });

  test('Host 0.0.0.0 should be used by default', async () => {
    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('host', '0.0.0.0');
  });

  test('Custom host can be set via PONG_HOST environment variable', async () => {
    const customHost = '192.0.2.1';
    jest.spyOn(envVar, 'get').mockImplementation((...args: readonly any[]) => {
      const originalEnvVar = jest.requireActual('env-var');
      const env = originalEnvVar.from({ PONG_HOST: customHost });

      return env.get(...args);
    });

    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('host', customHost);
  });

  test('listen() call should be "awaited" for', async () => {
    const error = new Error('Denied');
    mockFastify.listen.mockRejectedValueOnce(error);

    await expect(server.runServer()).rejects.toEqual(error);
  });
});
