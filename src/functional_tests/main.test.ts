import { VaultPrivateKeyStore } from '@relaycorp/keystore-vault';
import {
  Certificate,
  EnvelopedData,
  generateECDHKeyPair,
  issueEndpointCertificate,
  Parcel,
  ServiceMessage,
  SessionEnvelopedData,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  NodeKeyPairSet,
  PDACertPath,
} from '@relaycorp/relaynet-testing';
import axios from 'axios';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as getEnvVar } from 'env-var';
import { logDiffOn501, Route, Stubborn } from 'stubborn-ws';

import { serializePing } from '../app/pingSerialization';
import { generatePingParcel, generateStubNodeCertificate } from '../testUtils/awala';

const GATEWAY_PORT = 4000;
const GATEWAY_ADDRESS = `http://gateway:${GATEWAY_PORT}/`;

const PONG_PUBLIC_ADDRESS = 'endpoint.local';
const PONG_SERVICE_URL = 'http://app:8080/';

const PONG_ENDPOINT_KEY_ID_BASE64 = getEnvVar('ENDPOINT_KEY_ID').required().asString();
const PONG_ENDPOINT_SESSION_KEY_ID_BASE64 = getEnvVar('ENDPOINT_SESSION_KEY_ID')
  .required()
  .asString();
const PONG_ENDPOINT_SESSION_KEY_ID = Buffer.from(PONG_ENDPOINT_SESSION_KEY_ID_BASE64, 'base64');

const privateKeyStore = new VaultPrivateKeyStore('http://vault:8200', 'root', 'pong-keys');

