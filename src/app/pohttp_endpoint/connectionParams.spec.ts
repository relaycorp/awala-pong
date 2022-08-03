import {
  derSerializePublicKey,
  generateRSAKeyPair,
  getIdFromIdentityKey,
  MockPrivateKeyStore,
  PublicNodeConnectionParams,
  SessionKeyPair,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { FastifyInstance, InjectOptions } from 'fastify';
import { Response } from 'light-my-request';
import { PONG_INTERNET_ADDRESS } from '../../testUtils/awala';

import { makeInMemoryConfig, mockConfigInitFromEnv } from '../../testUtils/config';
import { configureMockEnvVars } from '../../testUtils/envVars';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLogging, partialPinoLog } from '../../testUtils/logging';
import * as vault from '../backingServices/vault';
import { ConfigItem } from '../utilities/config/ConfigItem';
import { ENV_VARS } from './_test_utils';
import { makeServer } from './server';

jest.mock('../background_queue/queue');

configureMockEnvVars(ENV_VARS);

const { config: mockConfig, keyv: configKeyv } = makeInMemoryConfig();
mockConfigInitFromEnv(mockConfig);

const mockPrivateKeyStore = new MockPrivateKeyStore();
mockSpy(jest.spyOn(vault, 'initVaultKeyStore'), () => mockPrivateKeyStore);

let identityKeyPair: CryptoKeyPair;
let sessionKeyPair: SessionKeyPair;
beforeAll(async () => {
  identityKeyPair = await generateRSAKeyPair();
  sessionKeyPair = await SessionKeyPair.generate();
});

beforeEach(async () => {
  mockPrivateKeyStore.clear();

  const privateAddress = await getIdFromIdentityKey(identityKeyPair.publicKey);
  await mockPrivateKeyStore.saveIdentityKey(privateAddress, identityKeyPair.privateKey);
  await mockConfig.set(ConfigItem.CURRENT_PRIVATE_ADDRESS, privateAddress);

  await mockPrivateKeyStore.saveSessionKey(
    sessionKeyPair.privateKey,
    sessionKeyPair.sessionKey.keyId,
    privateAddress,
  );
  await mockConfig.set(
    ConfigItem.INITIAL_SESSION_KEY_ID_BASE64,
    sessionKeyPair.sessionKey.keyId.toString('base64'),
  );
});

let serverInstance: FastifyInstance;
const mockLogging = makeMockLogging();
beforeEach(async () => {
  serverInstance = await makeServer(mockLogging.logger);
});

describe('GET', () => {
  const requestOpts: InjectOptions = {
    method: 'GET',
    url: '/connection-params.der',
  };

  describe('Key retrieval errors', () => {
    test('Response code should be 500 if the current private key is unset', async () => {
      await configKeyv.delete(ConfigItem.CURRENT_PRIVATE_ADDRESS);

      const response = await serverInstance.inject(requestOpts);

      expectResponseToBe500(response);
      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('fatal', 'Current identity key is unset'),
      );
    });

    test('Response code should be 500 if the current private key is missing', async () => {
      // tslint:disable-next-line:no-object-mutation
      mockPrivateKeyStore.identityKeys = {};

      const response = await serverInstance.inject(requestOpts);

      expectResponseToBe500(response);
      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('fatal', 'Current identity key is missing', {
          privateAddress: await getIdFromIdentityKey(identityKeyPair.publicKey),
        }),
      );
    });

    test('Response code should be 500 if the current session key is unset', async () => {
      await configKeyv.delete(ConfigItem.INITIAL_SESSION_KEY_ID_BASE64);

      const response = await serverInstance.inject(requestOpts);

      expectResponseToBe500(response);
      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('fatal', 'Current session key is unset'),
      );
    });

    test('Response code should be 500 if the current session key is missing', async () => {
      // tslint:disable-next-line:no-object-mutation
      mockPrivateKeyStore.sessionKeys = {};

      const response = await serverInstance.inject(requestOpts);

      expectResponseToBe500(response);
      expect(mockLogging.logs).toContainEqual(
        partialPinoLog('fatal', 'Current session key is missing', {
          sessionKeyId: sessionKeyPair.sessionKey.keyId.toString('base64'),
          err: expect.objectContaining({ type: UnknownKeyError.name }),
        }),
      );
    });

    function expectResponseToBe500(response: Response): void {
      expect(response.statusCode).toEqual(500);
      expect(response.json()).toEqual({ message: 'Internal server error' });
    }
  });

  test('Response code should be 200 if it went well', async () => {
    const response = await serverInstance.inject(requestOpts);

    expect(response.statusCode).toEqual(200);
  });

  test('Response content type should be application/vnd.etsi.tsl.der', async () => {
    const response = await serverInstance.inject(requestOpts);

    expect(response.headers).toHaveProperty('content-type', 'application/vnd.etsi.tsl.der');
  });

  test('Internet address should match expected value', async () => {
    const response = await serverInstance.inject(requestOpts);

    const params = await deserializeParams(response.rawPayload);
    expect(params.internetAddress).toEqual(PONG_INTERNET_ADDRESS);
  });

  test('Identity key should be DER serialization of public key', async () => {
    const response = await serverInstance.inject(requestOpts);

    const params = await deserializeParams(response.rawPayload);
    await expect(derSerializePublicKey(params.identityKey)).resolves.toEqual(
      await derSerializePublicKey(identityKeyPair.publicKey),
    );
  });

  test('Session key should contain DER serialization of key id', async () => {
    const response = await serverInstance.inject(requestOpts);

    const params = await deserializeParams(response.rawPayload);
    expect(params.sessionKey.keyId).toEqual(sessionKeyPair.sessionKey.keyId);
  });

  test('Session key should contain DER serialization of public key', async () => {
    const response = await serverInstance.inject(requestOpts);

    const params = await deserializeParams(response.rawPayload);
    await expect(derSerializePublicKey(params.sessionKey.publicKey)).resolves.toEqual(
      await derSerializePublicKey(sessionKeyPair.sessionKey.publicKey),
    );
  });

  async function deserializeParams(paramsSerialized: Buffer): Promise<PublicNodeConnectionParams> {
    return PublicNodeConnectionParams.deserialize(bufferToArray(paramsSerialized));
  }
});
