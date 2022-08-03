import fastifyUrlData from '@fastify/url-data';
import { get as getEnvVar } from 'env-var';
import { fastify, FastifyInstance, FastifyPluginCallback } from 'fastify';
import { Logger } from 'pino';

import { makeLogger } from '../utilities/logging';
import connectionParamsRoutes from './connectionParams';
import parcelDeliveryRoutes from './parcelDelivery';
import RouteOptions from './RouteOptions';

const DEFAULT_REQUEST_ID_HEADER = 'X-Request-Id';
const SERVER_PORT = 8080;
const SERVER_HOST = '0.0.0.0';

const ROUTES: readonly FastifyPluginCallback<RouteOptions>[] = [
  connectionParamsRoutes,
  parcelDeliveryRoutes,
];

/**
 * Initialize a Fastify server instance.
 *
 * This function doesn't call .listen() so we can use .inject() for testing purposes.
 */
export async function makeServer(logger: Logger): Promise<FastifyInstance> {
  const server = fastify({
    logger,
    requestIdHeader: getEnvVar('PONG_REQUEST_ID_HEADER')
      .default(DEFAULT_REQUEST_ID_HEADER)
      .asString(),
  });

  server.register(fastifyUrlData);

  const internetAddress = getEnvVar('PONG_INTERNET_ADDRESS').required().asString();
  ROUTES.forEach((route) => server.register(route, { internetAddress }));

  server.addContentTypeParser(
    'application/vnd.awala.parcel',
    { parseAs: 'buffer' },
    async (_req: any, rawBody: Buffer) => rawBody,
  );

  await server.ready();
  return server;
}

export async function runServer(): Promise<void> {
  const server = await makeServer(makeLogger());

  await server.listen({ host: SERVER_HOST, port: SERVER_PORT });
}
