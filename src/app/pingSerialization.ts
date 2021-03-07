import { Certificate, RelaynetError } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import uuid4 from 'uuid4';

export class PingSerializationError extends RelaynetError {}

export interface Ping {
  readonly id: string;
  readonly pda: Certificate;
  readonly pdaChain: readonly Certificate[];
}

export function serializePing(
  pda: Certificate,
  pdaChain: readonly Certificate[],
  id?: string,
): Buffer {
  if (id?.length === 0) {
    throw new PingSerializationError('Ping id should not be empty');
  }

  const pdaSerialized = serializeCertificate(pda);
  const pingSerialized = {
    id: id ?? uuid4(),
    pda: pdaSerialized,
    pda_chain: pdaChain.map(serializeCertificate),
  };
  return Buffer.from(JSON.stringify(pingSerialized));
}

export function deserializePing(pingSerialized: Buffer): Ping {
  let pingJson: any;
  try {
    pingJson = JSON.parse(pingSerialized.toString());
  } catch (_err) {
    throw new PingSerializationError('Ping message is not JSON-serialized');
  }

  if (typeof pingJson.id !== 'string') {
    throw new PingSerializationError('Ping id is missing or it is not a string');
  }

  let pda: Certificate;
  try {
    pda = deserializeCertificate(pingJson.pda);
  } catch (err) {
    throw new PingSerializationError(err, 'Invalid PDA');
  }

  if (!Array.isArray(pingJson.pda_chain)) {
    throw new PingSerializationError('PDA chain is not an array');
  }
  let pdaChain: readonly Certificate[];
  try {
    pdaChain = pingJson.pda_chain.map(deserializeCertificate);
  } catch (err) {
    throw new PingSerializationError(err, 'PDA chain contains invalid item');
  }

  return { id: pingJson.id, pda, pdaChain };
}

function deserializeCertificate(certificateDerBase64: any): Certificate {
  if (typeof certificateDerBase64 !== 'string') {
    throw new PingSerializationError('Certificate is missing');
  }

  const certificateDer = Buffer.from(certificateDerBase64, 'base64');
  if (certificateDer.byteLength === 0) {
    throw new PingSerializationError('Certificate is not base64-encoded');
  }

  try {
    return Certificate.deserialize(bufferToArray(certificateDer));
  } catch (error) {
    throw new PingSerializationError(error, 'Certificate is base64-encoded but not DER-encoded');
  }
}

function serializeCertificate(certificate: Certificate): string {
  return Buffer.from(certificate.serialize()).toString('base64');
}
