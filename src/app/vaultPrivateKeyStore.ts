/* tslint:disable:max-classes-per-file */
import { PrivateKeyData, PrivateKeyStore, RelaynetError } from '@relaycorp/relaynet-core';
import axios, { AxiosInstance } from 'axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { base64Decode, base64Encode } from './utils';

class VaultStoreError extends RelaynetError {}

export class VaultPrivateKeyStore extends PrivateKeyStore {
  protected readonly axiosClient: AxiosInstance;

  constructor(vaultUrl: string, vaultToken: string, kvPath: string) {
    super();

    const baseURL = buildBaseVaultUrl(vaultUrl, kvPath);
    this.axiosClient = axios.create({
      baseURL,
      headers: { 'X-Vault-Token': vaultToken },
      httpAgent: new HttpAgent({ keepAlive: true }),
      httpsAgent: new HttpsAgent({ keepAlive: true }),
      timeout: 3000,
    });

    // Sanitize errors to avoid leaking sensitive data, which apparently is a feature:
    // https://github.com/axios/axios/issues/2602
    this.axiosClient.interceptors.response.use(undefined, async error =>
      Promise.reject(new Error(error.message)),
    );
  }

  protected async saveKey(privateKeyData: PrivateKeyData, dhKeyPairId: string): Promise<void> {
    const dhPrivateKeyBase64 = base64Encode(privateKeyData.keyDer);
    const requestBody = {
      data: {
        privateKey: dhPrivateKeyBase64,
        recipientPublicKeyDigest: privateKeyData.recipientPublicKeyDigest,
        type: privateKeyData.type,
      },
    };
    const response = await this.axiosClient.post(`/${dhKeyPairId}`, requestBody);
    if (response.status !== 200 && response.status !== 204) {
      throw new VaultStoreError(`Vault returned a ${response.status} response`);
    }
  }

  protected async fetchKey(keyId: string): Promise<PrivateKeyData> {
    const response = await this.axiosClient.get(`/${keyId}`);

    if (response.status !== 200) {
      throw new VaultStoreError(`Vault returned a ${response.status} response`);
    }

    const vaultSecret = response.data.data;
    const privateKeyDer = base64Decode(vaultSecret.data.privateKey);
    return {
      keyDer: privateKeyDer,
      recipientPublicKeyDigest: vaultSecret.data.recipientPublicKeyDigest,
      type: vaultSecret.data.type,
    };
  }
}

function buildBaseVaultUrl(vaultUrl: string, kvPath: string): string {
  const sanitizedVaultUrl = vaultUrl.replace(/\/+$/, '');
  const sanitizedKvPath = kvPath.replace(/^\/+/, '').replace(/\/+/, '');
  return `${sanitizedVaultUrl}/v1/${sanitizedKvPath}/data`;
}
