// tslint:disable:no-console

// tslint:disable-next-line:no-var-requires no-console
require('make-promises-safe');

import {
  generateRSAKeyPair,
  getPrivateAddressFromIdentityKey,
  SessionKeyPair,
} from '@relaycorp/relaynet-core';
import { initVaultKeyStore } from '../app/backingServices/vault';
import { Config } from '../app/utilities/config/Config';
import { ConfigItem } from '../app/utilities/config/ConfigItem';

const privateKeyStore = initVaultKeyStore();

async function main(): Promise<void> {
  const config = Config.initFromEnv();
  try {
    await createIdentityKeyIfMissing(config);
    await createInitialSessionKeyIfMissing(config);
  } finally {
    config.close();
  }
}

async function createIdentityKeyIfMissing(config: Config): Promise<void> {
  const currentPrivateAddress = await config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS);
  if (currentPrivateAddress) {
    console.log(`Identity key ${currentPrivateAddress} already exists`);
  } else {
    console.log(`Identity key will be created because it doesn't already exist`);

    const endpointKeyPair = await generateRSAKeyPair();
    await privateKeyStore.saveIdentityKey(endpointKeyPair.privateKey);
    await config.set(
      ConfigItem.CURRENT_PRIVATE_ADDRESS,
      await getPrivateAddressFromIdentityKey(endpointKeyPair.publicKey),
    );
  }
}

async function createInitialSessionKeyIfMissing(config: Config): Promise<void> {
  const endpointSessionKeyIdBase64 = await config.get(ConfigItem.INITIAL_SESSION_KEY_ID_BASE64);
  if (endpointSessionKeyIdBase64) {
    console.log(`Session key ${endpointSessionKeyIdBase64} already exists`);
  } else {
    console.log(`Session key will be created because it doesn't already exist`);

    const initialSessionKeyPair = await SessionKeyPair.generate();
    await privateKeyStore.saveUnboundSessionKey(
      initialSessionKeyPair.privateKey,
      initialSessionKeyPair.sessionKey.keyId,
    );
    await config.set(
      ConfigItem.INITIAL_SESSION_KEY_ID_BASE64,
      initialSessionKeyPair.sessionKey.keyId.toString('base64'),
    );
  }
}

main();
