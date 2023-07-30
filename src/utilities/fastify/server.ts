import {
  fastify,
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyPluginCallback,
} from 'fastify';
import env from 'env-var';
import type { BaseLogger } from 'pino';

import { makeLogger } from '../logging.js';
import { configureExitHandling } from '../exitHandling.js';

const SERVER_PORT = 8080;
const SERVER_HOST = '0.0.0.0';

const DEFAULT_REQUEST_ID_HEADER = 'X-Request-Id';

export async function makeFastify(
  appPlugin: FastifyPluginAsync | FastifyPluginCallback,
  customLogger?: BaseLogger,
) {
  const logger = customLogger ?? makeLogger();
  configureExitHandling(logger);

  const server = fastify({
    logger,

    requestIdHeader: env
      .get('REQUEST_ID_HEADER')
      .default(DEFAULT_REQUEST_ID_HEADER)
      .asString()
      .toLowerCase(),

    trustProxy: true,
  });

  await server.register(appPlugin);

  await server.ready();

  return server;
}

export async function runFastify(fastifyInstance: FastifyInstance): Promise<void> {
  await fastifyInstance.listen({ host: SERVER_HOST, port: SERVER_PORT });
}