describe('End-to-end test for successful delivery of ping and pong messages', () => {
  const mockGatewayServer = new Stubborn({ host: '0.0.0.0' });
  let gatewayEndpointRoute: Route;

  configureMockGatewayServer();

  beforeAll(async () => {
    // Wait a little longer for backing services to become available
    await sleep(1);

    // tslint:disable-next-line:no-object-mutation
    process.env.POHTTP_TLS_REQUIRED = 'false';
  });

  configureVault();

  let keyPairSet: NodeKeyPairSet;
  let certificatePath: PDACertPath;
  let pongEndpointCertificate: Certificate;
  beforeAll(async () => {
    keyPairSet = await generateNodeKeyPairSet();
    certificatePath = await generatePDACertificationPath(keyPairSet);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    pongEndpointCertificate = await issueEndpointCertificate({
      issuerPrivateKey: keyPairSet.pdaGrantee.privateKey,
      subjectPublicKey: keyPairSet.pdaGrantee.publicKey,
      validityEndDate: tomorrow,
    });
    // Force the certificate to have the serial number specified in ENDPOINT_KEY_ID. This nasty
    // hack won't be necessary once https://github.com/relaycorp/relaynet-pong/issues/26 is done.
    // tslint:disable-next-line:no-object-mutation
    (pongEndpointCertificate as any).pkijsCertificate.serialNumber.valueBlock.valueHex =
      bufferToArray(Buffer.from(PONG_ENDPOINT_KEY_ID_BASE64, 'base64'));
    await privateKeyStore.saveNodeKey(keyPairSet.pdaGrantee.privateKey, pongEndpointCertificate);
  });

  test('Ping-pong without channel session protocol', async () => {
    const pingParcel = bufferToArray(
      await generatePingParcel(
        `http://${PONG_PUBLIC_ADDRESS}`,
        pongEndpointCertificate,
        keyPairSet,
        certificatePath,
      ),
    );

    await deliverParcel(PONG_SERVICE_URL, pingParcel, {
      gatewayAddress: GATEWAY_ADDRESS,
    });

    await sleep(2);
    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    await validatePongDelivery(keyPairSet.privateEndpoint.privateKey);
  });

  test('Ping pong with channel session protocol', async () => {
    const endpointInitialSessionKeyPair = await generateECDHKeyPair();
    await privateKeyStore.saveInitialSessionKey(
      endpointInitialSessionKeyPair.privateKey,
      PONG_ENDPOINT_SESSION_KEY_ID,
    );

    const { pingParcelSerialized, dhPrivateKey } = await generateSessionPingParcel({
      keyId: PONG_ENDPOINT_SESSION_KEY_ID,
      publicKey: endpointInitialSessionKeyPair.publicKey,
    });

    await deliverParcel(PONG_SERVICE_URL, pingParcelSerialized, {
      gatewayAddress: GATEWAY_ADDRESS,
    });

    await validatePongDelivery(dhPrivateKey);
  });

  async function generateSessionPingParcel(initialSessionKey: SessionKey): Promise<{
    readonly pingParcelSerialized: Buffer;
    readonly dhPrivateKey: CryptoKey;
  }> {
    const pda = await generateStubNodeCertificate(
      await pongEndpointCertificate.getPublicKey(),
      keyPairSet.privateEndpoint.privateKey,
      { issuerCertificate: certificatePath.privateEndpoint },
    );
    const serviceMessage = new ServiceMessage(
      'application/vnd.awala.ping-v1.ping',
      serializePing(pda, [certificatePath.privateEndpoint, certificatePath.privateGateway]),
    );
    const { dhPrivateKey, envelopedData } = await SessionEnvelopedData.encrypt(
      serviceMessage.serialize(),
      initialSessionKey,
    );
    const parcel = new Parcel(
      `https://${PONG_PUBLIC_ADDRESS}`,
      certificatePath.privateEndpoint,
      Buffer.from(envelopedData.serialize()),
    );

    return {
      dhPrivateKey,
      pingParcelSerialized: Buffer.from(
        await parcel.serialize(keyPairSet.privateEndpoint.privateKey),
      ),
    };
  }

  async function validatePongDelivery(recipientPrivateKey: CryptoKey): Promise<void> {
    // Allow sufficient time for the background job to deliver the message
    await sleep(2);

    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    const pongParcelSerialized = gatewayEndpointRoute.getCall(0).body as unknown as Buffer;
    const pongParcel = await Parcel.deserialize(bufferToArray(pongParcelSerialized));
    expect(pongParcel).toHaveProperty(
      'recipientAddress',
      certificatePath.privateEndpoint.getCommonName(),
    );
    const pongParcelPayload = EnvelopedData.deserialize(
      bufferToArray(pongParcel.payloadSerialized as Buffer),
    );
    const pongServiceMessageSerialized = await pongParcelPayload.decrypt(recipientPrivateKey);
    const pongServiceMessage = ServiceMessage.deserialize(pongServiceMessageSerialized);
    expect(pongServiceMessage).toHaveProperty('type', 'application/vnd.awala.ping-v1.pong');
    expect(pongServiceMessage).toHaveProperty('content.byteLength', 36);
  }

  function configureMockGatewayServer(): void {
    beforeAll(async () => mockGatewayServer.start(GATEWAY_PORT));
    afterAll(async () => mockGatewayServer.stop());

    afterEach(() => mockGatewayServer.clear());
    beforeEach(() => {
      gatewayEndpointRoute = mockGatewayServer
        .post('/')
        .setHeader('Content-Type', 'application/vnd.awala.parcel')
        .setBody((body) => !!body)
        .setResponseStatusCode(202);
      logDiffOn501(mockGatewayServer, gatewayEndpointRoute);
    });
  }
});

async function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

function configureVault(): void {
  const vaultClient = axios.create({
    baseURL: 'http://vault:8200/v1',
    headers: { 'X-Vault-Token': 'root' },
  });
  beforeAll(async () => {
    await vaultClient.post('/sys/mounts/pong-keys', {
      options: { version: '2' },
      type: 'kv',
    });
  });
  afterAll(async () => {
    await vaultClient.delete('/sys/mounts/pong-keys');
  });
}
