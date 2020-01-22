/* tslint:disable:no-let */
import {
  Certificate,
  generateRSAKeyPair,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import * as fs from 'fs';
import { logDiffOn501, Route, Stubborn } from 'stubborn-ws';

import { generateStubNodeCertificate, generateStubPingParcel } from '../app/_test_utils';

const GATEWAY_PORT = 4000;
const GATEWAY_ADDRESS = `http://gateway:${GATEWAY_PORT}/`;
const PONG_SERVICE_ENDPOINT = 'http://app:3000/';
const ENDPOINT_CERTIFICATE_DER = fs.readFileSync(
  process.cwd() + '/src/functional_tests/endpoint-certificate.der',
);

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

  let endpointCertificate: Certificate;
  let pingSenderPrivateKey: CryptoKey;
  let pingSenderCertificate: Certificate;
  beforeAll(async () => {
    endpointCertificate = Certificate.deserialize(bufferToArray(ENDPOINT_CERTIFICATE_DER));

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
      await generateStubPingParcel(PONG_SERVICE_ENDPOINT, endpointCertificate, {
        certificate: pingSenderCertificate,
        privateKey: pingSenderPrivateKey,
      }),
    );

    await deliverParcel(PONG_SERVICE_ENDPOINT, pingParcel, {
      relayAddress: GATEWAY_ADDRESS,
    });

    await sleep(2);
    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    const pongParcelSerialized = (gatewayEndpointRoute.getCall(0).body as unknown) as Buffer;
    const pongParcel = await Parcel.deserialize(bufferToArray(pongParcelSerialized));
    expect(pongParcel).toHaveProperty('recipientAddress', pingSenderCertificate.getCommonName());
    const pongParcelPayload = SessionlessEnvelopedData.deserialize(
      bufferToArray(pongParcel.payloadSerialized as Buffer),
    );
    const pongServiceMessageSerialized = await pongParcelPayload.decrypt(pingSenderPrivateKey);
    const pongServiceMessage = ServiceMessage.deserialize(
      Buffer.from(pongServiceMessageSerialized),
    );
    expect(pongServiceMessage).toHaveProperty('type', 'application/vnd.relaynet.ping-v1.pong');
    expect(pongServiceMessage).toHaveProperty('value.byteLength', 36);
  });

  test.todo('Channel session protocol');
});

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1_000));
}
