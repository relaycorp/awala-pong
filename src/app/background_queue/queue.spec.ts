import { mockEnvVars } from '../_test_utils';
import { initQueue } from './queue';

describe('initQueue', () => {
  const stubRedisHost = 'redis';
  const stubEndpointPrivateKey = 'secret';
  const stubEnvVars = { ENDPOINT_PRIVATE_KEY: stubEndpointPrivateKey, REDIS_HOST: stubRedisHost };

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('Error should be thrown if ENDPOINT_PRIVATE_KEY is absent', () => {
    mockEnvVars({ ...stubEnvVars, ENDPOINT_PRIVATE_KEY: undefined });
    expect(initQueue).toThrowWithMessage(Error, /ENDPOINT_PRIVATE_KEY/);
  });

  test('Error should be thrown if REDIS_HOST is undefined', () => {
    mockEnvVars({ ...stubEnvVars, REDIS_HOST: undefined });
    expect(initQueue).toThrowWithMessage(Error, /REDIS_HOST/);
  });

  test('REDIS_HOST variable should be used by queue', () => {
    mockEnvVars(stubEnvVars);

    const queue = initQueue();

    expect(queue).toHaveProperty('clients.0.connector.options.host', stubRedisHost);
  });

  test('Redis port should default to 6379', () => {
    mockEnvVars(stubEnvVars);

    const queue = initQueue();

    expect(queue).toHaveProperty('clients.0.connector.options.port', 6379);
  });

  test('REDIS_PORT should be used as Redis port if set', () => {
    const stubPort = 1234;
    mockEnvVars({ ...stubEnvVars, REDIS_PORT: stubPort.toString() });

    const queue = initQueue();

    expect(queue).toHaveProperty('clients.0.connector.options.port', stubPort);
  });

  test('Queue name should be set to "pong"', () => {
    mockEnvVars(stubEnvVars);

    const queue = initQueue();

    expect(queue).toHaveProperty('name', 'pong');
  });
});
