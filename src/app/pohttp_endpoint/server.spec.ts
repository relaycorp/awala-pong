import { EnvVarError } from 'env-var';
import { PONG_ENDPOINT_INTERNET_ADDRESS } from '../../testUtils/awala';

import { configureMockEnvVars } from '../../testUtils/envVars';
import { getMockContext, mockSpy } from '../../testUtils/jest';
import { makeMockLogging } from '../../testUtils/logging';
import * as logging from '../utilities/logging';
import * as server from './server';

import fastify = require('fastify');

const envVars = { PUBLIC_ENDPOINT_ADDRESS: PONG_ENDPOINT_INTERNET_ADDRESS };
const mockEnvVars = configureMockEnvVars(envVars);

const mockFastify = {
  addContentTypeParser: jest.fn(),
  listen: jest.fn(),
  ready: jest.fn(),
  register: jest.fn(),
};
jest.mock('fastify', () => jest.fn().mockImplementation(() => mockFastify));

const mockLogging = makeMockLogging();

afterAll(() => {
  jest.restoreAllMocks();
});

describe('makeServer', () => {
  test('Public endpoint address should be required', async () => {
    mockEnvVars({});

    await expect(server.makeServer(mockLogging.logger)).rejects.toBeInstanceOf(EnvVarError);
  });

  test('Specified logger should be used', async () => {
    await server.makeServer(mockLogging.logger);

    expect(fastify).toBeCalledWith(
      expect.objectContaining({
        logger: mockLogging.logger,
      }),
    );
  });

  test('X-Request-Id should be the default request id header', async () => {
    await server.makeServer(mockLogging.logger);

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('requestIdHeader', 'X-Request-Id');
  });

  test('Custom request id header can be set via PONG_REQUEST_ID_HEADER variable', async () => {
    const requestIdHeader = 'X-Id';
    mockEnvVars({ ...envVars, PONG_REQUEST_ID_HEADER: requestIdHeader });

    await server.makeServer(mockLogging.logger);

    const fastifyCallArgs = getMockContext(fastify).calls[0];
    expect(fastifyCallArgs[0]).toHaveProperty('requestIdHeader', requestIdHeader);
  });

  test('Content-Type application/vnd.awala.parcel should be supported', async () => {
    await server.makeServer(mockLogging.logger);

    expect(mockFastify.addContentTypeParser).toBeCalledTimes(1);
    const addContentTypeParserCallArgs = getMockContext(mockFastify.addContentTypeParser).calls[0];
    expect(addContentTypeParserCallArgs[0]).toEqual('application/vnd.awala.parcel');
    expect(addContentTypeParserCallArgs[1]).toEqual({ parseAs: 'buffer' });

    // It shouldn't actually parse the body just yet:
    const parser = addContentTypeParserCallArgs[2];
    const stubBody = {};
    await expect(parser({}, stubBody)).resolves.toBe(stubBody);
  });

  test('fastify-url-data should be registered', async () => {
    await server.makeServer(mockLogging.logger);

    expect(mockFastify.register).toBeCalledWith(require('fastify-url-data'));
  });

  test('Routes should be loaded', async () => {
    await server.makeServer(mockLogging.logger);

    const routeOptions = { internetAddress: PONG_ENDPOINT_INTERNET_ADDRESS };
    expect(mockFastify.register).toBeCalledWith(require('./parcelDelivery').default, routeOptions);
    expect(mockFastify.register).toBeCalledWith(
      require('./connectionParams').default,
      routeOptions,
    );
  });

  test('Fastify instance should be ready', async () => {
    await server.makeServer(mockLogging.logger);

    expect(mockFastify.ready).toBeCalledWith();
  });

  test('Server instance should be returned', async () => {
    const serverInstance = await server.makeServer(mockLogging.logger);

    expect(serverInstance).toBe(mockFastify);
  });
});

describe('runServer', () => {
  const mockMakeLogger = mockSpy(jest.spyOn(logging, 'makeLogger'), () => mockLogging.logger);

  test('New logger should be used', async () => {
    expect(mockMakeLogger).not.toBeCalled();

    await server.runServer();

    expect(mockMakeLogger).toBeCalledWith();
    expect(fastify).toBeCalledWith(
      expect.objectContaining({
        logger: mockLogging.logger,
      }),
    );
  });

  test('Server returned by server.makeServer() should be used', async () => {
    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
  });

  test('Server should listen on port 8080', async () => {
    await server.runServer();

    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('port', 8080);
  });

  test('Server should listen on 0.0.0.0', async () => {
    await server.runServer();

    expect(mockFastify.listen).toBeCalledTimes(1);
    const listenCallArgs = getMockContext(mockFastify.listen).calls[0];
    expect(listenCallArgs[0]).toHaveProperty('host', '0.0.0.0');
  });

  test('listen() call should be "awaited" for', async () => {
    const error = new Error('Denied');
    mockFastify.listen.mockRejectedValueOnce(error);

    await expect(server.runServer()).rejects.toEqual(error);
  });
});
