import { Certificate, RelaynetError } from '@relaycorp/relaynet-core';
import bufferToArray from 'buffer-to-arraybuffer';
import uuid4 from 'uuid4';

export class PingSerializationError extends RelaynetError {}

export interface Ping {
  readonly id: string;
  readonly pda: Certificate;
}

export function serializePing(pda: Certificate, id?: string): Buffer {
  if (id?.length === 0) {
    throw new PingSerializationError('Ping id should not be empty');
  }

  const pdaSerialized = Buffer.from(pda.serialize()).toString('base64');
  const pingSerialized = {
    id: id ?? uuid4(),
    pda: pdaSerialized,
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

  const pingId = pingJson.id;
  if (typeof pingId !== 'string') {
    throw new PingSerializationError('Ping id is missing or it is not a string');
  }

  const pdaBase64 = pingJson.pda;
  if (typeof pdaBase64 !== 'string') {
    throw new PingSerializationError('PDA is missing');
  }

  const pdaDer = Buffer.from(pdaBase64, 'base64');
  if (pdaDer.byteLength === 0) {
    throw new PingSerializationError('PDA is not base64-encoded');
  }

  let pda: Certificate;
  try {
    pda = Certificate.deserialize(bufferToArray(pdaDer));
  } catch (error) {
    throw new PingSerializationError(
      error,
      'PDA is base64-encoded but not a valid DER serialization of an X.509 certificate',
    );
  }
  return { id: pingId, pda };
}
