import {
  Certificate,
  issueGatewayCertificate,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { NodeKeyPairSet, PDACertPath } from '@relaycorp/relaynet-testing';
import envVar from 'env-var';

import { serializePing } from './pingSerialization';

export function getMockInstance(mockedObject: any): jest.MockInstance<any, any> {
  return (mockedObject as unknown) as jest.MockInstance<any, any>;
}

export function getMockContext(mockedObject: any): jest.MockContext<any, any> {
  const mockInstance = getMockInstance(mockedObject);
  return mockInstance.mock;
}

// tslint:disable-next-line:readonly-array
export function mockSpy<T, Y extends any[]>(
  spy: jest.MockInstance<T, Y>,
  mockImplementation?: (...args: readonly any[]) => any,
): jest.MockInstance<T, Y> {
  beforeEach(() => {
    spy.mockReset();
    if (mockImplementation) {
      spy.mockImplementation(mockImplementation);
    }
  });

  afterAll(() => {
    spy.mockRestore();
  });

  return spy;
}

interface EnvVarSet {
  readonly [key: string]: string | undefined;
}

export function configureMockEnvVars(envVars: EnvVarSet = {}): (envVars: EnvVarSet) => void {
  const mockEnvVarGet = jest.spyOn(envVar, 'get');

  function setEnvVars(newEnvVars: EnvVarSet): void {
    mockEnvVarGet.mockReset();
    mockEnvVarGet.mockImplementation((...args: readonly any[]) => {
      const originalEnvVar = jest.requireActual('env-var');
      const env = originalEnvVar.from(newEnvVars);

      return env.get(...args);
    });
  }

  beforeAll(() => setEnvVars(envVars));
  beforeEach(() => setEnvVars(envVars));

  afterAll(() => {
    mockEnvVarGet.mockRestore();
  });

  return (newEnvVars: EnvVarSet) => setEnvVars(newEnvVars);
}

export async function generateStubNodeCertificate(
  subjectPublicKey: CryptoKey,
  issuerPrivateKey: CryptoKey,
  options: Partial<{ readonly issuerCertificate: Certificate }> = {},
): Promise<Certificate> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return issueGatewayCertificate({
    issuerCertificate: options.issuerCertificate,
    issuerPrivateKey,
    subjectPublicKey,
    validityEndDate: tomorrow,
  });
}

export function expectBuffersToEqual(
  buffer1: Buffer | ArrayBuffer,
  buffer2: Buffer | ArrayBuffer,
): void {
  if (buffer1 instanceof Buffer) {
    expect(buffer2).toBeInstanceOf(Buffer);
    expect(buffer1.equals(buffer2 as Buffer)).toBeTrue();
  } else {
    expect(buffer1).toBeInstanceOf(ArrayBuffer);
    expect(buffer2).toBeInstanceOf(ArrayBuffer);

    const actualBuffer1 = Buffer.from(buffer1);
    const actualBuffer2 = Buffer.from(buffer2);
    expect(actualBuffer1.equals(actualBuffer2)).toBeTrue();
  }
}

export async function generatePingParcel(
  recipientAddress: string,
  recipientIdCertificate: Certificate,
  keyPairSet: NodeKeyPairSet,
  certificatePath: PDACertPath,
  creationDate: Date | null = null,
): Promise<Buffer> {
  const parcelSenderCertificate = await generateStubNodeCertificate(
    keyPairSet.privateEndpoint.publicKey,
    keyPairSet.privateEndpoint.privateKey,
  );
  const parcelPayloadSerialized = await generatePingParcelPayload(
    certificatePath,
    recipientIdCertificate,
  );
  const parcel = new Parcel(
    recipientAddress,
    parcelSenderCertificate,
    parcelPayloadSerialized,
    creationDate ? { creationDate } : {},
  );
  return Buffer.from(await parcel.serialize(keyPairSet.privateEndpoint.privateKey));
}

export function generatePingServiceMessage(
  certificatePath: PDACertPath,
  pingId?: string,
): ArrayBuffer {
  const pingMessage = serializePing(
    certificatePath.pdaGrantee,
    [certificatePath.privateEndpoint, certificatePath.privateGateway],
    pingId,
  );
  const serviceMessage = new ServiceMessage('application/vnd.awala.ping-v1.ping', pingMessage);
  return serviceMessage.serialize();
}

async function generatePingParcelPayload(
  certificatePath: PDACertPath,
  recipientIdCertificate: Certificate,
): Promise<Buffer> {
  const serviceMessageSerialized = generatePingServiceMessage(certificatePath);
  const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
    serviceMessageSerialized,
    recipientIdCertificate,
  );
  return Buffer.from(serviceMessageEncrypted.serialize());
}
