import { Certificate, MockPrivateKeyStore } from '@relaycorp/relaynet-core';
import { generateNodeKeyPairSet, generatePDACertificationPath } from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { FastifyInstance, HTTPInjectOptions } from 'fastify';

import { configureMockEnvVars } from '../../testUtils/envVars';
import { mockSpy } from '../../testUtils/jest';
import { makeMockLogging } from '../../testUtils/logging';
import * as vault from '../backingServices/vault';
import { ENDPOINT_KEY_ID_BASE64, ENV_VARS } from './_test_utils';
import { makeServer } from './server';

jest.mock('../background_queue/queue');

configureMockEnvVars(ENV_VARS);

const mockPrivateKeyStore = new MockPrivateKeyStore();
mockSpy(jest.spyOn(vault, 'initVaultKeyStore'), () => mockPrivateKeyStore);

let identityCertificate: Certificate;
beforeEach(async () => {
  const keyPairSet = await generateNodeKeyPairSet();
  const certPath = await generatePDACertificationPath(keyPairSet);
  identityCertificate = certPath.pdaGrantee;
  const endpointKeyId = Buffer.from(ENDPOINT_KEY_ID_BASE64, 'base64');
  // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
  // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
  // tslint:disable-next-line:no-object-mutation
  (identityCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex =
    bufferToArray(endpointKeyId);
  await mockPrivateKeyStore.registerNodeKey(keyPairSet.pdaGrantee.privateKey, identityCertificate);
});

let serverInstance: FastifyInstance;
beforeEach(async () => {
  const mockLogging = makeMockLogging();
  serverInstance = await makeServer(mockLogging.logger);
});

describe('identity certificate retrieval', () => {
  const requestOpts: HTTPInjectOptions = {
    method: 'GET',
    url: '/certificates/identity.der',
  };

  test('Response code should be 200 OK if it went well', async () => {
    const response = await serverInstance.inject(requestOpts);

    expect(response.statusCode).toEqual(200);
  });

  test('Identity certificate should be returned DER-encoded', async () => {
    const response = await serverInstance.inject(requestOpts);

    const certificate = Certificate.deserialize(bufferToArray(response.rawPayload));
    expect(certificate.isEqual(identityCertificate)).toBeTrue();
  });

  test('Response content type should be application/vnd.etsi.tsl.der', async () => {
    const response = await serverInstance.inject(requestOpts);

    expect(response.headers).toHaveProperty('content-type', 'application/vnd.etsi.tsl.der');
  });

  test('Failure to retrieve certificate should be handled gracefully', async () => {
    mockPrivateKeyStore.clear();

    const response = await serverInstance.inject(requestOpts);

    expect(response.statusCode).toEqual(500);
  });
});
