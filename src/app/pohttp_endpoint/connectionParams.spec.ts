import {
  derSerializePublicKey,
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueEndpointCertificate,
  MockPrivateKeyStore,
  PublicNodeConnectionParams,
  SessionKey,
  UnknownKeyError,
} from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import { addDays } from 'date-fns';
import { FastifyInstance, HTTPInjectOptions } from 'fastify';

import { configureMockEnvVars } from '../../testUtils/envVars';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLogging, MockLogSet, partialPinoLog } from '../../testUtils/logging';
import * as vault from '../backingServices/vault';
import {
  ENDPOINT_KEY_ID_BASE64,
  ENDPOINT_SESSION_KEY_ID_BASE64,
  ENV_VARS,
  PUBLIC_ENDPOINT_ADDRESS,
} from './_test_utils';
import { makeServer } from './server';

configureMockEnvVars(ENV_VARS);

const mockPrivateKeyStore = new MockPrivateKeyStore();
mockSpy(jest.spyOn(vault, 'initVaultKeyStore'), () => mockPrivateKeyStore);
beforeEach(() => {
  mockPrivateKeyStore.clear();
});

const identityKeyId = Buffer.from(ENDPOINT_KEY_ID_BASE64, 'base64');
let identityPublicKey: CryptoKey;
beforeEach(async () => {
  const identityKeyPair = await generateRSAKeyPair();
  identityPublicKey = identityKeyPair.publicKey;

  const identityCertificate = await issueEndpointCertificate({
    issuerPrivateKey: identityKeyPair.privateKey,
    subjectPublicKey: identityKeyPair.publicKey,
    validityEndDate: addDays(new Date(), 1),
  });
  // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
  // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
  // tslint:disable-next-line:no-object-mutation
  (identityCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex =
    bufferToArray(identityKeyId);
  await mockPrivateKeyStore.registerNodeKey(identityKeyPair.privateKey, identityCertificate);
});

const initialSessionKeyId = Buffer.from(ENDPOINT_SESSION_KEY_ID_BASE64, 'base64');
let sessionKey: SessionKey;
beforeEach(async () => {
  const sessionKeyPair = await generateECDHKeyPair();
  sessionKey = {
    keyId: initialSessionKeyId,
    publicKey: sessionKeyPair.publicKey,
  };
  await mockPrivateKeyStore.registerInitialSessionKey(
    sessionKeyPair.privateKey,
    initialSessionKeyId,
  );
});

let serverInstance: FastifyInstance;
let mockLogs: MockLogSet;
beforeEach(async () => {
  const mockLogging = makeMockLogging();
  mockLogs = mockLogging.logs;
  serverInstance = await makeServer(mockLogging.logger);
});

describe('GET /connection-params.der', () => {
  const requestOpts: HTTPInjectOptions = {
    method: 'GET',
    url: '/connection-params.der',
  };

  test.each([
    ['identity', identityKeyId],
    ['session', initialSessionKeyId],
  ])('Response code should be 500 if the %s key could not be retrieved', async (_, keyId) => {
    // tslint:disable-next-line:no-delete no-object-mutation
    delete mockPrivateKeyStore.keys[keyId.toString('hex')];

    const response = await serverInstance.inject(requestOpts);

    expect(response.statusCode).toEqual(500);
    expect(response.json()).toEqual({ message: 'Internal server error' });
    expect(mockLogs).toContainEqual(
      partialPinoLog('fatal', 'Could not retrieve keys', {
        err: expect.objectContaining({ type: UnknownKeyError.name }),
      }),
    );
  });

  describe('Success', () => {
    test('Response code should be 200 if it went well', async () => {
      const response = await serverInstance.inject(requestOpts);

      expect(response.statusCode).toEqual(200);
    });

    test('Response content type should be application/vnd.etsi.tsl.der', async () => {
      const response = await serverInstance.inject(requestOpts);

      expect(response.headers).toHaveProperty('content-type', 'application/vnd.etsi.tsl.der');
    });

    test('Public address should match expected value', async () => {
      const response = await serverInstance.inject(requestOpts);

      const params = await deserializeParams(response.rawPayload);
      expect(params.publicAddress).toEqual(PUBLIC_ENDPOINT_ADDRESS);
    });

    test('Identity key should be DER serialization of public key', async () => {
      const response = await serverInstance.inject(requestOpts);

      const params = await deserializeParams(response.rawPayload);
      await expect(derSerializePublicKey(params.identityKey)).resolves.toEqual(
        await derSerializePublicKey(identityPublicKey),
      );
    });

    test('Session key should contain DER serialization of key id', async () => {
      const response = await serverInstance.inject(requestOpts);

      const params = await deserializeParams(response.rawPayload);
      expect(params.sessionKey.keyId).toEqual(sessionKey.keyId);
    });

    test('Session key should contain DER serialization of public key', async () => {
      const response = await serverInstance.inject(requestOpts);

      const params = await deserializeParams(response.rawPayload);
      await expect(derSerializePublicKey(params.sessionKey.publicKey)).resolves.toEqual(
        await derSerializePublicKey(sessionKey.publicKey),
      );
    });

    async function deserializeParams(
      paramsSerialized: Buffer,
    ): Promise<PublicNodeConnectionParams> {
      return PublicNodeConnectionParams.deserialize(bufferToArray(paramsSerialized));
    }
  });
});
