import { Certificate } from '@relaycorp/relaynet-core';
import { get as getEnvVar } from 'env-var';
import { FastifyInstance, FastifyReply } from 'fastify';

import { initVaultKeyStore } from '../backingServices/vault';
import { CONTENT_TYPES } from '../utilities/http';
import RouteOptions from './RouteOptions';

export default async function registerRoutes(
  fastify: FastifyInstance,
  _options: RouteOptions,
): Promise<void> {
  const endpointKeyIdBase64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();
  const endpointKeyId = Buffer.from(endpointKeyIdBase64, 'base64');

  const privateKeyStore = initVaultKeyStore();

  fastify.route({
    method: ['GET'],
    url: '/certificates/identity.der',
    async handler(_req, reply): Promise<FastifyReply<any>> {
      let identityCertificate: Certificate;
      identityCertificate = (await privateKeyStore.fetchNodeKey(endpointKeyId)).certificate;
      const certificateSerialized = Buffer.from(identityCertificate.serialize());
      return reply.type(CONTENT_TYPES.DER).send(certificateSerialized);
    },
  });
}
