import { Parcel, Recipient } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as getEnvVar } from 'env-var';
import { FastifyInstance, FastifyReply, Logger } from 'fastify';

import { initQueue } from '../background_queue/queue';
import { QueuedPing } from '../background_queue/QueuedPing';
import { initVaultKeyStore } from '../backingServices/vault';
import { base64Encode } from '../utilities/base64';
import RouteOptions from './RouteOptions';

export default async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const pongQueue = initQueue();

  fastify.route({
    method: ['PUT', 'DELETE', 'PATCH'],
    url: '/',
    async handler(_req, reply): Promise<void> {
      reply.code(405).header('Allow', 'HEAD, GET, POST').send();
    },
  });

  fastify.route({
    method: ['HEAD', 'GET'],
    url: '/',
    async handler(req, reply): Promise<FastifyReply<any>> {
      try {
        await pongQueue.isReady();
      } catch (err) {
        req.log.info({ err }, 'Failed to check that the queue is ready');
        return reply
          .code(503)
          .header('Content-Type', 'text/plain')
          .send('This PoHTTP endpoint for the pong service is currently unavailable.');
      }

      return reply
        .code(200)
        .header('Content-Type', 'text/plain')
        .send('Success! This PoHTTP endpoint for the pong service works.');
    },
  });

  fastify.route({
    method: 'POST',
    url: '/',
    async handler(request, reply): Promise<FastifyReply<any>> {
      if (request.headers['content-type'] !== 'application/vnd.awala.parcel') {
        return reply.code(415).send();
      }

      const requireTlsUrls = getEnvVar('POHTTP_TLS_REQUIRED').default('true').asBool();

      const gatewayAddress = request.headers['x-awala-gateway'] || '';
      if (!isValidGatewayAddress(gatewayAddress, requireTlsUrls)) {
        return reply
          .code(400)
          .send({ message: 'X-Awala-Gateway should be set to a valid PoHTTP endpoint' });
      }

      let parcel;
      try {
        parcel = await Parcel.deserialize(bufferToArray(request.body));
      } catch (error) {
        return reply.code(403).send({ message: 'Payload is not a valid RAMF-serialized parcel' });
      }
      try {
        await parcel.validate();
      } catch (_) {
        return reply.code(403).send({ message: 'Parcel is well-formed but invalid' });
      }

      if (!(await isPrivateAddressValid(parcel.recipient, request.log))) {
        return reply.code(202).send({});
      }

      if (!isInternetAddressValid(parcel.recipient, options.internetAddress, request.log)) {
        return reply.code(403).send({ message: 'Invalid parcel recipient' });
      }

      const queueMessage: QueuedPing = { gatewayAddress, parcel: base64Encode(request.body) };
      try {
        await pongQueue.add(queueMessage);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to queue ping message');
        return reply.code(500).send({ message: 'Could not queue ping message for processing' });
      }
      return reply.code(202).send({});
    },
  });
}

function isValidGatewayAddress(gatewayAddress: string, requireTlsUrls: boolean): boolean {
  let urlParsed;
  try {
    urlParsed = new URL(gatewayAddress);
  } catch (_error) {
    return false;
  }
  return urlParsed.protocol === 'https:' || (!requireTlsUrls && urlParsed.protocol === 'http:');
}

async function isPrivateAddressValid(recipient: Recipient, log: Logger): Promise<boolean> {
  const privateKeyStore = initVaultKeyStore();
  const keyExists = await privateKeyStore.retrieveIdentityKey(recipient.id);
  if (!keyExists) {
    log.info({ recipient }, 'Parcel is bound for recipient with different private address');
  }
  return !!keyExists;
}

function isInternetAddressValid(
  recipient: Recipient,
  publicEndpointAddress: string,
  logger: Logger,
): boolean {
  const isValid = recipient.internetAddress === publicEndpointAddress;
  if (!isValid) {
    logger.info({ recipient }, 'Parcel is bound for recipient with different Internet address');
  }
  return isValid;
}
