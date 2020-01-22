import { Certificate, generateRSAKeyPair } from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import bufferToArray from 'buffer-to-arraybuffer';
import * as fs from 'fs';
import { logDiffOn501, Stubborn } from 'stubborn-ws';

import { generateStubNodeCertificate, generateStubPingParcel } from '../app/_test_utils';

const PONG_SERVICE_ENDPOINT = 'http://app:3000/';
const ENDPOINT_CERTIFICATE_DER = fs.readFileSync(__dirname + '/endpoint-certificate.der');

describe('End-to-end test for successful delivery of ping and pong messages', () => {
  //region Configure Stubborn
  const mockGatewayServer = new Stubborn({ host: '0.0.0.0' });
  beforeAll(async () => mockGatewayServer.start(4000));
  afterAll(async () => mockGatewayServer.stop());
  afterEach(() => mockGatewayServer.clear());
  //endregion

  test('Gateway should receive pong message', async () => {
    const gatewayEndpointRoute = mockGatewayServer
      .post('/')
      .setHeader('Content-Type', 'application/vnd.relaynet.parcel')
      .setBody(body => !!body)
      .setResponseStatusCode(202);
    logDiffOn501(mockGatewayServer, gatewayEndpointRoute);

    const endpointCertificate = Certificate.deserialize(bufferToArray(ENDPOINT_CERTIFICATE_DER));
    const pingSenderKeyPair = await generateRSAKeyPair();
    const pingSenderCertificate = await generateStubNodeCertificate(
      pingSenderKeyPair.publicKey,
      pingSenderKeyPair.privateKey,
    );
    const pingParcel = bufferToArray(
      await generateStubPingParcel(PONG_SERVICE_ENDPOINT, endpointCertificate, {
        certificate: pingSenderCertificate,
        privateKey: pingSenderKeyPair.privateKey,
      }),
    );
    await deliverParcel(PONG_SERVICE_ENDPOINT, pingParcel, {
      relayAddress: `http://gateway:${mockGatewayServer.getPort()}/`,
    });

    await sleep(4000);

    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    // const body = { some: 'body' };
    //
    // const res = await axios.get(`${mockGatewayServer.getOrigin()}`);
    //
    // expect(res.data).toEqual(body);
  });

  test.todo('Channel session protocol');
});

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
