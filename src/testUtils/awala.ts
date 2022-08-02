import {
  Certificate,
  CertificationPath,
  issueGatewayCertificate,
  Parcel,
  Recipient,
  ServiceMessage,
  SessionlessEnvelopedData,
} from '@relaycorp/relaynet-core';
import { NodeKeyPairSet, PDACertPath } from '@relaycorp/relaynet-testing';

import { serializePing } from '../app/pingSerialization';

export const PONG_INTERNET_ADDRESS = 'ping.example.com';
export const GATEWAY_INTERNET_ADDRESS = 'westeros.relaycorp.cloud';

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

export async function generatePingParcel(
  recipient: Recipient,
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
    recipient.internetAddress ?? GATEWAY_INTERNET_ADDRESS,
  );
  const parcel = new Parcel(
    recipient,
    parcelSenderCertificate,
    parcelPayloadSerialized,
    creationDate ? { creationDate } : {},
  );
  return Buffer.from(await parcel.serialize(keyPairSet.privateEndpoint.privateKey));
}

export function generatePingServiceMessage(
  certificatePath: PDACertPath,
  endpointInternetAddress: string,
  pingId?: string,
): ArrayBuffer {
  const pingMessage = serializePing(
    new CertificationPath(certificatePath.pdaGrantee, [
      certificatePath.privateEndpoint,
      certificatePath.privateGateway,
    ]),
    endpointInternetAddress,
    pingId,
  );
  const serviceMessage = new ServiceMessage('application/vnd.awala.ping-v1.ping', pingMessage);
  return serviceMessage.serialize();
}

async function generatePingParcelPayload(
  certificatePath: PDACertPath,
  recipientIdCertificate: Certificate,
  recipientInternetAddress: string,
): Promise<Buffer> {
  const serviceMessageSerialized = generatePingServiceMessage(
    certificatePath,
    recipientInternetAddress,
  );
  const serviceMessageEncrypted = await SessionlessEnvelopedData.encrypt(
    serviceMessageSerialized,
    recipientIdCertificate,
  );
  return Buffer.from(serviceMessageEncrypted.serialize());
}
