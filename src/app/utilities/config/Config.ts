import { get as getEnvVar } from 'env-var';
import Keyv from 'keyv';

import { ConfigError } from './ConfigError';
import { ConfigItem } from './ConfigItem';

export class Config {
  public static initFromEnv(): Config {
    const keyvURL = getEnvVar('CONFIG_URL').required(true).asString();
    const keyv = new Keyv(keyvURL, { namespace: 'config' });
    keyv.on('error', (err) => {
      throw new ConfigError(err, 'Keyv failed to connect to backend');
    });
    return new Config(keyv);
  }

  constructor(protected readonly keyv: Keyv) {}

  public async set(key: ConfigItem, value: string): Promise<void> {
    await this.keyv.set(key, value);
  }

  public async get(key: ConfigItem): Promise<string | null> {
    const value = await this.keyv.get(key);
    return value ?? null;
  }
}
