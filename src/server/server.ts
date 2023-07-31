import type { FastifyInstance, FastifyPluginCallback, RouteOptions } from 'fastify';
import type { BaseLogger } from 'pino';

import { makeFastify } from '../utilities/fastify/server.js';

import healthcheckRoutes from './routes/healthcheck.routes.js';
import pongRoutes from './routes/pong.routes.js';

const ROUTES: FastifyPluginCallback<RouteOptions>[] = [healthcheckRoutes, pongRoutes];

async function makeServerPlugin(server: FastifyInstance): Promise<void> {
  await Promise.all(ROUTES.map((route) => server.register(route)));
}

export async function makeServer(customLogger?: BaseLogger): Promise<FastifyInstance> {
  return makeFastify(makeServerPlugin, customLogger);
}
