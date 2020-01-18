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
  }

  public async getPrivateKey(
    dhKeyPairId: number,
    recipientPublicKey: CryptoKey,
  ): Promise<CryptoKey> {
    const vaultEndpointPath = await buildKeyEndpointPath(dhKeyPairId, recipientPublicKey);
    // tslint:disable-next-line
    let response;
    try {
      response = await this.axiosClient.get(vaultEndpointPath);
    } catch (error) {
      throw new VaultStoreError(error, `Failed to retrieve private key ${dhKeyPairId}`);
    }

    if (response.status !== 200) {
      throw new VaultStoreError(
        `Failed to save key ${dhKeyPairId}: Vault returned a ${response.status} response`,
      );
    }

    const privateKeyDer = base64Decode(response.data.data.privateKey);
    return derDeserializeECDHPrivateKey(privateKeyDer, {
      name: 'ECDH',
      namedCurve: 'P-256',
    });
  }

  public async savePrivateKey(
    dhPrivateKey: CryptoKey,
    dhKeyPairId: number,
    recipientPublicKey: CryptoKey,
  ): Promise<void> {
    const vaultEndpointPath = await buildKeyEndpointPath(dhKeyPairId, recipientPublicKey);
    const dhPrivateKeyBase64 = base64Encode(await derSerializePrivateKey(dhPrivateKey));
    const requestBody = { data: { privateKey: dhPrivateKeyBase64 } };
    // tslint:disable-next-line:no-let
    let response: AxiosResponse;
    try {
      response = await this.axiosClient.post(vaultEndpointPath, requestBody);
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

async function buildKeyEndpointPath(
  dhKeyPairId: number,
  recipientPublicKey: CryptoKey,
): Promise<string> {
  const recipientPublicKeyDigest = sha256Hex(await derSerializePublicKey(recipientPublicKey));
  return `/${recipientPublicKeyDigest}/${dhKeyPairId}`;
}

export function sha256Hex(plaintext: Buffer): string {
  return createHash('sha256')
    .update(plaintext)
    .digest('hex');
}
