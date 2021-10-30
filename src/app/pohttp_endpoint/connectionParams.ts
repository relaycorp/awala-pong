import { PublicNodeConnectionParams, UnboundKeyPair } from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';
import { FastifyInstance, FastifyReply } from 'fastify';

import { initVaultKeyStore } from '../backingServices/vault';
import { CONTENT_TYPES } from '../utilities/http';
import RouteOptions from './RouteOptions';

export default async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const identityKeyIdBase64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();
  const identityKeyId = Buffer.from(identityKeyIdBase64, 'base64');
  const sessionKeyIdBase64 = getEnvVar('ENDPOINT_SESSION_KEY_ID').required().asString();
  const sessionKeyId = Buffer.from(sessionKeyIdBase64, 'base64');

  const privateKeyStore = initVaultKeyStore();

  fastify.route({
    method: ['GET'],
    url: '/connection-params.der',
    async handler(req, reply): Promise<FastifyReply<any>> {
      let identityKeyPair: UnboundKeyPair;
      let sessionKey: CryptoKey;
      try {
        identityKeyPair = await privateKeyStore.fetchNodeKey(identityKeyId);
        sessionKey = await privateKeyStore.fetchInitialSessionKey(sessionKeyId);
      } catch (err) {
        req.log.fatal({ err }, 'Could not retrieve keys');
        return reply.code(500).send({ message: 'Internal server error' });
      }

      const params = new PublicNodeConnectionParams(
        options.publicEndpointAddress,
        await identityKeyPair.certificate.getPublicKey(),
        { keyId: sessionKeyId, publicKey: sessionKey },
      );
      return reply.type(CONTENT_TYPES.DER).send(Buffer.from(await params.serialize()));
    },
  });
}
