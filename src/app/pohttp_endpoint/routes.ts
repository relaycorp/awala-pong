import { Parcel } from '@relaycorp/relaynet-core';
import { FastifyInstance, FastifyReply } from 'fastify';

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
    async handler(request, reply): Promise<FastifyReply<any>> {
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

      // tslint:disable-next-line:no-let
      let parcel;
      try {
        parcel = await Parcel.deserialize(request.body);
      } catch (error) {
        return reply.code(400).send({ message: 'Payload is not a valid RAMF-serialized parcel' });
      }

      const urlData = request.urlData();
      const endpointInternetAddress = `https://${urlData.host}${urlData.path}`;
      if (parcel.recipientAddress !== endpointInternetAddress) {
        return reply.code(400).send({ message: 'Invalid parcel recipient' });
      }

      return reply.code(202).send({});
    },
  });
}

function validateGatewayAddress(gatewayAddress: string): void {
  const urlParsed = new URL(gatewayAddress);
  if (urlParsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol ${urlParsed.protocol}`);
  }
}
