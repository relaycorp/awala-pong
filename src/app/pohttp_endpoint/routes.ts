import { Parcel } from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { initQueue } from '../background_queue/queue';
import { QueuedPing } from '../background_queue/QueuedPing';
import { base64Encode } from '../utils';

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

  const pongQueue = initQueue();
  fastify.route({
    method: 'POST',
    url: '/',
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== 'application/vnd.relaynet.parcel') {
        return reply.code(415).send();
      }

      const requireTlsUrls = getEnvVar('POHTTP_TLS_REQUIRED', 'true').asBool();

      const gatewayAddress = request.headers['x-relaynet-gateway'] || '';
      if (!isValidGatewayAddress(gatewayAddress, requireTlsUrls)) {
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
      if (!isParcelRecipientValid(parcel.recipientAddress, request, requireTlsUrls)) {
        return reply.code(400).send({ message: 'Invalid parcel recipient' });
      }

      const queueMessage: QueuedPing = {
        gatewayAddress,
        parcelId: parcel.id,
        parcelPayload: base64Encode(parcel.payloadSerialized),
        parcelSenderCertificate: base64Encode(parcel.senderCertificate.serialize()),
      };
      try {
        await pongQueue.add(queueMessage);
      } catch (error) {
        request.log.error('Failed to queue ping message', { err: error });
        return reply.code(500).send({ message: 'Could not queue ping message for processing' });
      }
      return reply.code(202).send({});
    },
  });
}

function isValidGatewayAddress(gatewayAddress: string, requireTlsUrls: boolean): boolean {
  // tslint:disable-next-line:no-let
  let urlParsed;
  try {
    urlParsed = new URL(gatewayAddress);
  } catch (_error) {
    return false;
  }
  return urlParsed.protocol === 'https:' || (!requireTlsUrls && urlParsed.protocol === 'http:');
}

function isParcelRecipientValid(
  parcelRecipient: string,
  request: FastifyRequest<any, any, any, any, any>,
  requireTlsUrls: boolean,
): boolean {
  const urlData = request.urlData();
  if (parcelRecipient === `https://${request.headers.host}${urlData.path}`) {
    return true;
  }
  return !requireTlsUrls && parcelRecipient === `http://${request.headers.host}${urlData.path}`;
}
