/* tslint:disable:max-classes-per-file */
import {
  derDeserializeECDHPrivateKey,
  derSerializePrivateKey,
  derSerializePublicKey,
  RelaynetError,
  SessionStore,
} from '@relaycorp/relaynet-core';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHash } from 'crypto';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { base64Decode, base64Encode } from './utils';

export class VaultStoreError extends RelaynetError {}

export class VaultSessionStore implements SessionStore {
  protected readonly axiosClient: AxiosInstance;

  constructor(vaultUrl: string, vaultToken: string, kvPath: string) {
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

  public async getPrivateKey(
    dhKeyPairId: number,
    recipientPublicKey: CryptoKey,
  ): Promise<CryptoKey> {
    // tslint:disable-next-line
    let response;
    try {
      response = await this.axiosClient.get(`/session-keys/${dhKeyPairId}`);
    } catch (error) {
      throw new VaultStoreError(error, `Failed to retrieve private key ${dhKeyPairId}`);
    }

    if (response.status !== 200) {
      throw new VaultStoreError(
        `Failed to save key ${dhKeyPairId}: Vault returned a ${response.status} response`,
      );
    }

    const vaultSecret = response.data.data;
    const boundRecipientPublicKeyDigest = vaultSecret.data.recipientPublicKeyDigest;
    if (boundRecipientPublicKeyDigest) {
      const recipientPublicKeyDigest = sha256Hex(await derSerializePublicKey(recipientPublicKey));
      if (boundRecipientPublicKeyDigest !== recipientPublicKeyDigest) {
        throw new VaultStoreError(`Key ${dhKeyPairId} belongs to a different session`);
      }
    }
    const privateKeyDer = base64Decode(vaultSecret.data.privateKey);
    return derDeserializeECDHPrivateKey(privateKeyDer);
  }

  /**
   * Save private key `dhPrivateKey` in Vault.
   *
   * @param dhPrivateKey
   * @param dhKeyPairId
   * @param recipientPublicKey If the new DH key pair belong to an existing session; if it is for
   *   an initial session, it must be absent.
   */
  public async savePrivateKey(
    dhPrivateKey: CryptoKey,
    dhKeyPairId: number,
    recipientPublicKey?: CryptoKey,
  ): Promise<void> {
    const recipientPublicKeyDigest = recipientPublicKey
      ? sha256Hex(await derSerializePublicKey(recipientPublicKey))
      : undefined;
    const dhPrivateKeyBase64 = base64Encode(await derSerializePrivateKey(dhPrivateKey));
    const requestBody = { data: { privateKey: dhPrivateKeyBase64, recipientPublicKeyDigest } };
    // tslint:disable-next-line:no-let
    let response: AxiosResponse;
    try {
      response = await this.axiosClient.post(`/session-keys/${dhKeyPairId}`, requestBody);
    } catch (error) {
      throw new VaultStoreError(error, `Failed to save private key ${dhKeyPairId}`);
    }
    if (response.status !== 200 && response.status !== 204) {
      throw new VaultStoreError(
        `Failed to save private key ${dhKeyPairId}: Vault returned a ${response.status} response`,
      );
    }
  }
}

function buildBaseVaultUrl(vaultUrl: string, kvPath: string): string {
  const sanitizedVaultUrl = vaultUrl.replace(/\/+$/, '');
  const sanitizedKvPath = kvPath.replace(/^\/+/, '').replace(/\/+/, '');
  return `${sanitizedVaultUrl}/v1/${sanitizedKvPath}/data`;
}

export function sha256Hex(plaintext: Buffer): string {
  return createHash('sha256')
    .update(plaintext)
    .digest('hex');
}
