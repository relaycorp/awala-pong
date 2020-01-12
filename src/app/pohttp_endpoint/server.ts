import { get as getEnvVar } from 'env-var';

import { FastifyInstance } from 'fastify';
import routes from './routes';

// I wish I could just do `import * as fastify from 'fastify'` or `import fastify from 'fastify'`
// but neither worked regardless of the values set in esModuleInterop/allowSyntheticDefaultImports
import fastify = require('fastify');

const DEFAULT_REQUEST_ID_HEADER = 'X-Request-Id';
const DEFAULT_PORT = '3000';
const DEFAULT_HOST = '0.0.0.0';

/**
 * Initialize a Fastify server instance.
 *
 * This function doesn't call .listen() so we can use .inject() for testing purposes.
 */
export function makeServer(): FastifyInstance {
  const server = fastify({
    logger: true,
    requestIdHeader: getEnvVar('PONG_REQUEST_ID_HEADER', DEFAULT_REQUEST_ID_HEADER).asString(),
  });

  server.register(routes);

  server.addContentTypeParser(
    'application/vnd.relaynet.parcel',
    { parseAs: 'buffer' },
    async (_req: any, rawBody: Buffer) => rawBody,
  );

  return server;
}

export async function runServer(): Promise<void> {
  const server = makeServer();

  await server.listen({
    host: getEnvVar('PONG_HOST', DEFAULT_HOST).asString(),
    port: getEnvVar('PONG_PORT', DEFAULT_PORT).asIntPositive(),
  });
}
