/* tslint:disable:no-let */
import {
  Certificate,
  derDeserializeRSAPrivateKey,
  EnvelopedData,
  generateECDHKeyPair,
  generateRSAKeyPair,
  issueInitialDHKeyCertificate,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import axios from 'axios';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as getEnvVar } from 'env-var';
import * as fs from 'fs';
import { logDiffOn501, Route, Stubborn } from 'stubborn-ws';

import { generateStubNodeCertificate, generateStubPingParcel } from '../app/_test_utils';
import { serializePing } from '../app/pingSerialization';
import { base64Decode } from '../app/utils';
import { VaultPrivateKeyStore } from '../app/vaultPrivateKeyStore';

const GATEWAY_PORT = 4000;
const GATEWAY_ADDRESS = `http://gateway:${GATEWAY_PORT}/`;
const PONG_SERVICE_ENDPOINT = 'http://app:8080/';

const PONG_ENDPOINT_CERTIFICATE_DER = fs.readFileSync(
  process.cwd() + '/src/functional_tests/endpoint-certificate.der',
);
const PONG_ENDPOINT_PRIVATE_KEY_PEM = getEnvVar('ENDPOINT_PRIVATE_KEY')
  .required()
  .asString();

describe('End-to-end test for successful delivery of ping and pong messages', () => {
  const mockGatewayServer = new Stubborn({ host: '0.0.0.0' });
  beforeAll(async () => mockGatewayServer.start(GATEWAY_PORT));
  afterAll(async () => mockGatewayServer.stop());
  afterEach(() => mockGatewayServer.clear());

  let gatewayEndpointRoute: Route;
  beforeEach(() => {
    gatewayEndpointRoute = mockGatewayServer
      .post('/')
      .setHeader('Content-Type', 'application/vnd.relaynet.parcel')
      .setBody(body => !!body)
      .setResponseStatusCode(202);
    logDiffOn501(mockGatewayServer, gatewayEndpointRoute);
  });

  let pongEndpointCertificate: Certificate;
  let pingSenderPrivateKey: CryptoKey;
  let pingSenderCertificate: Certificate;
  beforeAll(async () => {
    pongEndpointCertificate = Certificate.deserialize(bufferToArray(PONG_ENDPOINT_CERTIFICATE_DER));

    const pingSenderKeyPair = await generateRSAKeyPair();
    pingSenderPrivateKey = pingSenderKeyPair.privateKey;
    pingSenderCertificate = await generateStubNodeCertificate(
      pingSenderKeyPair.publicKey,
      pingSenderPrivateKey,
    );
  });

  beforeAll(async () => {
    // Wait a little longer for backing services to become available
    await sleep(1);

    // tslint:disable-next-line:no-object-mutation
    process.env.POHTTP_TLS_REQUIRED = 'false';
  });

  test('Gateway should receive pong message', async () => {
    const pingParcel = bufferToArray(
      await generateStubPingParcel(PONG_SERVICE_ENDPOINT, pongEndpointCertificate, {
        certificate: pingSenderCertificate,
        privateKey: pingSenderPrivateKey,
      }),
    );

    await deliverParcel(PONG_SERVICE_ENDPOINT, pingParcel, {
      relayAddress: GATEWAY_ADDRESS,
    });

    await sleep(2);
    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    await validatePongDelivery(pingSenderPrivateKey);
  });

  describe('Channel session protocol', () => {
    const vaultClient = axios.create({
      baseURL: 'http://vault:8200/v1',
      headers: { 'X-Vault-Token': 'letmein' },
    });
    beforeAll(async () => {
      await vaultClient.post('/sys/mounts/session-keys', {
        options: { version: '2' },
        type: 'kv',
      });
    });
    afterAll(async () => {
      await vaultClient.delete('/sys/mounts/session-keys');
    });

    const sessionStore = new VaultPrivateKeyStore('http://vault:8200', 'letmein', 'session-keys');
    const endpointInitialSessionKeyPairId = 98765;

    test('Session keys should be used as expected', async () => {
      const endpointInitialSessionKeyPair = await generateECDHKeyPair();
      const endpointInitialSessionCertificate = await issueInitialDHKeyCertificate({
        dhPublicKey: endpointInitialSessionKeyPair.publicKey,
        nodeCertificate: pongEndpointCertificate,
        nodePrivateKey: await getPongEndpointPrivateKey(),
        serialNumber: endpointInitialSessionKeyPairId,
      });
      await sessionStore.saveSessionKey(
        endpointInitialSessionKeyPair.privateKey,
        endpointInitialSessionKeyPairId,
      );

      const { pingParcelSerialized, dhPrivateKey } = await generateSessionPingParcel(
        endpointInitialSessionCertificate,
      );

      await deliverParcel(PONG_SERVICE_ENDPOINT, pingParcelSerialized, {
        relayAddress: GATEWAY_ADDRESS,
      });

      await validatePongDelivery(dhPrivateKey);
    });

    async function generateSessionPingParcel(
      initialDhCertificate: Certificate,
    ): Promise<{
      readonly pingParcelSerialized: Buffer;
      readonly dhPrivateKey: CryptoKey;
    }> {
      const pda = await generateStubNodeCertificate(
        await pongEndpointCertificate.getPublicKey(),
        pingSenderPrivateKey,
        { issuerCertificate: pingSenderCertificate },
      );
      const serviceMessage = new ServiceMessage(
        'application/vnd.relaynet.ping-v1.ping',
        serializePing(pda),
      );
      const { dhPrivateKey, envelopedData } = await SessionEnvelopedData.encrypt(
        serviceMessage.serialize(),
        initialDhCertificate,
      );
      const parcel = new Parcel(
        PONG_SERVICE_ENDPOINT,
        pingSenderCertificate,
        Buffer.from(envelopedData.serialize()),
      );

      return {
        dhPrivateKey,
        pingParcelSerialized: Buffer.from(await parcel.serialize(pingSenderPrivateKey)),
      };
    }
  });

  async function validatePongDelivery(recipientPrivateKey: CryptoKey): Promise<void> {
    // Allow sufficient time for the background job to deliver the message
    await sleep(2);

    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    const pongParcelSerialized = (gatewayEndpointRoute.getCall(0).body as unknown) as Buffer;
    const pongParcel = await Parcel.deserialize(bufferToArray(pongParcelSerialized));
    expect(pongParcel).toHaveProperty('recipientAddress', pingSenderCertificate.getCommonName());
    const pongParcelPayload = EnvelopedData.deserialize(
      bufferToArray(pongParcel.payloadSerialized as Buffer),
    );
    const pongServiceMessageSerialized = await pongParcelPayload.decrypt(recipientPrivateKey);
    const pongServiceMessage = ServiceMessage.deserialize(
      Buffer.from(pongServiceMessageSerialized),
    );
    expect(pongServiceMessage).toHaveProperty('type', 'application/vnd.relaynet.ping-v1.pong');
    expect(pongServiceMessage).toHaveProperty('value.byteLength', 36);
  }
});

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1_000));
}

async function getPongEndpointPrivateKey(): Promise<CryptoKey> {
  const privateKeyBase64 = PONG_ENDPOINT_PRIVATE_KEY_PEM.replace(
    /(-----(BEGIN|END) PRIVATE KEY-----|\\n)/g,
    '',
  );
  const privateKeyDer = base64Decode(privateKeyBase64);
  return derDeserializeRSAPrivateKey(privateKeyDer, {
    hash: { name: 'SHA-256' },
    name: 'RSA-PSS',
  });
}
