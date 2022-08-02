import { PONG_ENDPOINT_INTERNET_ADDRESS } from '../../testUtils/awala';

export const ENV_VARS = {
  PUBLIC_ENDPOINT_ADDRESS: PONG_ENDPOINT_INTERNET_ADDRESS,
  REDIS_HOST: 'redis.com',
  VAULT_KV_PREFIX: 'pong-keys',
  VAULT_TOKEN: 'root',
  VAULT_URL: 'http://vault.local:8200',
};
