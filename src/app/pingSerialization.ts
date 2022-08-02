import { CertificationPath, RelaynetError } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import isValidDomain from 'is-valid-domain';
import uuid4 from 'uuid4';

export class PingSerializationError extends RelaynetError {}

export interface Ping {
  readonly id: string;
  readonly pdaPath: CertificationPath;
  readonly endpointInternetAddress: string;
}

export function serializePing(
  pdaPath: CertificationPath,
  endpointInternetAddress: string,
  id?: string,
): Buffer {
  if (id?.length === 0) {
    throw new PingSerializationError('Ping id should not be empty');
  }

  const pingSerialized = {
    id: id ?? uuid4(),
    pda_path: Buffer.from(pdaPath.serialize()).toString('base64'),
    endpoint_internet_address: endpointInternetAddress,
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

  const endpointInternetAddress: string = pingJson.endpoint_internet_address?.toString() ?? '';
  if (!isValidDomain(endpointInternetAddress)) {
    throw new PingSerializationError('Endpoint Internet address is missing or malformed');
  }

  const pdaPath = deserializePDAPath(pingJson.pda_path);

  return { id: pingJson.id, pdaPath, endpointInternetAddress };
}

function deserializePDAPath(certificateDerBase64: any): CertificationPath {
  if (typeof certificateDerBase64 !== 'string') {
    throw new PingSerializationError('PDA path is absent');
  }

  const certificateDer = Buffer.from(certificateDerBase64, 'base64');
  if (certificateDer.byteLength === 0) {
    throw new PingSerializationError('PDA path is not base64-encoded');
  }

  try {
    return CertificationPath.deserialize(bufferToArray(certificateDer));
  } catch (err) {
    throw new PingSerializationError(err as Error, 'Malformed PDA path');
  }
}
