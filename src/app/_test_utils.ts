import { Certificate, issueNodeCertificate } from '@relaycorp/relaynet-core';
import { createHash } from 'crypto';
import envVar from 'env-var';

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
  publicKey: CryptoKey,
  privateKey: CryptoKey,
): Promise<Certificate> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return issueNodeCertificate({
    issuerPrivateKey: privateKey,
    serialNumber: 1,
    subjectPublicKey: publicKey,
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
