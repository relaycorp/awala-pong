import BullQueue = require('bull');
import { get as getEnvVar } from 'env-var';

const DEFAULT_REDIS_PORT = 6379;

export function initQueue(): BullQueue.Queue {
  getEnvVar('ENDPOINT_PRIVATE_KEY').required();

  const redisHost = getEnvVar('REDIS_HOST')
    .required()
    .asString();
  const redisPort = getEnvVar('REDIS_PORT', DEFAULT_REDIS_PORT.toString()).asInt();
  return new BullQueue('pong', { redis: { host: redisHost, port: redisPort } });
}
