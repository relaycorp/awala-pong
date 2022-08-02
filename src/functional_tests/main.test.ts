import {
  Certificate,
  CertificationPath,
  EnvelopedData,
  getIdFromIdentityKey,
  Parcel,
  PublicNodeConnectionParams,
  ServiceMessage,
  SessionEnvelopedData,
  SessionKey,
} from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
} from '@relaycorp/relaynet-testing';
import bufferToArray from 'buffer-to-arraybuffer';
import { get as httpGet } from 'http';
import { mockServerClient } from 'mockserver-client';

import { serializePing } from '../app/pingSerialization';
import { generateStubNodeCertificate } from '../testUtils/awala';

const GATEWAY_INTERNET_ADDRESS = 'mock-public-gateway.default.svc.cluster.local';

const PONG_ENDPOINT_LOCAL_URL = 'http://127.0.0.1:8080';

describe('End-to-end test for successful delivery of ping and pong messages', () => {
  const mockGatewayServerClient = mockServerClient('127.0.0.1', 1080);
  const resetMockGatewayServer = async () => {
    await mockGatewayServerClient.reset();
  };
  beforeAll(resetMockGatewayServer);
  beforeEach(async () => {
    await mockGatewayServerClient.mockAnyResponse({
      httpRequest: { method: 'POST', path: '/' },
      httpResponse: { statusCode: 202 },
      times: { remainingTimes: 1, unlimited: false },
    });
  });
  afterEach(resetMockGatewayServer);

  let pongConnectionParams: PublicNodeConnectionParams;
  beforeAll(async () => {
    const connectionParamsSerialized = await downloadFileFromURL(
      `${PONG_ENDPOINT_LOCAL_URL}/connection-params.der`,
    );
    pongConnectionParams = await PublicNodeConnectionParams.deserialize(
      bufferToArray(connectionParamsSerialized),
    );
  });

  let pingSenderKeyPair: CryptoKeyPair;
  let pingSenderCertificate: Certificate;
  beforeAll(async () => {
    const keyPairSet = await generateIdentityKeyPairSet();
    const pdaPath = await generatePDACertificationPath(keyPairSet);
    pingSenderKeyPair = keyPairSet.privateEndpoint;
    pingSenderCertificate = pdaPath.privateEndpoint;
  });

  test('Ping pong with channel session protocol', async () => {
    const { pingParcelSerialized, dhPrivateKey } = await generateSessionPingParcel(
      pongConnectionParams.sessionKey,
    );

    await deliverParcel(PONG_ENDPOINT_LOCAL_URL, pingParcelSerialized, { useTls: false });

    await validatePongDelivery(dhPrivateKey);
  });

  async function generateSessionPingParcel(initialSessionKey: SessionKey): Promise<{
    readonly pingParcelSerialized: Buffer;
    readonly dhPrivateKey: CryptoKey;
  }> {
    const pda = await generateStubNodeCertificate(
      await pongConnectionParams.identityKey,
      pingSenderKeyPair.privateKey,
      { issuerCertificate: pingSenderCertificate },
    );
    const serviceMessage = new ServiceMessage(
      'application/vnd.awala.ping-v1.ping',
      serializePing(new CertificationPath(pda, [pingSenderCertificate]), GATEWAY_INTERNET_ADDRESS),
    );
    const { dhPrivateKey, envelopedData } = await SessionEnvelopedData.encrypt(
      serviceMessage.serialize(),
      initialSessionKey,
    );
    const parcel = new Parcel(
      {
        id: await getIdFromIdentityKey(pongConnectionParams.identityKey),
        internetAddress: pongConnectionParams.internetAddress,
      },
      pingSenderCertificate,
      Buffer.from(envelopedData.serialize()),
    );

    return {
      dhPrivateKey,
      pingParcelSerialized: Buffer.from(await parcel.serialize(pingSenderKeyPair.privateKey)),
    };
  }

  async function validatePongDelivery(recipientPrivateKey: CryptoKey): Promise<void> {
    // Allow sufficient time for the background job to deliver the message
    await sleep(2);

    const requests = await mockGatewayServerClient.retrieveRecordedRequests({ path: '/' });
    expect(requests).toHaveLength(1);

    expect(requests[0].body).toHaveProperty('type', 'BINARY');
    const pongParcelSerialized = Buffer.from((requests[0].body as any).base64Bytes, 'base64');
    const pongParcel = await Parcel.deserialize(bufferToArray(pongParcelSerialized));
    expect(pongParcel).toHaveProperty(
      'recipientAddress',
      await pingSenderCertificate.calculateSubjectId(),
    );
    const pongParcelPayload = EnvelopedData.deserialize(
      bufferToArray(pongParcel.payloadSerialized as Buffer),
    );
    const pongServiceMessageSerialized = await pongParcelPayload.decrypt(recipientPrivateKey);
    const pongServiceMessage = ServiceMessage.deserialize(pongServiceMessageSerialized);
    expect(pongServiceMessage).toHaveProperty('type', 'application/vnd.awala.ping-v1.pong');
    expect(pongServiceMessage).toHaveProperty('content.byteLength', 36);
  }
});

async function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

async function downloadFileFromURL(url: string): Promise<Buffer> {
  // tslint:disable-next-line:readonly-array
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    httpGet(url, { timeout: 2_000 }, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url} (HTTP ${response.statusCode})`));
      }

      response.on('error', reject);

      response.on('data', (chunk) => chunks.push(chunk));

      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}
