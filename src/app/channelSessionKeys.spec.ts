/* tslint:disable:no-let */
import {
  derSerializePrivateKey,
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
} from '@relaycorp/relaynet-core';
import axios, { AxiosRequestConfig } from 'axios';
import * as http from 'http';
import * as https from 'https';

import { expectBuffersToEqual, expectPromiseToReject, sha256Hex } from './_test_utils';
import { VaultSessionStore, VaultStoreError } from './channelSessionKeys';
import { base64Encode } from './utils';

describe('VaultSessionStore', () => {
  const mockAxiosCreate = jest.spyOn(axios, 'create');
  beforeEach(() => {
    mockAxiosCreate.mockReset();
  });
  afterAll(() => {
    mockAxiosCreate.mockRestore();
  });

  const stubVaultUrl = 'http://localhost:8200';
  const stubKvPath = 'session-keys';
  const stubVaultToken = 'letmein';

  const sessionKeyPairId = 12345;
  let sessionKeyPair: CryptoKeyPair;
  let recipientKeyPair: CryptoKeyPair;
  beforeAll(async () => {
    sessionKeyPair = await generateECDHKeyPair();
    recipientKeyPair = await generateRSAKeyPair();
  });

  describe('constructor', () => {
    describe('Axios client', () => {
      let axiosCreateCallOptions: AxiosRequestConfig;
      beforeAll(() => {
        // tslint:disable-next-line:no-unused-expression
        new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

        expect(mockAxiosCreate).toBeCalledTimes(1);
        axiosCreateCallOptions = mockAxiosCreate.mock.calls[0][0] as AxiosRequestConfig;
      });

      test('Keep alive should be used', () => {
        expect(axiosCreateCallOptions.httpsAgent).toBeInstanceOf(https.Agent);
        expect(axiosCreateCallOptions.httpsAgent).toHaveProperty('keepAlive', true);

        expect(axiosCreateCallOptions.httpAgent).toBeInstanceOf(http.Agent);
        expect(axiosCreateCallOptions.httpAgent).toHaveProperty('keepAlive', true);
      });

      test('A timeout of 3 seconds should be used', () => {
        expect(axiosCreateCallOptions).toHaveProperty('timeout', 3000);
      });

      test('Base URL should include Vault URL and KV path', () => {
        expect(axiosCreateCallOptions).toHaveProperty(
          'baseURL',
          `${stubVaultUrl}/v1/${stubKvPath}/data`,
        );
      });

      test('Base URL should be normalized', () => {
        mockAxiosCreate.mockReset();

        // tslint:disable-next-line:no-unused-expression
        new VaultSessionStore(`${stubVaultUrl}/`, stubVaultToken, `/${stubKvPath}/`);

        expect(mockAxiosCreate.mock.calls[0][0]).toHaveProperty(
          'baseURL',
          `${stubVaultUrl}/v1/${stubKvPath}/data`,
        );
      });

      test('Vault token should be included in the headers', () => {
        expect(axiosCreateCallOptions).toHaveProperty('headers.X-Vault-Token', stubVaultToken);
      });
    });
  });

  describe('savePrivateKey', () => {
    const mockAxiosClient = { post: jest.fn() };
    beforeEach(() => {
      mockAxiosClient.post.mockReset();
      mockAxiosClient.post.mockResolvedValueOnce({ status: 204 });

      // @ts-ignore
      mockAxiosCreate.mockReturnValueOnce(mockAxiosClient);
    });

    test('Endpoint path should include recipient key hash and key id', async () => {
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);
      await store.savePrivateKey(
        sessionKeyPair.privateKey,
        sessionKeyPairId,
        recipientKeyPair.publicKey,
      );

      expect(mockAxiosClient.post).toBeCalledTimes(1);
      const postCallArgs = mockAxiosClient.post.mock.calls[0];
      const recipientPublicKeyDigest = await sha256Hex(
        await derSerializePublicKey(recipientKeyPair.publicKey),
      );
      expect(postCallArgs[0]).toEqual(`/${recipientPublicKeyDigest}/${sessionKeyPairId}`);
    });

    test('Private key should be saved', async () => {
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);
      await store.savePrivateKey(
        sessionKeyPair.privateKey,
        sessionKeyPairId,
        recipientKeyPair.publicKey,
      );

      expect(mockAxiosClient.post).toBeCalledTimes(1);
      const postCallArgs = mockAxiosClient.post.mock.calls[0];
      expect(postCallArgs[1]).toHaveProperty(
        'data.privateKey',
        base64Encode(await derSerializePrivateKey(sessionKeyPair.privateKey)),
      );
    });

    test('Axios errors should be wrapped', async () => {
      mockAxiosClient.post.mockReset();
      mockAxiosClient.post.mockRejectedValueOnce(new Error('Denied'));
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await expectPromiseToReject(
        store.savePrivateKey(
          sessionKeyPair.privateKey,
          sessionKeyPairId,
          recipientKeyPair.publicKey,
        ),
        new VaultStoreError(`Failed to save private key ${sessionKeyPairId}: Denied`),
      );
    });

    test('A 200 OK response should be treated as success', async () => {
      mockAxiosClient.post.mockReset();
      mockAxiosClient.post.mockResolvedValueOnce({ status: 200 });
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await store.savePrivateKey(
        sessionKeyPair.privateKey,
        sessionKeyPairId,
        recipientKeyPair.publicKey,
      );
    });

    test('A 204 No Content response should be treated as success', async () => {
      mockAxiosClient.post.mockReset();
      mockAxiosClient.post.mockResolvedValueOnce({ status: 204 });
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await store.savePrivateKey(
        sessionKeyPair.privateKey,
        sessionKeyPairId,
        recipientKeyPair.publicKey,
      );
    });

    test('A non-200/204 response should raise an error', async () => {
      mockAxiosClient.post.mockReset();
      mockAxiosClient.post.mockResolvedValueOnce({ status: 400 });
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await expectPromiseToReject(
        store.savePrivateKey(
          sessionKeyPair.privateKey,
          sessionKeyPairId,
          recipientKeyPair.publicKey,
        ),
        new VaultStoreError(
          `Failed to save private key ${sessionKeyPairId}: Vault returned a 400 response`,
        ),
      );
    });
  });

  describe('getPrivateKey', () => {
    const mockAxiosClient = { get: jest.fn() };
    beforeEach(async () => {
      mockAxiosClient.get.mockReset();
      mockAxiosClient.get.mockResolvedValueOnce({
        data: {
          data: {
            data: {
              privateKey: base64Encode(await derSerializePrivateKey(sessionKeyPair.privateKey)),
            },
          },
        },
        status: 200,
      });

      // @ts-ignore
      mockAxiosCreate.mockReturnValueOnce(mockAxiosClient);
    });

    test('Private key should be returned decoded', async () => {
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);
      const privateKey = await store.getPrivateKey(sessionKeyPairId, recipientKeyPair.publicKey);

      expectBuffersToEqual(
        await derSerializePrivateKey(privateKey),
        await derSerializePrivateKey(sessionKeyPair.privateKey),
      );
    });

    test('Endpoint path should include recipient key hash and key id', async () => {
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);
      await store.getPrivateKey(sessionKeyPairId, recipientKeyPair.publicKey);

      expect(mockAxiosClient.get).toBeCalledTimes(1);
      const getCallArgs = mockAxiosClient.get.mock.calls[0];
      const recipientPublicKeyDigest = await sha256Hex(
        await derSerializePublicKey(recipientKeyPair.publicKey),
      );
      expect(getCallArgs[0]).toEqual(`/${recipientPublicKeyDigest}/${sessionKeyPairId}`);
    });

    test('Axios errors should be wrapped', async () => {
      mockAxiosClient.get.mockReset();
      mockAxiosClient.get.mockRejectedValueOnce(new Error('Denied'));
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await expectPromiseToReject(
        store.getPrivateKey(sessionKeyPairId, recipientKeyPair.publicKey),
        new VaultStoreError(`Failed to retrieve private key ${sessionKeyPairId}: Denied`),
      );
    });

    test('A non-200 response should raise an error', async () => {
      mockAxiosClient.get.mockReset();
      mockAxiosClient.get.mockResolvedValueOnce({ status: 204 });
      const store = new VaultSessionStore(stubVaultUrl, stubVaultToken, stubKvPath);

      await expectPromiseToReject(
        store.getPrivateKey(sessionKeyPairId, recipientKeyPair.publicKey),
        new VaultStoreError(
          `Failed to save key ${sessionKeyPairId}: Vault returned a 204 response`,
        ),
      );
    });
  });
});
