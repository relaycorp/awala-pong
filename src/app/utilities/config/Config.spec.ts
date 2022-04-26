import { EnvVarError } from 'env-var';
import Keyv from 'keyv';

import { configureMockEnvVars } from '../../../testUtils/envVars';
import { getMockContext } from '../../../testUtils/jest';
import { catchError } from '../../../testUtils/errors';
import { Config } from './Config';
import { ConfigError } from './ConfigError';
import { ConfigItem } from './ConfigItem';

jest.mock('keyv');

let stubKeyv: Keyv;
beforeAll(() => {
  const actualKeyvClass = jest.requireActual('keyv');
  stubKeyv = new actualKeyvClass();
});
afterEach(async () => {
  await stubKeyv.clear();
});

describe('set', () => {
  test('Value should be set', async () => {
    const config = new Config(stubKeyv);
    const value = 'foo';

    await config.set(ConfigItem.CURRENT_PRIVATE_ADDRESS, value);

    await expect(stubKeyv.get(ConfigItem.CURRENT_PRIVATE_ADDRESS)).resolves.toEqual(value);
  });
});

describe('get', () => {
  test('Null should be returned if value does not exist', async () => {
    const config = new Config(stubKeyv);

    await expect(config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS)).resolves.toBeNull();
  });

  test('Value should be returned if it exists', async () => {
    const config = new Config(stubKeyv);
    const value = 'foo';
    await stubKeyv.set(ConfigItem.CURRENT_PRIVATE_ADDRESS, value);

    await expect(config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS)).resolves.toEqual(value);
  });
});

describe('close', () => {
  test('Redis connection should be disconnected', () => {
    const mockRedisKeyv = {
      opts: {
        store: { redis: { disconnect: jest.fn() } },
      },
    };
    const config = new Config(mockRedisKeyv as any);

    config.close();

    expect(mockRedisKeyv.opts.store.redis.disconnect).toHaveBeenCalledWith();
  });

  test('Nothing should be done by default', () => {
    const config = new Config({ opts: { store: {} } } as any);

    config.close();
  });
});

describe('initFromEnv', () => {
  const CONFIG_URL = 'scheme://foo';
  const mockEnvVars = configureMockEnvVars({ CONFIG_URL });

  test('Error should be thrown if CONFIG_URL is not defined', () => {
    mockEnvVars({ CURRENT_PRIVATE_ADDRESS: undefined });

    expect(() => Config.initFromEnv()).toThrowWithMessage(EnvVarError, /CONFIG_URL/);
  });

  test('Config object should be returned', () => {
    const config = Config.initFromEnv();

    expect(config).toBeInstanceOf(Config);
    expect(Keyv).toHaveBeenCalledWith(CONFIG_URL, expect.anything());
  });

  test('Errors should be wrapped', () => {
    Config.initFromEnv();

    expect(Keyv.prototype.on).toHaveBeenCalledWith('error', expect.toBeFunction());
    const onErrorHandler = getMockContext(Keyv.prototype.on).calls[0][1];
    const originalError = new Error('oh noes');
    const error = catchError(() => onErrorHandler(originalError), ConfigError);
    expect(error.message).toStartWith('Keyv failed to connect to backend');
    expect(error.cause()).toBe(originalError);
  });

  test('Namespace should be "config"', () => {
    Config.initFromEnv();

    expect(Keyv).toHaveBeenCalledWith(expect.anything(), { namespace: 'config' });
  });
});
