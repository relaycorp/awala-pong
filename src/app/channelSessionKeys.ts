import axios, { AxiosInstance } from 'axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

export class VaultSessionStore {
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
}

function buildBaseVaultUrl(vaultUrl: string, kvPath: string): string {
  const sanitizedVaultUrl = vaultUrl.replace(/\/+$/, '');
  const sanitizedKvPath = kvPath.replace(/^\/+/, '').replace(/\/+/, '');
  return `${sanitizedVaultUrl}/v1/${sanitizedKvPath}/data/`;
}
