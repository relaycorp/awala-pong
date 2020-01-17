/* tslint:disable:no-let */
import axios, { AxiosRequestConfig } from 'axios';
import * as http from 'http';
import * as https from 'https';

import { VaultSessionStore } from './channelSessionKeys';

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
          `${stubVaultUrl}/v1/${stubKvPath}/data/`,
        );
      });

      test('Base URL should be normalized', () => {
        mockAxiosCreate.mockReset();

        // tslint:disable-next-line:no-unused-expression
        new VaultSessionStore(`${stubVaultUrl}/`, stubVaultToken, `/${stubKvPath}/`);

        expect(mockAxiosCreate.mock.calls[0][0]).toHaveProperty(
          'baseURL',
          `${stubVaultUrl}/v1/${stubKvPath}/data/`,
        );
      });

      test('Vault token should be included in the headers', () => {
        expect(axiosCreateCallOptions).toHaveProperty('headers.X-Vault-Token', stubVaultToken);
      });
    });
  });
});
