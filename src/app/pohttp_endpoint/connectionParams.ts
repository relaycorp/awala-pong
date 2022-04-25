import {
  getRSAPublicKeyFromPrivate,
  PrivateKeyStore,
  PublicNodeConnectionParams,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { FastifyInstance, FastifyReply, Logger } from 'fastify';

import { initVaultKeyStore } from '../backingServices/vault';
import { Config } from '../utilities/config/Config';
import { ConfigItem } from '../utilities/config/ConfigItem';
import { CONTENT_TYPES } from '../utilities/http';
import RouteOptions from './RouteOptions';

export default async function registerRoutes(
  fastify: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const privateKeyStore = initVaultKeyStore();
  const config = Config.initFromEnv();

  fastify.route({
    method: ['GET'],
    url: '/connection-params.der',
    async handler(req, reply): Promise<FastifyReply<any>> {
      const identityPublicKey = await retrieveIdentityPublicKey(config, privateKeyStore, req.log);
      const sessionKey = await retrieveSessionKey(config, privateKeyStore, req.log);
      if (!identityPublicKey || !sessionKey) {
        return reply.code(500).send({ message: 'Internal server error' });
      }

      const params = new PublicNodeConnectionParams(
        options.publicEndpointAddress,
        identityPublicKey,
        sessionKey,
      );
      return reply.type(CONTENT_TYPES.DER).send(Buffer.from(await params.serialize()));
    },
  });
}

async function retrieveIdentityPublicKey(
  config: Config,
  privateKeyStore: PrivateKeyStore,
  logger: Logger,
): Promise<CryptoKey | null> {
  const privateAddress = await config.get(ConfigItem.CURRENT_PRIVATE_ADDRESS);
  if (!privateAddress) {
    logger.fatal('Current identity key is unset');
    return null;
  }
  const privateKey = await privateKeyStore.retrieveIdentityKey(privateAddress);
  if (!privateKey) {
    logger.fatal({ privateAddress }, 'Current identity key is missing');
    return null;
  }
  return getRSAPublicKeyFromPrivate(privateKey);
}

async function retrieveSessionKey(
  config: Config,
  privateKeyStore: PrivateKeyStore,
  logger: Logger,
): Promise<SessionKey | null> {
  const keyIdBase64 = await config.get(ConfigItem.INITIAL_SESSION_KEY_ID_BASE64);
  if (!keyIdBase64) {
    logger.fatal('Current session key is unset');
    return null;
  }
  const keyId = Buffer.from(keyIdBase64, 'base64');
  let privateKey: CryptoKey;
  try {
    privateKey = await privateKeyStore.retrieveUnboundSessionKey(keyId);
  } catch (err) {
    logger.fatal({ err, sessionKeyId: keyIdBase64 }, 'Current session key is missing');
    return null;
  }
  return { keyId, publicKey: privateKey };
}
