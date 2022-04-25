import Keyv from 'keyv';

import { Config } from '../app/utilities/config/Config';
import { mockSpy } from './jest';

export function makeInMemoryConfig(): { readonly config: Config; readonly keyv: Keyv } {
  const keyv = new Keyv();

  afterEach(async () => {
    await keyv.clear();
  });

  return { config: new Config(keyv), keyv };
}

export function mockConfigInitFromEnv(config?: Config): void {
  mockSpy(jest.spyOn(Config, 'initFromEnv'), () => config);
}
