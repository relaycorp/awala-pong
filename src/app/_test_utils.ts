import {
  Certificate,
  generateRSAKeyPair,
  issueGatewayCertificate,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import envVar from 'env-var';

import { serializePing } from './pingSerialization';

export function getMockContext(mockedObject: any): jest.MockContext<any, any> {
  const mockInstance = (mockedObject as unknown) as jest.MockInstance<any, any>;
  return mockInstance.mock;
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

export async function generateStubPingParcel(
  recipientAddress: string,
  recipientCertificate: Certificate,
  sender?: { readonly privateKey: CryptoKey; readonly certificate: Certificate },
  options?: Partial<{ readonly creationDate: Date }>,
): Promise<Buffer> {
  // tslint:disable-next-line:no-let
  let senderPrivateKey;
  // tslint:disable-next-line:no-let
  let senderCertificate;
  if (sender) {
    senderPrivateKey = sender.privateKey;
    senderCertificate = sender.certificate;
  } else {
    const senderKeyPair = await generateRSAKeyPair();
    senderPrivateKey = senderKeyPair.privateKey;
    senderCertificate = await generateStubNodeCertificate(
      senderKeyPair.publicKey,
      senderPrivateKey,
    );
  }

  const pda = await generateStubNodeCertificate(
    await recipientCertificate.getPublicKey(),
    senderPrivateKey,
    { issuerCertificate: senderCertificate },
  );
  const serviceMessage = new ServiceMessage(
    'application/vnd.relaynet.ping-v1.ping',
    serializePing(pda),
  );
  const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
    serviceMessage.serialize(),
    recipientCertificate,
  );
  const parcel = new Parcel(
    recipientAddress,
    senderCertificate,
    Buffer.from(serviceMessageEncrypted.serialize()),
    options || {},
  );

  return Buffer.from(await parcel.serialize(senderPrivateKey));
}
