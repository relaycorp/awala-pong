import {
  Certificate,
  generateRSAKeyPair,
  issueNodeCertificate,
  Parcel,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { createHash } from 'crypto';
import envVar from 'env-var';

import { serializePing } from './pingSerialization';

export function getMockContext(mockedObject: any): jest.MockContext<any, any> {
  const mockInstance = (mockedObject as unknown) as jest.MockInstance<any, any>;
  return mockInstance.mock;
}

export function mockEnvVars(envVars: { readonly [key: string]: string | undefined }): void {
  jest.spyOn(envVar, 'get').mockImplementation((...args: readonly any[]) => {
    const originalEnvVar = jest.requireActual('env-var');
    const env = originalEnvVar.from(envVars);

    return env.get(...args);
  });
}

export async function generateStubNodeCertificate(
  subjectPublicKey: CryptoKey,
  issuerPrivateKey: CryptoKey,
  options: Partial<{ readonly issuerCertificate: Certificate }> = {},
): Promise<Certificate> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return issueNodeCertificate({
    isCA: true,
    issuerCertificate: options.issuerCertificate,
    issuerPrivateKey,
    serialNumber: Math.floor(Math.random()),
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

export function sha256Hex(plaintext: ArrayBuffer): string {
  return createHash('sha256')
    .update(Buffer.from(plaintext))
    .digest('hex');
}

export async function expectPromiseToReject(
  promise: Promise<any>,
  expectedError: Error,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toHaveProperty('message', expectedError.message);
    expect(error).toBeInstanceOf(expectedError.constructor);
    return;
  }
  throw new Error(`Expected promise to throw error ${expectedError}`);
}

export async function generateStubPingParcel(
  recipientAddress: string,
  recipientCertificate: Certificate,
  sender?: { readonly privateKey: CryptoKey; readonly certificate: Certificate },
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
    serviceMessageEncrypted.serialize(),
  );

  return Buffer.from(await parcel.serialize(senderPrivateKey));
}
