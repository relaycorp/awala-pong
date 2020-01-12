import { FastifyInstance } from 'fastify';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: any,
): Promise<void> {
  fastify.route({
    method: ['HEAD', 'PUT', 'DELETE', 'PATCH', 'GET'],
    url: '/',
    async handler(_req, reply): Promise<void> {
      reply
        .code(405)
        .header('Allow', 'POST')
        .send();
    },
  });

  fastify.route({
    method: 'POST',
    url: '/',
    async handler(request, reply): Promise<any> {
      if (request.headers['content-type'] !== 'application/vnd.relaynet.parcel') {
        return reply.code(415).send();
      }

      const gatewayAddress = request.headers['x-relaynet-gateway'] || '';
      try {
        validateGatewayAddress(gatewayAddress);
      } catch (error) {
        return reply
          .code(400)
          .send({ message: 'X-Relaynet-Gateway should be set to a valid PoHTTP endpoint' });
      }

      return {};
    },
  });
}

function validateGatewayAddress(gatewayAddress: string): void {
  const urlParsed = new URL(gatewayAddress);
  if (urlParsed.protocol !== 'rng+https') {
    throw new Error(`Invalid protocol ${urlParsed.protocol}`);
  }
}
