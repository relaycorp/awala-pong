// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import { SessionKeyPair } from '@relaycorp/relaynet-core';

import { initVaultKeyStore } from '../app/backingServices/vault';
import { Config } from '../app/utilities/config/Config';
import { ConfigItem } from '../app/utilities/config/ConfigItem';

const privateKeyStore = initVaultKeyStore();

async function main(): Promise<void> {
  const config = Config.initFromEnv();
  try {
    const id = await createIdentityKeyIfMissing(config);
    await createInitialSessionKeyIfMissing(id, config);
  } finally {
    config.close();
  }
}

async function createIdentityKeyIfMissing(config: Config): Promise<string> {
  const currentId = await config.get(ConfigItem.CURRENT_ID);
  if (currentId) {
    console.log(`Identity key ${currentId} already exists`);
    return currentId;
  }

  console.log(`Identity key will be created because it doesn't already exist`);

  const { id } = await privateKeyStore.generateIdentityKeyPair();
  await config.set(ConfigItem.CURRENT_ID, id);
  return id;
}

async function createInitialSessionKeyIfMissing(endpointId: string, config: Config): Promise<void> {
  const endpointSessionKeyIdBase64 = await config.get(ConfigItem.INITIAL_SESSION_KEY_ID_BASE64);
  if (endpointSessionKeyIdBase64) {
    console.log(`Session key ${endpointSessionKeyIdBase64} already exists`);
  } else {
    console.log(`Session key will be created because it doesn't already exist`);

    const initialSessionKeyPair = await SessionKeyPair.generate();
    await privateKeyStore.saveSessionKey(
      initialSessionKeyPair.privateKey,
      initialSessionKeyPair.sessionKey.keyId,
      endpointId,
    );
    await config.set(
      ConfigItem.INITIAL_SESSION_KEY_ID_BASE64,
      initialSessionKeyPair.sessionKey.keyId.toString('base64'),
    );
  }
}

main();
