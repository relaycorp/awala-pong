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
    const privateAddress = await createIdentityKeyIfMissing(config);
    await createInitialSessionKeyIfMissing(privateAddress, config);
  } finally {
    config.close();
  }
}

async function createIdentityKeyIfMissing(config: Config): Promise<string> {
  const currentPrivateAddress = await config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS);
  if (currentPrivateAddress) {
    console.log(`Identity key ${currentPrivateAddress} already exists`);
    return currentPrivateAddress;
  }

  console.log(`Identity key will be created because it doesn't already exist`);

  const { id } = await privateKeyStore.generateIdentityKeyPair();
  await config.set(ConfigItem.CURRENT_PRIVATE_ADDRESS, id);
  return id;
}

async function createInitialSessionKeyIfMissing(
  privateAddress: string,
  config: Config,
): Promise<void> {
  const endpointSessionKeyIdBase64 = await config.get(ConfigItem.INITIAL_SESSION_KEY_ID_BASE64);
  if (endpointSessionKeyIdBase64) {
    console.log(`Session key ${endpointSessionKeyIdBase64} already exists`);
  } else {
    console.log(`Session key will be created because it doesn't already exist`);

    const initialSessionKeyPair = await SessionKeyPair.generate();
    await privateKeyStore.saveSessionKey(
      initialSessionKeyPair.privateKey,
      initialSessionKeyPair.sessionKey.keyId,
      privateAddress,
    );
    await config.set(
      ConfigItem.INITIAL_SESSION_KEY_ID_BASE64,
      initialSessionKeyPair.sessionKey.keyId.toString('base64'),
    );
  }
}

main();
