import { configureMockEnvVars } from '../../testUtils/envVars';
import { initQueue } from './queue';

describe('initQueue', () => {
  const stubRedisHost = 'redis';
  const stubEnvVars = { REDIS_HOST: stubRedisHost };
  const mockEnvVars = configureMockEnvVars(stubEnvVars);

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('Error should be thrown if REDIS_HOST is undefined', () => {
    mockEnvVars({ ...stubEnvVars, REDIS_HOST: undefined });
    expect(initQueue).toThrowWithMessage(Error, /REDIS_HOST/);
  });

  test('REDIS_HOST variable should be used by queue', async () => {
    const queue = initQueue();

    try {
      expect(queue).toHaveProperty('clients.0.connector.options.host', stubRedisHost);
    } finally {
      await queue.close();
    }
  });

  test('Redis port should default to 6379', async () => {
    const queue = initQueue();

    try {
      expect(queue).toHaveProperty('clients.0.connector.options.port', 6379);
    } finally {
      await queue.close();
    }
  });

  test('REDIS_PORT should be used as Redis port if set', async () => {
    const stubPort = 1234;
    mockEnvVars({ ...stubEnvVars, REDIS_PORT: stubPort.toString() });

    const queue = initQueue();

    try {
      expect(queue).toHaveProperty('clients.0.connector.options.port', stubPort);
    } finally {
      await queue.close();
    }
  });

  test('Queue name should be set to "pong"', async () => {
    const queue = initQueue();

    try {
      expect(queue).toHaveProperty('name', 'pong');
    } finally {
      await queue.close();
    }
  });
});
